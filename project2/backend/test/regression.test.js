// R3-23: the R1, R2 and R3 fixtures loaded together, exactly as `npm run seed:fixture` loads them
// and with the clock at the R3 evaluation_date, as the deployed app will run for evaluation.
// Every entry in r3_fixtures/expected_lifecycle_results.json is checked here in that state, and
// the R1 and R2 expected results must still hold alongside it. Reseeding must undo whatever an
// evaluator changed, so the expected results can be checked again after a walkthrough.
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { after, before, describe, test } = require("node:test");
const { buildAllFixtureSql, fixtureEmail, loadFixture, loadIntakeFixture, loadLifecycleFixture } = require("../src/fixture");
const { createClient, signIn, startTestApp } = require("./helpers");

const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", ...parts), "utf8"));
const r1 = loadFixture();
const r2Expected = readJson("r2_fixtures", "expected_intake_outcomes.json");
const r3 = loadLifecycleFixture();
const r3Expected = readJson("r3_fixtures", "expected_lifecycle_results.json");
const opportunity = (fixtureId) => r3.opportunities.find((o) => o.fixture_id === fixtureId);

const TABLES = [
  "users", "faculty_profiles", "projects", "partner_submissions", "opportunity_supervisors", "notifications",
  "opportunity_runs", "run_changes", "matches", "match_students", "partner_agreements", "student_profiles",
  "outcomes", "outcome_participants",
];

describe("R3-23: R1, R2 and R3 fixtures together, as seeded for evaluation", () => {
  let t;
  let ids;
  let clients;
  let anon;

  async function rowCounts() {
    const counts = {};
    for (const table of TABLES) counts[table] = (await t.db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
    return counts;
  }

  async function lookupIds() {
    const rows = async (sql) => (await t.db.query(sql)).rows;
    const by = (list) => Object.fromEntries(list.map((r) => [r.fixture_id, r.id]));
    const submissions = await rows("SELECT id, fixture_id, title FROM partner_submissions WHERE fixture_id IS NOT NULL");
    const projects = by(await rows("SELECT id, fixture_id FROM projects WHERE fixture_id IS NOT NULL"));
    const records = {};
    for (const o of r3.opportunities) {
      records[o.fixture_id] =
        o.source === "industry"
          ? { kind: "industry", id: submissions.find((s) => s.title === o.title).id }
          : { kind: "project", id: projects[o.fixture_id] };
    }
    return {
      records,
      projects,
      submissions: by(submissions),
      users: by(await rows("SELECT id, fixture_id FROM users WHERE fixture_id IS NOT NULL")),
      matches: by(await rows("SELECT id, fixture_id FROM matches WHERE fixture_id IS NOT NULL")),
      outcomes: by(await rows("SELECT id, fixture_id FROM outcomes WHERE fixture_id IS NOT NULL")),
    };
  }

  let firstCounts;
  before(async () => {
    t = await startTestApp({ config: { clockDate: r3.evaluation_date } });
    await t.db.exec(buildAllFixtureSql());
    firstCounts = await rowCounts();
    await t.db.exec(buildAllFixtureSql());
    ids = await lookupIds();
    anon = createClient(t.baseUrl);
    clients = {};
    for (const id of ["TEST-STAFF", "TEST-STUDENT", "F-ALEX", "F-PRIYA", "F-JORDAN", "F-MEI", "S08", "S11"]) {
      clients[id] = (await signIn(t, fixtureEmail(id))).client;
    }
  });
  after(() => t.close());

  const lifecycle = async ({ kind, id }) => {
    const res = await clients["TEST-STAFF"].get(`/api/lifecycle/${kind}/${id}`);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    return res.data.item.lifecycle;
  };

  const discoveredTitles = async (client) =>
    [...(await client.get("/api/projects")).data.projects, ...(await client.get("/api/opportunities")).data.opportunities].map(
      (record) => record.title,
    );

  // One check per entry of expected_lifecycle_results.json. The keys must match the file exactly,
  // so a new fixture version can't add an expectation that nothing checks.
  const r3Checks = {
    fixture_version: () => assert.equal(r3Expected.fixture_version, r3.fixture_version),
    evaluated_at: async () => {
      assert.equal(r3Expected.evaluated_at, r3.evaluation_date);
      assert.equal((await anon.get("/api/auth/me")).data.clock.today, r3Expected.evaluated_at);
    },
    expired_opportunity_ids: async () => {
      for (const id of r3Expected.expired_opportunity_ids) assert.equal((await lifecycle(ids.records[id])).state, "expired", id);
    },
    expiry_reasons: async () => {
      assert.deepEqual(Object.keys(r3Expected.expiry_reasons).sort(), [...r3Expected.expired_opportunity_ids].sort());
      for (const id of Object.keys(r3Expected.expiry_reasons)) {
        assert.match((await lifecycle(ids.records[id])).reason, /deadline.*passed without a confirmed match/, id);
      }
    },
    past_deadline_but_not_expired: async () => {
      for (const id of Object.keys(r3Expected.past_deadline_but_not_expired)) {
        const o = opportunity(id);
        assert.ok(o.deadline < r3.evaluation_date, `${id}'s deadline has passed`);
        // O-301 is stored open, and its fully confirmed match makes it matched (R3-10).
        assert.equal((await lifecycle(ids.records[id])).state, o.state === "open" ? "matched" : o.state, id);
      }
    },
    still_open_opportunity_ids: async () => {
      for (const id of r3Expected.still_open_opportunity_ids) assert.equal((await lifecycle(ids.records[id])).state, "open", id);
    },
    fully_confirmed_match_ids: () => matchStates(r3Expected.fully_confirmed_match_ids, "confirmed"),
    partly_confirmed_match_ids: () => matchStates(r3Expected.partly_confirmed_match_ids, "partly_confirmed"),
    not_confirmed_match_ids: async () => {
      for (const id of r3Expected.not_confirmed_match_ids) {
        const match = await matchAsProposer(id);
        assert.ok(!["confirmed", "partly_confirmed"].includes(match.state), id);
      }
    },
    showcase_eligible_outcome_ids: async () => {
      for (const client of [anon, clients["TEST-STUDENT"]]) {
        assert.deepEqual(showcased((await client.get("/api/outcomes/showcase")).data.outcomes), r3Expected.showcase_eligible_outcome_ids);
      }
    },
    participants_only_outcome_ids: async () => {
      for (const id of r3Expected.participants_only_outcome_ids) {
        assert.equal((await anon.get(`/api/outcomes/${ids.outcomes[id]}`)).status, 404, id);
        assert.equal((await clients["TEST-STUDENT"].get(`/api/outcomes/${ids.outcomes[id]}`)).status, 404, id);
      }
    },
    participants_only_reasons: async () => {
      assert.deepEqual(Object.keys(r3Expected.participants_only_reasons).sort(), [...r3Expected.participants_only_outcome_ids].sort());
      const asFaculty = async (id) => {
        const outcome = r3.outcomes.find((o) => o.fixture_id === id);
        return (await clients[outcome.faculty].get(`/api/outcomes/${ids.outcomes[id]}`)).data.outcome;
      };
      const r502 = await asFaculty("R-502");
      assert.equal(r502.confirmed, false);
      const r503 = await asFaculty("R-503");
      assert.equal(r503.confirmed, true);
      assert.equal(r503.showcased, false);
      assert.match(r503.publicStatus, /Mei Chen/);
    },
    notes: async () => {
      // "Discovery after evaluation shows only O-303", for visitors and signed-in users (R3-19).
      const r3Titles = new Set(r3.opportunities.map((o) => o.title));
      for (const client of [anon, clients["TEST-STUDENT"]]) {
        assert.deepEqual(
          (await discoveredTitles(client)).filter((title) => r3Titles.has(title)),
          r3Expected.still_open_opportunity_ids.map((id) => opportunity(id).title),
        );
      }
      // "All five lifecycle states occur in the fixture" (R3-11).
      const seen = new Set();
      for (const o of r3.opportunities) seen.add((await lifecycle(ids.records[o.fixture_id])).state);
      for (const state of ["expired", "withdrawn", "matched", "completed", "archived"]) assert.ok(seen.has(state), state);
    },
  };

  async function matchAsProposer(fixtureId) {
    const m = r3.matches.find((x) => x.fixture_id === fixtureId);
    const res = await clients[m.proposed_by].get(`/api/matches/${ids.matches[fixtureId]}`);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    return res.data.match;
  }

  async function matchStates(fixtureIds, state) {
    for (const id of fixtureIds) assert.equal((await matchAsProposer(id)).state, state, id);
  }

  const showcased = (outcomes) =>
    r3.outcomes.filter((o) => outcomes.some((x) => x.summary === o.summary)).map((o) => o.fixture_id);

  async function checkAllR3() {
    for (const [key, check] of Object.entries(r3Checks)) {
      try {
        await check();
      } catch (error) {
        error.message = `${key}: ${error.message}`;
        throw error;
      }
    }
  }

  test("seeding twice creates no duplicate records", async () => {
    assert.deepEqual(await rowCounts(), firstCounts);
  });

  test("every entry in the R3 expected results has a check", () => {
    assert.deepEqual(Object.keys(r3Checks).sort(), Object.keys(r3Expected).sort());
  });

  test("R3: every expected lifecycle, match and outcome result holds", checkAllR3);

  describe("R1 results still hold with R3 loaded", () => {
    test("visitors see exactly the expected_public R1 projects, and signed-in users the expected_authenticated ones", async () => {
      const listed = async (client) => new Set((await client.get("/api/projects")).data.projects.map((p) => p.id));
      const publicIds = await listed(anon);
      const signedInIds = await listed(clients["TEST-STUDENT"]);
      for (const p of r1.projects) {
        const id = ids.projects[p.fixture_id];
        assert.equal(publicIds.has(id), p.expected_public, `${p.fixture_id} public`);
        assert.equal(signedInIds.has(id), p.expected_public || p.expected_authenticated === true, `${p.fixture_id} signed in`);
        assert.equal((await anon.get(`/api/projects/${id}`)).status, p.expected_public ? 200 : 404, `${p.fixture_id} by URL`);
      }
    });

    test("faculty visibility follows public_profile and verified_faculty", async () => {
      const listed = async (client) => new Set((await client.get("/api/faculty")).data.faculty.map((f) => f.id));
      const publicIds = await listed(anon);
      const signedInIds = await listed(clients["TEST-STUDENT"]);
      for (const f of r1.faculty) {
        const id = ids.users[f.fixture_id];
        assert.equal(publicIds.has(id), f.verified_faculty && f.public_profile, `${f.fixture_id} public`);
        assert.equal(signedInIds.has(id), f.verified_faculty, `${f.fixture_id} signed in`);
      }
    });
  });

  describe("R2 results still hold with R3 loaded", () => {
    test("the accepted submissions are stored and the rejected one isn't", () => {
      assert.deepEqual(Object.keys(ids.submissions).sort(), [...r2Expected.accepted_submission_ids].sort());
      for (const id of r2Expected.rejected_submission_ids) assert.equal(ids.submissions[id], undefined, id);
    });

    test("notifications went to exactly the expected faculty, and never to F-MEI", async () => {
      for (const [fixtureId, facultyIds] of Object.entries(r2Expected.notified_faculty_by_submission)) {
        const rows = await t.db.query(
          `SELECT users.fixture_id FROM notifications JOIN users ON users.id = notifications.user_id WHERE submission_id = $1`,
          [ids.submissions[fixtureId]],
        );
        assert.deepEqual(rows.rows.map((r) => r.fixture_id).sort(), [...facultyIds].sort(), fixtureId);
      }
      for (const id of r2Expected.never_notified_faculty_ids) {
        const rows = await t.db.query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1", [ids.users[id]]);
        assert.equal(rows.rows[0].n, 0, id);
      }
    });

    test("F-MEI can still browse every accepted submission", async () => {
      const listed = new Set((await clients["F-MEI"].get("/api/partner-submissions")).data.submissions.map((s) => s.id));
      for (const id of r2Expected.accepted_submission_ids) assert.ok(listed.has(ids.submissions[id]), id);
    });

    test("no R2 submission is student-visible: the untrusted one awaits a supervisor and R3 removed the rest", async () => {
      const titles = new Set(loadIntakeFixture().map((s) => s.title).filter(Boolean));
      for (const client of [anon, clients["TEST-STUDENT"]]) {
        assert.deepEqual((await discoveredTitles(client)).filter((title) => titles.has(title)), r2Expected.student_visible_on_arrival);
      }
      const untrusted = await clients["F-MEI"].get(`/api/partner-submissions/${ids.submissions[r2Expected.untrusted_content_submission_id]}`);
      assert.equal(untrusted.data.submission.state.value, "awaiting_supervisor");
    });
  });

  describe("reseeding after an evaluator's walkthrough", () => {
    before(async () => {
      // The walkthrough from release_submission.md: a two-student match on O-303, a partner
      // agreement on O-301, and F-ALEX confirming R-502.
      const proposal = await clients["F-PRIYA"].post("/api/matches", {
        kind: "project",
        opportunityId: ids.records["O-303"].id,
        students: [fixtureEmail("S08"), fixtureEmail("S11")],
      });
      assert.equal(proposal.status, 201, JSON.stringify(proposal.data));
      for (const s of ["S08", "S11"]) {
        assert.equal((await clients[s].post(`/api/matches/${proposal.data.match.id}/confirm`)).status, 200, s);
      }
      const agreement = await clients["F-ALEX"].post(`/api/matches/partner-agreements/${ids.records["O-301"].id}`, { agreed: true });
      assert.equal(agreement.status, 201, JSON.stringify(agreement.data));
      assert.equal((await clients["F-ALEX"].post(`/api/outcomes/${ids.outcomes["R-502"]}/confirm`)).status, 200);
    });

    test("the walkthrough changed the results", async () => {
      assert.equal((await lifecycle(ids.records["O-303"])).state, "matched");
      assert.ok(showcased((await anon.get("/api/outcomes/showcase")).data.outcomes).includes("R-502"));
    });

    test("reseeding restores every expected result, and keeps the accounts signed in", async () => {
      await t.db.exec(buildAllFixtureSql());
      assert.deepEqual(await rowCounts(), firstCounts);
      ids = await lookupIds();
      await checkAllR3();
      assert.equal((await clients["F-PRIYA"].get("/api/auth/me")).data.authenticated, true);
    });
  });
});
