// R3-01 to R3-07, R3-21, R3-22: two-sided match confirmation and partner agreement records,
// checked against the R3 fixture's expected_lifecycle_results.json as of its evaluation_date
// (R3_PLAN.md D5 to D7).
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { after, before, describe, test } = require("node:test");
const { MATCH_NOTICE } = require("../src/routes/matches");
const { buildR2FixtureSql, buildR3FixtureSql, fixtureEmail, fixtureStudents, loadLifecycleFixture } = require("../src/fixture");
const { createClient, loadFixtureInto, signIn, startTestApp, uniqueEmail } = require("./helpers");

const fixture = loadLifecycleFixture();
const expected = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "r3_fixtures", "expected_lifecycle_results.json"), "utf8"),
);

async function startWithFixtures() {
  const t = await startTestApp({ config: { clockDate: fixture.evaluation_date } });
  await loadFixtureInto(t);
  await t.db.exec(buildR2FixtureSql());
  await t.db.exec(buildR3FixtureSql());
  return t;
}

async function matchId(t, fixtureId) {
  return (await t.db.query("SELECT id FROM matches WHERE fixture_id = $1", [fixtureId])).rows[0].id;
}

async function industryId(t, fixtureId) {
  const title = fixture.opportunities.find((o) => o.fixture_id === fixtureId).title;
  return (await t.db.query("SELECT id FROM partner_submissions WHERE fixture_id IS NOT NULL AND title = $1", [title])).rows[0].id;
}

async function projectId(t, fixtureId) {
  return (await t.db.query("SELECT id FROM projects WHERE fixture_id = $1", [fixtureId])).rows[0].id;
}

const student = (t, id) => signIn(t, fixtureEmail(id)).then((s) => s.client);

describe("matches in the R3 fixture", () => {
  let t;
  let alex;
  let jordan;
  let s01;
  let s08;
  let s17;

  before(async () => {
    t = await startWithFixtures();
    alex = (await signIn(t, fixtureEmail("F-ALEX"))).client;
    jordan = (await signIn(t, fixtureEmail("F-JORDAN"))).client;
    s01 = await student(t, "S01");
    s08 = await student(t, "S08");
    s17 = await student(t, "S17");
  });
  after(() => t.close());

  async function stateAs(client, fixtureId) {
    const res = await client.get(`/api/matches/${await matchId(t, fixtureId)}`);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    return res.data.match;
  }

  test("every student the fixture names is a fixture account with a student profile", async () => {
    const ids = fixtureStudents(fixture);
    assert.deepEqual(ids, ["S01", "S02", "S05", "S08", "S11", "S17"]);
    const rows = await t.db.query(
      `SELECT u.fixture_id, sp.display_name FROM users u JOIN student_profiles sp ON sp.user_id = u.id
       WHERE u.fixture_id = ANY($1::text[]) AND NOT u.is_verified_faculty AND NOT u.is_staff ORDER BY u.fixture_id`,
      [ids],
    );
    assert.deepEqual(rows.rows.map((r) => r.fixture_id), ids);
  });

  test("R3-02: fully confirmed matches are the expected ones", async () => {
    const managers = { "M-401": alex, "M-404": jordan };
    for (const id of expected.fully_confirmed_match_ids) {
      const match = await stateAs(managers[id], id);
      assert.equal(match.state, "confirmed", id);
      assert.equal(match.confirmedCount, match.students.length);
    }
  });

  test("R3-02: M-402 is only partly confirmed: S11 never confirmed", async () => {
    for (const id of expected.partly_confirmed_match_ids) {
      const match = await stateAs(alex, id);
      assert.equal(match.state, "partly_confirmed", id);
      assert.equal(match.label, "Partly confirmed");
      assert.match(match.summary, /1 of 2 students have confirmed/);
    }
  });

  test("R3-02: M-403 is not confirmed: its student declined", async () => {
    for (const id of expected.not_confirmed_match_ids) {
      const match = await stateAs(jordan, id);
      assert.equal(match.state, "declined", id);
      assert.notEqual(match.state, "confirmed");
    }
  });

  test("R3-05: a student sees who proposed it and who has confirmed", async () => {
    const res = await s08.get("/api/matches");
    assert.equal(res.status, 200);
    assert.equal(res.data.matches.length, 1);
    const [match] = res.data.matches;
    assert.equal(match.opportunity.title, "Anomaly review dashboard");
    assert.equal(match.proposedBy, "Dr. Alex Morgan");
    assert.deepEqual(
      match.students.map((s) => [s.email, s.response, s.isYou]),
      [
        [fixtureEmail("S08"), "confirmed", true],
        [fixtureEmail("S11"), "pending", false],
      ],
    );
    assert.equal(match.students[0].name, "Student S08");
    assert.equal(match.you.response, "confirmed");
  });

  test("R3-06: every match carries wording that rules out registration, credit and approval", async () => {
    const res = await s01.get("/api/matches");
    assert.equal(res.data.notice, MATCH_NOTICE);
    assert.equal(res.data.matches[0].notice, MATCH_NOTICE);
    assert.match(MATCH_NOTICE, /not course registration/);
    assert.match(MATCH_NOTICE, /eligibility, academic credit or any official approval/);
    const shown = JSON.stringify(res.data.matches.map((m) => [m.label, m.summary, m.students.map((s) => s.responseLabel)]));
    assert.doesNotMatch(shown, /approv|enrol|regist|credit|eligib/i);
  });

  test("a match on an expired opportunity can't be confirmed, so the expiry stands (R3-09)", async () => {
    const s11 = await student(t, "S11");
    const id = await matchId(t, "M-402");
    const before = (await s11.get(`/api/matches/${id}`)).data.match;
    assert.equal(before.you.canConfirm, false);
    assert.match(before.you.confirmBlockedReason, /expired/);
    const res = await s11.post(`/api/matches/${id}/confirm`);
    assert.equal(res.status, 409);
    assert.equal(res.data.code, "not_confirmable");
    const row = await t.db.query("SELECT response FROM match_students WHERE match_id = $1 AND student_email = $2", [
      id,
      fixtureEmail("S11"),
    ]);
    assert.equal(row.rows[0].response, "pending");
    // S11 can still decline: saying no is never blocked by the calendar.
    assert.equal(before.you.canDecline, true);
  });

  test("R3-04: a fully confirmed match can't be withdrawn or declined", async () => {
    const id = await matchId(t, "M-401");
    assert.equal((await alex.post(`/api/matches/${id}/withdraw`)).status, 409);
    assert.equal((await s01.post(`/api/matches/${id}/decline`)).status, 409);
    assert.equal((await stateAs(alex, "M-401")).state, "confirmed");
  });

  describe("R3-22: participation is never public", () => {
    test("only the match's students and managing faculty can open it", async () => {
      const staff = (await signIn(t, fixtureEmail("TEST-STAFF"))).client;
      const anon = createClient(t.baseUrl);
      const declined = await matchId(t, "M-403");
      for (const [who, client] of [
        ["another student", s01],
        ["unrelated faculty", alex],
        ["staff", staff],
      ]) {
        assert.equal((await client.get(`/api/matches/${declined}`)).status, 404, who);
      }
      assert.equal((await anon.get(`/api/matches/${declined}`)).status, 401);
      assert.equal((await s17.get(`/api/matches/${declined}`)).status, 200);
      assert.equal((await jordan.get(`/api/matches/${declined}`)).status, 200);
    });

    test("a student's list holds only their own matches", async () => {
      const res = await s17.get("/api/matches");
      assert.deepEqual(res.data.matches.map((m) => m.state), ["declined"]);
    });

    test("public discovery and detail pages never name a match's students", async () => {
      const anon = createClient(t.baseUrl);
      const pages = [
        await anon.get("/api/projects"),
        await anon.get("/api/opportunities"),
        await anon.get(`/api/projects/${await projectId(t, "O-303")}`),
        await anon.get(`/api/opportunities/${await industryId(t, "O-301")}`),
        await s08.get(`/api/opportunities/${await industryId(t, "O-302")}`),
      ];
      for (const page of pages) assert.doesNotMatch(JSON.stringify(page.data), /fixture-s\d\d|Student S\d\d/);
    });
  });

  describe("R3-07: partner agreement in principle", () => {
    test("a supervising faculty member records it, and the match's students see it as their statement", async () => {
      const id = await industryId(t, "O-301");
      const res = await alex.post(`/api/matches/partner-agreements/${id}`, { agreed: true, note: "Agreed by phone." });
      assert.equal(res.status, 201, JSON.stringify(res.data));
      assert.match(res.data.partnerAgreement.text, /^Partner agreed in principle, recorded by Dr\. Alex Morgan on \d+ \w+ \d{4}\.$/);
      assert.match(res.data.partnerAgreement.explanation, /doesn't use this system/);
      const seen = (await s01.get("/api/matches")).data.matches[0].partnerAgreement;
      assert.equal(seen.agreed, true);
      assert.equal(seen.note, "Agreed by phone.");
    });

    test("retracting adds a record and keeps the earlier one", async () => {
      const id = await industryId(t, "O-301");
      const res = await alex.post(`/api/matches/partner-agreements/${id}`, { agreed: false });
      assert.equal(res.data.partnerAgreement.agreed, false);
      assert.match(res.data.partnerAgreement.text, /retracted by Dr\. Alex Morgan/);
      const rows = await t.db.query(
        "SELECT agreed FROM partner_agreements pa JOIN opportunity_runs r ON r.id = pa.run_id WHERE r.submission_id = $1 ORDER BY pa.id",
        [id],
      );
      assert.deepEqual(rows.rows.map((r) => r.agreed), [true, false]);
    });

    test("only supervising faculty can record it, and only for industry opportunities", async () => {
      const o301 = await industryId(t, "O-301");
      const priya = (await signIn(t, fixtureEmail("F-PRIYA"))).client;
      const before = await t.db.query("SELECT count(*)::int AS n FROM partner_agreements");
      assert.equal((await jordan.post(`/api/matches/partner-agreements/${o301}`, { agreed: true })).status, 404);
      assert.equal((await s01.post(`/api/matches/partner-agreements/${o301}`, { agreed: true })).status, 403);
      assert.equal((await createClient(t.baseUrl).post(`/api/matches/partner-agreements/${o301}`, { agreed: true })).status, 401);
      // A faculty project's id is never treated as an industry opportunity.
      const o303 = await projectId(t, "O-303");
      assert.equal((await priya.post(`/api/matches/partner-agreements/${o303}`, { agreed: true })).status, 404);
      assert.equal((await alex.post(`/api/matches/partner-agreements/${o301}`, { agreed: "yes" })).status, 400);
      const afterCount = await t.db.query("SELECT count(*)::int AS n FROM partner_agreements");
      assert.equal(afterCount.rows[0].n, before.rows[0].n);
    });

    test("a renewed run starts with no agreement; the earlier run keeps its record and match (R3-12)", async () => {
      const id = await industryId(t, "O-301");
      await alex.post(`/api/matches/partner-agreements/${id}`, { agreed: true });
      assert.equal((await alex.post(`/api/lifecycle/industry/${id}/state`, { action: "complete" })).status, 200);
      const renewed = await alex.post(`/api/lifecycle/industry/${id}/renew`, { targetTerm: "Winter 2027", deadline: "2026-12-01" });
      assert.equal(renewed.status, 200, JSON.stringify(renewed.data));
      const manage = (await alex.get("/api/matches/manage")).data.opportunities.find((o) => o.kind === "industry" && o.id === id);
      assert.equal(manage.lifecycle.runNumber, 2);
      assert.equal(manage.partnerAgreement, null);
      assert.equal(manage.canPropose, true);
      const earlier = manage.matches.find((m) => m.run.runNumber === 1);
      assert.equal(earlier.state, "confirmed");
      assert.equal(earlier.run.current, false);
      assert.equal(earlier.partnerAgreement.agreed, true);
    });
  });
});

describe("proposing, confirming, declining and withdrawing (R3-01 to R3-05, R3-21)", () => {
  let t;
  let priya;
  let alex;
  let s08;
  let s11;
  let s05;
  let o303;

  before(async () => {
    t = await startWithFixtures();
    priya = (await signIn(t, fixtureEmail("F-PRIYA"))).client;
    alex = (await signIn(t, fixtureEmail("F-ALEX"))).client;
    s08 = await student(t, "S08");
    s11 = await student(t, "S11");
    s05 = await student(t, "S05");
    o303 = await projectId(t, "O-303");
  });
  after(() => t.close());

  const lifecycleOf = async (client = priya) => (await client.get(`/api/lifecycle/project/${o303}`)).data.item.lifecycle;
  const discoverable = async () => (await createClient(t.baseUrl).get("/api/projects")).data.projects.some((p) => p.id === o303);
  const matchRows = async () => (await t.db.query("SELECT count(*)::int AS n FROM matches")).rows[0].n;

  describe("R3-01, R3-21: who can propose", () => {
    test("students, staff and visitors can't propose", async () => {
      const staff = (await signIn(t, fixtureEmail("TEST-STAFF"))).client;
      const body = { kind: "project", opportunityId: o303, students: [fixtureEmail("S05")] };
      const n = await matchRows();
      assert.equal((await s08.post("/api/matches", body)).status, 403);
      assert.equal((await staff.post("/api/matches", body)).status, 403);
      assert.equal((await createClient(t.baseUrl).post("/api/matches", body)).status, 401);
      assert.equal(await matchRows(), n);
    });

    test("faculty can't propose on an opportunity they don't manage", async () => {
      const n = await matchRows();
      const res = await alex.post("/api/matches", { kind: "project", opportunityId: o303, students: [fixtureEmail("S05")] });
      assert.equal(res.status, 404);
      // A bogus kind or id is also just "not found".
      assert.equal((await priya.post("/api/matches", { kind: "secret", opportunityId: o303, students: ["a@algomau.ca"] })).status, 404);
      assert.equal((await priya.post("/api/matches", { kind: "project", opportunityId: "1 OR 1=1", students: ["a@algomau.ca"] })).status, 404);
      assert.equal(await matchRows(), n);
    });

    test("only open opportunities take proposals", async () => {
      for (const [client, kind, id] of [
        [alex, "industry", await industryId(t, "O-302")], // expired
        [priya, "project", await projectId(t, "O-305")], // withdrawn
        [priya, "project", await projectId(t, "O-307")], // archived
      ]) {
        const res = await client.post("/api/matches", { kind, opportunityId: id, students: [fixtureEmail("S05")] });
        assert.equal(res.status, 409, `${kind} ${id}`);
        assert.equal(res.data.code, "not_open");
      }
    });

    test("students must be named by valid university email, and can't be faculty, staff or the proposer", async () => {
      const cases = [
        [[], /at least one student/],
        ["fixture-s05@algomau.ca", /at least one student/],
        [["someone@gmail.com"], /isn't an @algomau\.ca email/],
        [["not an email"], /isn't an @algomau\.ca email/],
        [[fixtureEmail("F-ALEX")], /faculty or staff account/],
        [[fixtureEmail("TEST-STAFF")], /faculty or staff account/],
        [[fixtureEmail("F-PRIYA")], /yourself/],
        [Array.from({ length: 11 }, (_, i) => `student${i}@algomau.ca`), /at most 10/],
      ];
      for (const [students, message] of cases) {
        const res = await priya.post("/api/matches", { kind: "project", opportunityId: o303, students });
        assert.equal(res.status, 400, JSON.stringify(students));
        assert.match(res.data.error, message);
      }
    });
  });

  describe("a two-student match on O-303", () => {
    let id;

    test("R3-01: a verified faculty member proposes it; the proposer comes from the session", async () => {
      const res = await priya.post("/api/matches", {
        kind: "project",
        opportunityId: o303,
        students: [` ${fixtureEmail("S08").toUpperCase()} `, fixtureEmail("S11"), fixtureEmail("S11")],
        proposedBy: (await t.db.query("SELECT id FROM users WHERE fixture_id = 'F-ALEX'")).rows[0].id,
        state: "confirmed",
      });
      assert.equal(res.status, 201, JSON.stringify(res.data));
      id = res.data.match.id;
      assert.equal(res.data.match.state, "proposed");
      assert.equal(res.data.match.proposedBy, "Dr. Priya Shah");
      assert.deepEqual(res.data.match.students.map((s) => [s.email, s.response]), [
        [fixtureEmail("S08"), "pending"],
        [fixtureEmail("S11"), "pending"],
      ]);
      assert.equal(res.data.match.you.canWithdraw, true);
    });

    test("R3-01: a student can't be on two live matches for the same opportunity", async () => {
      const res = await priya.post("/api/matches", { kind: "project", opportunityId: o303, students: [fixtureEmail("S11")] });
      assert.equal(res.status, 409);
      assert.equal(res.data.code, "already_matched");
    });

    test("R3-05: the students see the proposal and what to do", async () => {
      const mine = (await s11.get("/api/matches")).data.matches.find((m) => m.id === id);
      assert.equal(mine.state, "proposed");
      assert.equal(mine.you.canConfirm, true);
      assert.equal(mine.you.canDecline, true);
      assert.equal(mine.you.canWithdraw, false);
    });

    test("R3-03: faculty can't confirm for a student, and uninvited students can't confirm", async () => {
      assert.equal((await priya.post(`/api/matches/${id}/confirm`)).status, 403);
      assert.equal((await s05.post(`/api/matches/${id}/confirm`)).status, 404);
      assert.equal((await s05.post("/api/matches/999999/confirm")).status, 404);
      const rows = await t.db.query("SELECT response FROM match_students WHERE match_id = $1", [id]);
      assert.ok(rows.rows.every((r) => r.response === "pending"));
    });

    test("R3-02: one confirmation makes it partly confirmed, and the opportunity stays open", async () => {
      // The body can't name another student: only the session's own answer changes (R3-03).
      const res = await s08.post(`/api/matches/${id}/confirm`, { email: fixtureEmail("S11") });
      assert.equal(res.status, 200);
      assert.equal(res.data.match.state, "partly_confirmed");
      assert.deepEqual(res.data.match.students.map((s) => s.response), ["confirmed", "pending"]);
      assert.equal((await s08.post(`/api/matches/${id}/confirm`)).data.code, "already_answered");
      assert.equal((await lifecycleOf()).state, "open");
      assert.equal(await discoverable(), true);
    });

    test("R3-02, R3-10: when every student confirms, it is confirmed and the opportunity is matched", async () => {
      const res = await s11.post(`/api/matches/${id}/confirm`);
      assert.equal(res.data.match.state, "confirmed");
      assert.equal((await lifecycleOf()).state, "matched");
      assert.equal(await discoverable(), false);
      // Matched opportunities take no new proposals.
      const again = await priya.post("/api/matches", { kind: "project", opportunityId: o303, students: [fixtureEmail("S05")] });
      assert.equal(again.data.code, "not_open");
    });
  });

  describe("R3-04: declining and withdrawing leave a record", () => {
    let projectIdNew;

    before(async () => {
      // A second open project of Priya's, so these don't depend on O-303.
      const created = await priya.post("/api/projects", {
        title: "Wayfinding sign audit",
        description: "Survey campus signs.",
        researchAreas: ["Human-Computer Interaction"],
        targetTerm: "Winter 2027",
        deadline: "2026-12-15",
      });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      projectIdNew = created.data.project.id;
      assert.equal((await priya.post(`/api/projects/${projectIdNew}/publish`)).status, 200);
    });

    const propose = async (students) => {
      const res = await priya.post("/api/matches", { kind: "project", opportunityId: projectIdNew, students });
      assert.equal(res.status, 201, JSON.stringify(res.data));
      return res.data.match.id;
    };

    test("a student declines, even after confirming, until everyone has confirmed", async () => {
      const id = await propose([fixtureEmail("S05"), fixtureEmail("S08")]);
      await s05.post(`/api/matches/${id}/confirm`);
      const res = await s05.post(`/api/matches/${id}/decline`);
      assert.equal(res.status, 200);
      assert.equal(res.data.match.state, "declined");
      const row = (await t.db.query("SELECT response, responded_at FROM match_students WHERE match_id = $1 AND student_email = $2", [
        id,
        fixtureEmail("S05"),
      ])).rows[0];
      assert.equal(row.response, "declined");
      assert.ok(row.responded_at);
      // Nothing more can happen to a declined match, and the faculty member still sees it.
      assert.equal((await s08.post(`/api/matches/${id}/confirm`)).status, 409);
      assert.equal((await priya.post(`/api/matches/${id}/withdraw`)).status, 409);
      assert.equal((await priya.get(`/api/matches/${id}`)).data.match.state, "declined");
    });

    test("after a decline, the students can be proposed again", async () => {
      const id = await propose([fixtureEmail("S05")]);
      assert.ok(id);
    });

    test("the managing faculty member withdraws a proposal; the record stays", async () => {
      const id = await propose([fixtureEmail("S11")]);
      assert.equal((await alex.post(`/api/matches/${id}/withdraw`)).status, 404);
      assert.equal((await s11.post(`/api/matches/${id}/withdraw`)).status, 403);
      const res = await priya.post(`/api/matches/${id}/withdraw`);
      assert.equal(res.status, 200);
      assert.equal(res.data.match.state, "withdrawn");
      assert.equal(res.data.match.withdrawnBy, "Dr. Priya Shah");
      assert.ok(res.data.match.withdrawnAt);
      assert.equal((await s11.post(`/api/matches/${id}/confirm`)).status, 409);
      assert.equal((await s11.get(`/api/matches/${id}`)).data.match.state, "withdrawn");
      assert.equal((await lifecycleOf()).state, "matched");
    });
  });

  describe("student profiles (D5)", () => {
    test("a student's display name is shown on their matches", async () => {
      const email = uniqueEmail("newstudent");
      const { client } = await signIn(t, email);
      assert.deepEqual((await client.get("/api/account/student-profile")).data.profile, null);
      const bad = await client.put("/api/account/student-profile", { displayName: " ", allowPublicProfile: false });
      assert.equal(bad.data.field, "displayName");
      const noChoice = await client.put("/api/account/student-profile", { displayName: "Sam Rivera" });
      assert.equal(noChoice.data.field, "allowPublicProfile");
      const saved = await client.put("/api/account/student-profile", { displayName: "  Sam   Rivera ", allowPublicProfile: false });
      assert.equal(saved.status, 200);
      assert.equal(saved.data.profile.displayName, "Sam Rivera");

      // Proposed before or after signing in, the match shows the student's name.
      const project = (await priya.get("/api/matches/manage")).data.opportunities.find((o) => o.canPropose);
      const res = await priya.post("/api/matches", { kind: project.kind, opportunityId: project.id, students: [email] });
      assert.equal(res.data.match.students[0].name, "Sam Rivera");
      assert.equal((await client.get("/api/matches")).data.matches.length, 1);
    });

    test("faculty use their faculty profile instead", async () => {
      assert.equal((await priya.get("/api/account/student-profile")).status, 403);
      assert.equal((await priya.put("/api/account/student-profile", { displayName: "X", allowPublicProfile: true })).status, 403);
    });
  });
});
