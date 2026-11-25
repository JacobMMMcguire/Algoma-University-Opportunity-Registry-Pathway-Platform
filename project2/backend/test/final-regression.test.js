// F-06 to F-12, F-25: the Final Release fixtures (project2/final_fixtures/) on top of R1 to R3,
// exactly as `npm run seed:fixture` loads them, with the clock at the R3 evaluation_date. Every
// key of expected_final_results.json is checked (the test fails if the file gains one nothing
// checks). Each recovery case is then corrected through the product by an authorised user, and
// a reseed must put every case back in its starting state.
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { after, before, describe, test } = require("node:test");
const { buildAllFixtureSql, fixtureEmail, loadFinalFixtures, loadLifecycleFixture } = require("../src/fixture");
const { createClient, signIn, startTestApp } = require("./helpers");

const { recovery, stale, expected } = loadFinalFixtures();
const scale = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "final_fixtures", "scale_fixture.json"), "utf8"));
const r3 = loadLifecycleFixture();
const opportunity = (fixtureId) => r3.opportunities.find((o) => o.fixture_id === fixtureId);
const recoveryCase = (id) => recovery.cases.find((c) => c.case_id === id);

describe("Final Release fixtures, as seeded for evaluation", () => {
  let t;
  let ids;
  let as;
  let anon;
  const checked = new Set();

  async function lookupIds() {
    const rows = async (sql) => (await t.db.query(sql)).rows;
    const by = (list) => Object.fromEntries(list.map((r) => [r.fixture_id, r.id]));
    const submissions = await rows("SELECT id, title FROM partner_submissions WHERE fixture_id IS NOT NULL");
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
      users: by(await rows("SELECT id, fixture_id FROM users WHERE fixture_id IS NOT NULL")),
      matches: by(await rows("SELECT id, fixture_id FROM matches WHERE fixture_id IS NOT NULL")),
      outcomes: by(await rows("SELECT id, fixture_id FROM outcomes WHERE fixture_id IS NOT NULL")),
    };
  }

  before(async () => {
    t = await startTestApp({ config: { clockDate: r3.evaluation_date } });
    await t.db.exec(buildAllFixtureSql());
    ids = await lookupIds();
    anon = createClient(t.baseUrl);
    as = {};
    for (const id of ["TEST-STAFF", "F-ALEX", "F-PRIYA", "F-JORDAN", "S01", "S02", "S05"]) {
      as[id] = (await signIn(t, fixtureEmail(id))).client;
    }
  });
  after(() => t.close());

  const stateOf = async (fixtureId) => {
    const { kind, id } = ids.records[fixtureId];
    const res = await as["TEST-STAFF"].get(`/api/lifecycle/${kind}/${id}`);
    assert.equal(res.status, 200, `${fixtureId}: ${JSON.stringify(res.data)}`);
    return res.data.item.lifecycle.state;
  };
  const matchState = async (fixtureId) => (await as["F-JORDAN"].get(`/api/matches/${ids.matches[fixtureId]}`)).data.match.state;
  const engagementOf = async (fixtureId) =>
    (await as["F-JORDAN"].get(`/api/partner-submissions/${ids.records[fixtureId].id}`)).data.submission.engagement.value;
  const showcased = async (fixtureId) => (await anon.get("/api/outcomes/showcase")).data.outcomes.some((o) => o.id === ids.outcomes[fixtureId]);
  const history = async (subjectType, subjectId) =>
    (await as["TEST-STAFF"].get(`/api/operations/history?subjectType=${subjectType}&subjectId=${subjectId}&limit=50`)).data.events;
  const runChanges = async (fixtureId) => {
    const { kind, id } = ids.records[fixtureId];
    return (await as["TEST-STAFF"].get(`/api/lifecycle/${kind}/${id}`)).data.history.flatMap((r) => r.changes);
  };

  test("the Final fixtures are the course's final-v1 files", () => {
    assert.equal(expected.fixture_version, "final-v1");
    assert.equal(recovery.fixture_version, "final-v1");
    assert.equal(stale.fixture_version, "final-v1");
    checked.add("fixture_version");
  });

  describe("F-09 to F-12: stale people", () => {
    test("departed_faculty_ids: out of the directory and contact, can't act as faculty, profile kept and marked", async () => {
      for (const fid of expected.departed_faculty_ids) {
        const userId = ids.users[fid];
        for (const client of [anon, as.S01]) {
          assert.ok(!(await client.get("/api/faculty")).data.faculty.some((f) => f.id === userId), `${fid} not in the directory`);
          const profile = await client.get(`/api/faculty/${userId}`);
          assert.equal(profile.status, 200, `${fid}'s profile page is kept`);
          assert.equal(profile.data.profile.departed, true);
          assert.equal(profile.data.profile.contact, null);
          assert.match(profile.data.profile.departureNote, /No longer at Algoma University/);
        }
        // Not named as a supervisor anywhere students look.
        const industry = (await as.S01.get("/api/opportunities")).data.opportunities;
        assert.ok(!industry.some((o) => o.supervisors.some((s) => s.id === userId)));
        assert.ok(!(await as.S01.get("/api/projects")).data.projects.some((p) => p.faculty.id === userId));
        // They can still sign in, but no longer act as faculty (F-10).
        assert.equal((await as[fid].get("/api/projects/mine")).status, 403);
        const me = (await as[fid].get("/api/auth/me")).data.user;
        assert.equal(me.departure, "left");
        assert.equal(me.isVerifiedFaculty, false);
        // Nothing was deleted (F-09): the account and their attached records remain.
        const attached = stale.people.find((p) => p.person_id === fid).still_attached;
        for (const o of attached.opportunities) assert.ok(ids.records[o].id, `${o} still exists`);
        for (const r of attached.outcomes) assert.ok(ids.outcomes[r], `${r} still exists`);
      }
      checked.add("departed_faculty_ids");
    });

    test("must_survive_departure: their work stays meaningful and attributed", async () => {
      for (const [person, outcomes] of Object.entries(expected.must_survive_departure)) {
        for (const r of outcomes) {
          const id = ids.outcomes[r];
          assert.ok(id, `${r} exists`);
          // A participant other than the departed person can still open it.
          const viewer = person === "S02" ? as["F-JORDAN"] : as.S01;
          const res = await viewer.get(`/api/outcomes/${id}`);
          assert.equal(res.status, 200, `${r}: ${JSON.stringify(res.data)}`);
          const names = res.data.outcome.participants.map((p) => p.email);
          assert.ok(names.includes(fixtureEmail(person)), `${r} is still attributed to ${person}`);
        }
      }
      // R-501 was showcased in R3 and stays showcased though S02 graduated (consent permitting).
      assert.equal(await showcased("R-501"), true);
      checked.add("must_survive_departure");
    });

    test("not_accepting_faculty_ids: profile and work stay visible, never offered as someone to approach", async () => {
      for (const fid of expected.not_accepting_faculty_ids) {
        const userId = ids.users[fid];
        const listed = (await anon.get("/api/faculty")).data.faculty.find((f) => f.id === userId);
        assert.ok(listed, `${fid} stays in the directory`);
        const profile = (await anon.get(`/api/faculty/${userId}`)).data.profile;
        assert.equal(profile.departed, false);
        assert.equal(profile.contact, null);
        assert.equal(profile.contactViaProjects, false);
        assert.match(profile.inquiryPreference.label, /not currently accepting/i);
        for (const o of stale.people.find((p) => p.person_id === fid).still_attached.opportunities) {
          const { kind, id } = ids.records[o];
          const res = await as.S01.get(kind === "project" ? `/api/projects/${id}` : `/api/opportunities/${id}`);
          const record = res.data.project || res.data.removed;
          assert.ok(record, `${o} is still recognisable`);
          if (res.data.project) assert.equal(res.data.project.contact, null, `${o} offers no contact`);
        }
      }
      checked.add("not_accepting_faculty_ids");
    });

    test("graduated_student_ids: shown as alumni, attached work kept, not proposed new work", async () => {
      for (const sid of expected.graduated_student_ids) {
        const student = await as.S01.get(`/api/students/${ids.users[sid]}`);
        assert.equal(student.status, 200);
        assert.equal(student.data.student.alumni, true);
        assert.equal((await as[sid].get("/api/auth/me")).data.user.departure, "graduated");
        const projectId = (await t.db.query("SELECT id FROM projects WHERE fixture_id = 'O-303'")).rows[0].id;
        const proposed = await as["F-PRIYA"].post("/api/matches", { kind: "project", opportunityId: projectId, students: [fixtureEmail(sid)] });
        assert.notEqual(proposed.status, 201);
      }
      checked.add("graduated_student_ids");
    });

    test("control_faculty_ids: unchanged, with their attached work as in R3", async () => {
      for (const fid of expected.control_faculty_ids) {
        const userId = ids.users[fid];
        const profile = (await anon.get(`/api/faculty/${userId}`)).data.profile;
        assert.equal(profile.departed, false);
        assert.ok(profile.contact, `${fid} can still be contacted`);
        assert.ok((await anon.get("/api/faculty")).data.faculty.some((f) => f.id === userId));
        assert.equal((await as[fid].get("/api/projects/mine")).status, 200);
        const attached = stale.people.find((p) => p.person_id === fid).still_attached;
        for (const o of attached.opportunities) assert.equal(await stateOf(o), opportunity(o).state === "completed" ? "completed" : "expired", o);
        for (const r of attached.outcomes) assert.equal(await showcased(r), true, r);
      }
      checked.add("control_faculty_ids");
    });

    test("orphaned_opportunity_ids: marked, out of discovery with a reason, and reassignable by staff (F-11)", async () => {
      assert.match(expected.orphaned_reason, /F-ALEX/);
      checked.add("orphaned_reason");
      for (const o of expected.orphaned_opportunity_ids) {
        const { kind, id } = ids.records[o];
        assert.equal(await stateOf(o), "needs_supervisor");
        const list = kind === "project" ? "/api/projects" : "/api/opportunities";
        assert.ok(!(await as.S01.get(list)).data[kind === "project" ? "projects" : "opportunities"].some((r) => r.id === id));
        const item = (await as["TEST-STAFF"].get(`/api/lifecycle/${kind}/${id}`)).data.item;
        assert.equal(item.canReassign, true);
        assert.match(item.lifecycle.reason, /no longer at Algoma University/);
        // F-ALEX's other opportunity, O-301, is matched, so it isn't advertised and isn't an orphan.
        assert.equal(await stateOf("O-301"), "matched");
      }
      checked.add("orphaned_opportunity_ids");
    });
  });

  test("scale_counts: the scale fixture has the counts the expected results give (F-17)", () => {
    assert.equal(scale.faculty.length, expected.scale_counts.faculty);
    assert.equal(scale.students.length, expected.scale_counts.students);
    assert.equal(scale.faculty.length + scale.students.length, expected.scale_counts.people_total);
    assert.equal(scale.opportunities.length, expected.scale_counts.opportunities);
    // Loading it through the app's routes is checked in test/scale.test.js.
    checked.add("scale_counts");
  });

  test("notes: F-JORDAN is the control and RC-03 reverses a confirmed match", () => {
    assert.ok(expected.notes.some((n) => /F-JORDAN is the control/.test(n)));
    assert.ok(expected.notes.some((n) => /RC-03 reverses a CONFIRMED match/.test(n)));
    checked.add("notes");
  });

  describe("F-06 to F-08: every recovery case is corrected through the product", () => {
    const before = {};

    test("each case starts in its wrong state", async () => {
      assert.equal(await stateOf("O-303"), recoveryCase("RC-01").wrong_state);
      assert.equal(await stateOf("O-305"), recoveryCase("RC-02").wrong_state);
      assert.equal(await matchState("M-404"), recoveryCase("RC-03").wrong_state);
      assert.equal(await engagementOf("O-302"), recoveryCase("RC-04").wrong_state.replace(/-/g, "_"));
      assert.equal(await showcased("R-501"), true, "RC-05 starts public");
      before.ids = JSON.stringify(await lookupIds());
    });

    test("RC-01: staff set a later Centre deadline, so O-303 is open again", async () => {
      const { id } = ids.records["O-303"];
      const res = await as["TEST-STAFF"].put(`/api/lifecycle/project/${id}/centre-deadline`, { centreDeadline: "2026-12-15" });
      assert.equal(res.status, 200, JSON.stringify(res.data));
      assert.equal(await stateOf("O-303"), recoveryCase("RC-01").intended_state);
      assert.ok((await as.S01.get("/api/projects")).data.projects.some((p) => p.id === id), "back in discovery");
      const change = (await runChanges("O-303")).find((c) => c.change === "centre_deadline");
      assert.ok(change.byStaff && change.at);
    });

    test("RC-02: the owner reopens O-305 with a new deadline", async () => {
      const { id } = ids.records["O-305"];
      const res = await as["F-PRIYA"].post(`/api/lifecycle/project/${id}/state`, { action: "reopen", deadline: "2026-12-01" });
      assert.equal(res.status, 200, JSON.stringify(res.data));
      assert.equal(await stateOf("O-305"), recoveryCase("RC-02").intended_state);
      assert.ok((await runChanges("O-305")).some((c) => c.change === "state" && c.detail === "withdrawn to open" && c.by === "Dr. Priya Shah"));
    });

    test("RC-04: another verified faculty member corrects O-302's engagement; the mistaken value is kept", async () => {
      const { id } = ids.records["O-302"];
      const res = await as["F-JORDAN"].put(`/api/partner-submissions/${id}/engagement`, { state: "not_contacted" });
      assert.equal(res.status, 200);
      assert.equal(await engagementOf("O-302"), recoveryCase("RC-04").intended_state.replace(/-/g, "_"));
      const [event] = await history("partner_submission", id);
      assert.deepEqual([event.action, event.detail.from, event.detail.to, event.by], ["engagement.set", "partner_confirmed", "not_contacted", "Dr. Jordan Lee"]);
    });

    test("RC-05: the confirming faculty member takes R-501 back to participants only", async () => {
      const id = ids.outcomes["R-501"];
      assert.equal((await as["F-JORDAN"].post(`/api/outcomes/${id}/unconfirm`)).status, 200);
      assert.equal(await showcased("R-501"), false);
      assert.equal((await anon.get(`/api/outcomes/${id}`)).status, 404);
      assert.equal((await as.S02.get(`/api/outcomes/${id}`)).status, 200, "its participants still see it");
      const [event] = await history("outcome", id);
      assert.equal(event.action, "outcome.unconfirm");
    });

    test("RC-03: the managing faculty member undoes the mistaken confirmation of M-404", async () => {
      const id = ids.matches["M-404"];
      const res = await as["F-JORDAN"].post(`/api/matches/${id}/undo-confirmation`, { studentEmail: fixtureEmail("S02") });
      assert.equal(res.status, 200, JSON.stringify(res.data));
      assert.equal(res.data.match.state, recoveryCase("RC-03").intended_state);
      const [event] = await history("match", id);
      assert.deepEqual([event.action, event.detail.studentEmail, event.by], ["match.undo_confirmation", fixtureEmail("S02"), "Dr. Jordan Lee"]);
    });

    test("recovery_expectations: same identifiers, nothing deleted and recreated, history kept", async () => {
      assert.equal(JSON.stringify(await lookupIds()), before.ids, "every record keeps its identifier");
      assert.equal(expected.recovery_expectations.length, 4);
      checked.add("recovery_expectations");
      assert.deepEqual(recovery.cases.map((c) => c.case_id), expected.recoverable_case_ids);
      checked.add("recoverable_case_ids");
    });

    test("F-11: staff reassign the orphaned O-302 to a faculty member who agreed", async () => {
      const { id } = ids.records["O-302"];
      const url = `/api/lifecycle/industry/${id}/reassign`;
      assert.equal((await as["F-JORDAN"].post(url, { facultyUserId: ids.users["F-JORDAN"], agreed: true })).status, 403);
      assert.equal((await as["TEST-STAFF"].post(url, { facultyUserId: ids.users["F-JORDAN"] })).status, 400, "needs their agreement");
      assert.equal((await as["TEST-STAFF"].post(url, { facultyUserId: ids.users["F-ALEX"], agreed: true })).status, 400, "not to someone who left");
      const res = await as["TEST-STAFF"].post(url, { facultyUserId: ids.users["F-JORDAN"], agreed: true });
      assert.equal(res.status, 200, JSON.stringify(res.data));
      // Its deadline passed long ago, so it is now plainly Expired, which Jordan can renew or reopen.
      assert.equal(res.data.item.lifecycle.state, "expired");
      assert.equal((await as["F-JORDAN"].get(`/api/lifecycle/industry/${id}`)).status, 200, "Jordan manages it now");
      const [event] = await history("partner_submission", id);
      assert.deepEqual([event.action, event.detail.toUserId], ["opportunity.reassign", ids.users["F-JORDAN"]]);
    });

    test("a reseed puts every case back in its starting state", async () => {
      await t.db.exec(buildAllFixtureSql());
      // Opportunities and people keep their ids. (The R3 seed recreates fixture matches and
      // outcomes, so theirs are new; their fixture ids are what identify them.)
      const now = await lookupIds();
      const was = JSON.parse(before.ids);
      assert.deepEqual(now.records, was.records);
      assert.deepEqual(now.users, was.users);
      ids = now;
      assert.equal(await stateOf("O-303"), "expired");
      assert.equal(await stateOf("O-305"), "withdrawn");
      assert.equal(await matchState("M-404"), "confirmed");
      assert.equal(await engagementOf("O-302"), "partner_confirmed");
      assert.equal(await showcased("R-501"), true);
      assert.equal(await stateOf("O-302"), "needs_supervisor");
    });
  });

  test("every key in expected_final_results.json is checked", () => {
    assert.deepEqual([...checked].sort(), Object.keys(expected).sort());
  });
});
