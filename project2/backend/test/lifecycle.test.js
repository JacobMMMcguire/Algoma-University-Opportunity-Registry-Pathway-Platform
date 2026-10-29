// R3-08 to R3-13, R3-19, R3-21: term runs, deadlines and lifecycle states, checked against the
// R3 fixture's expected_lifecycle_results.json as of its evaluation_date (R3_PLAN.md D1 to D4,
// D10). The date comes from the fixture file, never from the day the tests run.
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { after, before, describe, test } = require("node:test");
const { parseClockDate } = require("../src/config");
const { buildR2FixtureSql, buildR3FixtureSql, fixtureEmail, loadLifecycleFixture } = require("../src/fixture");
const { createClient, loadFixtureInto, signIn, startTestApp, uniqueEmail } = require("./helpers");

const fixture = loadLifecycleFixture();
const expected = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "r3_fixtures", "expected_lifecycle_results.json"), "utf8"),
);
const EVALUATION_DATE = fixture.evaluation_date;
const opportunity = (fixtureId) => fixture.opportunities.find((o) => o.fixture_id === fixtureId);

async function startWithFixtures(clockDate) {
  const t = await startTestApp({ config: { clockDate } });
  await loadFixtureInto(t);
  await t.db.exec(buildR2FixtureSql());
  await t.db.exec(buildR3FixtureSql());
  return t;
}

// The API kind and id each fixture opportunity was loaded as (D9).
async function recordIds(t) {
  const ids = {};
  for (const o of fixture.opportunities) {
    const result =
      o.source === "industry"
        ? await t.db.query("SELECT id FROM partner_submissions WHERE fixture_id IS NOT NULL AND title = $1", [o.title])
        : await t.db.query("SELECT id FROM projects WHERE fixture_id = $1", [o.fixture_id]);
    ids[o.fixture_id] = { kind: o.source === "industry" ? "industry" : "project", id: result.rows[0].id };
  }
  return ids;
}

const detailPath = ({ kind, id }) => (kind === "industry" ? `/api/opportunities/${id}` : `/api/projects/${id}`);

describe("term lifecycle (R3 fixture)", () => {
  let t;
  let ids;
  let anon;
  let staff;
  let alex;
  let priya;
  let jordan;

  before(async () => {
    t = await startWithFixtures(EVALUATION_DATE);
    ids = await recordIds(t);
    anon = createClient(t.baseUrl);
    staff = (await signIn(t, fixtureEmail("TEST-STAFF"))).client;
    alex = (await signIn(t, fixtureEmail("F-ALEX"))).client;
    priya = (await signIn(t, fixtureEmail("F-PRIYA"))).client;
    jordan = (await signIn(t, fixtureEmail("F-JORDAN"))).client;
  });
  after(() => t.close());

  // Each fixture opportunity's lifecycle as its manager sees it.
  async function stateOf(fixtureId, client = staff) {
    const { kind, id } = ids[fixtureId];
    const res = await client.get(`/api/lifecycle/${kind}/${id}`);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    return res.data.item.lifecycle;
  }

  describe("evaluated as of the fixture's evaluation_date", () => {
    test("the clock is the fixture date and pages are told it is simulated", async () => {
      assert.equal(expected.evaluated_at, EVALUATION_DATE);
      const me = await anon.get("/api/auth/me");
      assert.deepEqual(me.data.clock, { today: EVALUATION_DATE, simulated: true, label: "6 November 2026" });
    });

    test("R3-09: the expected opportunities are expired, with the deadline as the reason", async () => {
      for (const fixtureId of expected.expired_opportunity_ids) {
        const lifecycle = await stateOf(fixtureId);
        assert.equal(lifecycle.state, "expired", fixtureId);
        assert.match(lifecycle.reason, /deadline.*passed without a confirmed match/, fixtureId);
      }
    });

    test("R3-10, R3-11: past-deadline opportunities that aren't expired keep their own state", async () => {
      const states = {};
      for (const fixtureId of Object.keys(expected.past_deadline_but_not_expired)) {
        states[fixtureId] = (await stateOf(fixtureId)).state;
      }
      // O-301 has a fully confirmed match (M-401), so it follows the match, not the calendar.
      assert.deepEqual(states, { "O-301": "matched", "O-305": "withdrawn", "O-306": "completed", "O-307": "archived" });
    });

    test("R3-11: all five states occur and are told apart", async () => {
      const seen = new Set();
      for (const o of fixture.opportunities) seen.add((await stateOf(o.fixture_id)).state);
      for (const state of ["expired", "withdrawn", "matched", "completed", "archived"]) assert.ok(seen.has(state), state);
    });

    test("R3-19: of the fixture's opportunities, discovery shows only the ones still open", async () => {
      const titles = new Set(fixture.opportunities.map((o) => o.title));
      for (const client of [anon, createClient(t.baseUrl)]) {
        const listed = [
          ...(await client.get("/api/projects")).data.projects,
          ...(await client.get("/api/opportunities")).data.opportunities,
        ].filter((record) => titles.has(record.title));
        assert.deepEqual(
          listed.map((record) => record.title),
          expected.still_open_opportunity_ids.map((fixtureId) => opportunity(fixtureId).title),
        );
      }
    });

    test("R3-08: the term and deadline come from the fixture", async () => {
      const lifecycle = await stateOf("O-303");
      assert.equal(lifecycle.term, "Winter 2027");
      assert.equal(lifecycle.deadline, "2026-12-15");
      assert.equal(lifecycle.state, "open");
      assert.equal((await stateOf("O-306")).term, "Summer 2026");
    });

    test("R3-09, R3-19: a removed opportunity's link says why, and nothing is deleted", async () => {
      for (const fixtureId of ["O-302", "O-305", "O-301"]) {
        const res = await anon.get(detailPath(ids[fixtureId]));
        assert.equal(res.status, 404, fixtureId);
        assert.equal(res.data.removed.title, opportunity(fixtureId).title);
        assert.ok(res.data.removed.lifecycle.reason, fixtureId);
      }
      assert.equal((await anon.get(detailPath(ids["O-302"]))).data.removed.lifecycle.state, "expired");
      // The owner still has it.
      const mine = (await alex.get("/api/lifecycle")).data.items.map((item) => item.title);
      assert.ok(mine.includes(opportunity("O-302").title));
    });
  });

  describe("R3-08: Centre deadlines are authoritative", () => {
    test("a Centre deadline overrides the faculty deadline, and only staff can set one", async () => {
      const { kind, id } = ids["O-303"];
      const denied = await priya.put(`/api/lifecycle/${kind}/${id}/centre-deadline`, { centreDeadline: "2027-01-10" });
      assert.equal(denied.status, 403);

      const set = await staff.put(`/api/lifecycle/${kind}/${id}/centre-deadline`, { centreDeadline: "2026-11-20" });
      assert.equal(set.status, 200, JSON.stringify(set.data));
      assert.equal(set.data.item.lifecycle.effectiveDeadline, "2026-11-20");
      assert.equal(set.data.item.lifecycle.deadline, "2026-12-15");

      // The owner pushing their own deadline later doesn't move the Centre's.
      const later = await priya.put(`/api/lifecycle/${kind}/${id}/schedule`, { targetTerm: "Winter 2027", deadline: "2027-02-01" });
      assert.equal(later.data.item.lifecycle.effectiveDeadline, "2026-11-20");

      const cleared = await staff.put(`/api/lifecycle/${kind}/${id}/centre-deadline`, { centreDeadline: null });
      assert.equal(cleared.data.item.lifecycle.effectiveDeadline, "2027-02-01");
    });

    test("a Centre deadline in the past expires an opportunity at once", async () => {
      const t2 = await startWithFixtures(EVALUATION_DATE);
      const ids2 = await recordIds(t2);
      // Staff set it directly in the database: the API refuses past dates.
      await t2.db.query("UPDATE opportunity_runs SET centre_deadline = '2026-11-01' WHERE project_id = $1", [ids2["O-303"].id]);
      const res = await createClient(t2.baseUrl).get(`/api/projects/${ids2["O-303"].id}`);
      assert.equal(res.status, 404);
      assert.equal(res.data.removed.lifecycle.state, "expired");
      await t2.close();
    });
  });

  describe("R3-12: renewal keeps the record and its history", () => {
    test("renewing an expired opportunity adds a run to the same record", async () => {
      const { kind, id } = ids["O-304"];
      const renewed = await jordan.post(`/api/lifecycle/${kind}/${id}/renew`, { targetTerm: "Winter 2027", deadline: "2026-12-01" });
      assert.equal(renewed.status, 200, JSON.stringify(renewed.data));
      assert.equal(renewed.data.item.id, id);
      assert.equal(renewed.data.item.lifecycle.state, "open");
      assert.equal(renewed.data.item.lifecycle.runNumber, 2);
      assert.deepEqual(
        renewed.data.history.map((run) => [run.runNumber, run.term, run.state]),
        [
          [1, "Fall 2026", "expired"],
          [2, "Winter 2027", "open"],
        ],
      );
      // The earlier run keeps its (declined) match; the new run starts with none.
      const matches = await t.db.query(
        `SELECT r.run_number FROM matches m JOIN opportunity_runs r ON r.id = m.run_id WHERE r.submission_id = $1`,
        [id],
      );
      assert.deepEqual(
        matches.rows.map((row) => row.run_number),
        [1],
      );
      // Back in discovery under the same id.
      assert.equal((await anon.get(`/api/opportunities/${id}`)).status, 200);
    });

    test("renewing a completed opportunity keeps the completed run as it was", async () => {
      const { kind, id } = ids["O-306"];
      const renewed = await jordan.post(`/api/lifecycle/${kind}/${id}/renew`, { targetTerm: "Summer 2027" });
      assert.equal(renewed.status, 200, JSON.stringify(renewed.data));
      assert.equal(renewed.data.history[0].state, "completed");
      assert.equal(renewed.data.history[0].term, "Summer 2026");
    });

    test("an open or withdrawn opportunity can't be renewed", async () => {
      for (const fixtureId of ["O-303", "O-305"]) {
        const { kind, id } = ids[fixtureId];
        const res = await priya.post(`/api/lifecycle/${kind}/${id}/renew`, { targetTerm: "Fall 2027" });
        assert.equal(res.status, 409, fixtureId);
      }
    });
  });

  describe("R3-13: lifecycle changes are reversible", () => {
    test("the owner can return a withdrawn opportunity to open without recreating it", async () => {
      const { kind, id } = ids["O-305"];
      // Its deadline has passed, so reopening it needs a new one.
      const refused = await priya.post(`/api/lifecycle/${kind}/${id}/state`, { action: "reopen" });
      assert.equal(refused.status, 409);
      assert.equal(refused.data.code, "deadline_passed");

      const reopened = await priya.post(`/api/lifecycle/${kind}/${id}/state`, { action: "reopen", deadline: "2026-12-01" });
      assert.equal(reopened.status, 200, JSON.stringify(reopened.data));
      assert.equal(reopened.data.item.id, id);
      assert.equal(reopened.data.item.lifecycle.state, "open");
      const project = await anon.get(`/api/projects/${id}`);
      assert.equal(project.status, 200);
      assert.equal(project.data.project.status, "published");
      // The history records both changes.
      const changes = reopened.data.history[0].changes.map((c) => c.change);
      assert.ok(changes.includes("state") && changes.includes("schedule"));
    });

    test("staff can return an expired opportunity to open", async () => {
      const { kind, id } = ids["O-302"];
      const res = await staff.post(`/api/lifecycle/${kind}/${id}/state`, { action: "reopen", deadline: "2026-11-30" });
      assert.equal(res.status, 200, JSON.stringify(res.data));
      assert.equal(res.data.item.lifecycle.state, "open");
    });

    test("an archived opportunity can be reopened; withdrawing and archiving are recorded", async () => {
      const { kind, id } = ids["O-307"];
      const reopened = await priya.post(`/api/lifecycle/${kind}/${id}/state`, { action: "reopen", deadline: "2027-01-15" });
      assert.equal(reopened.data.item.lifecycle.state, "open");
      const withdrawn = await priya.post(`/api/lifecycle/${kind}/${id}/state`, { action: "withdraw" });
      assert.equal(withdrawn.data.item.lifecycle.state, "withdrawn");
      const archived = await priya.post(`/api/lifecycle/${kind}/${id}/state`, { action: "archive" });
      assert.equal(archived.data.item.lifecycle.state, "archived");
    });

    test("only a matched opportunity can be marked completed", async () => {
      const open = await priya.post(`/api/lifecycle/project/${ids["O-303"].id}/state`, { action: "complete" });
      assert.equal(open.status, 409);
      const { kind, id } = ids["O-301"];
      const done = await alex.post(`/api/lifecycle/${kind}/${id}/state`, { action: "complete" });
      assert.equal(done.status, 200, JSON.stringify(done.data));
      assert.equal(done.data.item.lifecycle.state, "completed");
    });
  });

  describe("R3-21: lifecycle changes are authorised on the server", () => {
    test("another faculty member can't change someone else's opportunity, whatever the URL or body says", async () => {
      const { kind, id } = ids["O-303"]; // Priya's
      const attempts = [
        () => alex.post(`/api/lifecycle/${kind}/${id}/state`, { action: "withdraw" }),
        () => alex.post(`/api/lifecycle/${kind}/${id}/state`, { action: "withdraw", ownerId: 1, facultyUserId: 1 }),
        () => alex.put(`/api/lifecycle/${kind}/${id}/schedule`, { targetTerm: "Fall 2027" }),
        () => alex.post(`/api/lifecycle/${kind}/${id}/renew`, { targetTerm: "Fall 2027" }),
        () => alex.get(`/api/lifecycle/${kind}/${id}`),
      ];
      for (const attempt of attempts) assert.equal((await attempt()).status, 404);
      assert.equal((await stateOf("O-303", priya)).term, "Winter 2027");
    });

    test("only willing supervisors manage an industry opportunity", async () => {
      const { kind, id } = ids["O-302"]; // supervised by Alex
      assert.equal((await jordan.post(`/api/lifecycle/${kind}/${id}/state`, { action: "withdraw" })).status, 404);
    });

    test("students and visitors can't manage any opportunity", async () => {
      const student = (await signIn(t, uniqueEmail("student"))).client;
      const { kind, id } = ids["O-303"];
      assert.equal((await student.get("/api/lifecycle")).status, 403);
      assert.equal((await student.post(`/api/lifecycle/${kind}/${id}/state`, { action: "withdraw" })).status, 403);
      assert.equal((await anon.post(`/api/lifecycle/${kind}/${id}/state`, { action: "withdraw" })).status, 401);
    });

    test("unknown kinds, ids and actions are refused without changing anything", async () => {
      assert.equal((await staff.get("/api/lifecycle/things/1")).status, 404);
      assert.equal((await staff.get("/api/lifecycle/project/abc")).status, 404);
      assert.equal((await staff.post(`/api/lifecycle/project/${ids["O-303"].id}/state`, { action: "delete" })).status, 400);
      assert.equal(
        (await priya.put(`/api/lifecycle/project/${ids["O-303"].id}/schedule`, { targetTerm: "Fall 2027", deadline: "2026-01-01" }))
          .status,
        400,
      );
    });
  });
});

describe("the clock (R3_PLAN.md D3)", () => {
  test("the expected results are the same if the evaluation date moves to the R3 due date", async () => {
    const t = await startWithFixtures("2026-11-11");
    const ids = await recordIds(t);
    const staff = (await signIn(t, fixtureEmail("TEST-STAFF"))).client;
    const expired = [];
    for (const o of fixture.opportunities) {
      const { kind, id } = ids[o.fixture_id];
      if ((await staff.get(`/api/lifecycle/${kind}/${id}`)).data.item.lifecycle.state === "expired") expired.push(o.fixture_id);
    }
    assert.deepEqual(expired, expected.expired_opportunity_ids);
    await t.close();
  });

  test("a deadline passes at the end of its day", async () => {
    const t = await startWithFixtures("2026-12-15");
    const ids = await recordIds(t);
    assert.equal((await createClient(t.baseUrl).get(`/api/projects/${ids["O-303"].id}`)).status, 200);
    await t.close();
  });

  test("CLOCK_DATE must be a real YYYY-MM-DD date; unset means the real date", () => {
    assert.equal(parseClockDate("2026-11-06"), "2026-11-06");
    assert.equal(parseClockDate(""), null);
    assert.equal(parseClockDate(undefined), null);
    for (const bad of ["2026-02-30", "06/11/2026", "2026-11-6", "tomorrow"]) assert.throws(() => parseClockDate(bad), bad);
  });
});
