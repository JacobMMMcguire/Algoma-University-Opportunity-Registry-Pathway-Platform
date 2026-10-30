// R3-14 to R3-18, R3-20, R3-21: outcomes, faculty confirmation and the showcase, checked against
// the R3 fixture's expected_lifecycle_results.json (R3_PLAN.md D8).
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { after, before, describe, test } = require("node:test");
const { buildR2FixtureSql, buildR3FixtureSql, fixtureEmail, loadIntakeFixture, loadLifecycleFixture } = require("../src/fixture");
const { createClient, loadFixtureInto, signIn, startTestApp } = require("./helpers");

const fixture = loadLifecycleFixture();
const expected = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "r3_fixtures", "expected_lifecycle_results.json"), "utf8"),
);
const summaryOf = (fixtureId) => fixture.outcomes.find((o) => o.fixture_id === fixtureId).summary;

describe("outcomes and the showcase (R3 fixture)", () => {
  let t;
  let anon;
  let jordan;
  let alex;
  let mei;
  let s01;
  let s02;
  let s05;
  let s17;
  let ids;

  before(async () => {
    t = await startTestApp({ config: { clockDate: fixture.evaluation_date } });
    await loadFixtureInto(t);
    await t.db.exec(buildR2FixtureSql());
    await t.db.exec(buildR3FixtureSql());
    anon = createClient(t.baseUrl);
    jordan = (await signIn(t, fixtureEmail("F-JORDAN"))).client;
    alex = (await signIn(t, fixtureEmail("F-ALEX"))).client;
    mei = (await signIn(t, fixtureEmail("F-MEI"))).client;
    s01 = (await signIn(t, fixtureEmail("S01"))).client;
    s02 = (await signIn(t, fixtureEmail("S02"))).client;
    s05 = (await signIn(t, fixtureEmail("S05"))).client;
    s17 = (await signIn(t, fixtureEmail("S17"))).client;
    const rows = await t.db.query("SELECT id, fixture_id FROM outcomes WHERE fixture_id IS NOT NULL");
    ids = Object.fromEntries(rows.rows.map((r) => [r.fixture_id, r.id]));
    const users = await t.db.query("SELECT id, fixture_id FROM users WHERE fixture_id IS NOT NULL");
    ids.users = Object.fromEntries(users.rows.map((r) => [r.fixture_id, r.id]));
  });
  after(() => t.close());

  const showcase = async (client = anon, query = "") => (await client.get(`/api/outcomes/showcase${query}`)).data.outcomes;
  const fixtureShown = (outcomes) =>
    fixture.outcomes.filter((o) => outcomes.some((x) => x.summary === o.summary)).map((o) => o.fixture_id);

  describe("as loaded", () => {
    test("R3-15, R3-16: only the expected outcomes are in the showcase, for visitors and signed-in users", async () => {
      assert.deepEqual(fixtureShown(await showcase()), expected.showcase_eligible_outcome_ids);
      assert.deepEqual(fixtureShown(await showcase(s17)), expected.showcase_eligible_outcome_ids);
    });

    test("R3-15, R3-16: participants-only outcomes can't be opened by anyone else", async () => {
      for (const id of expected.participants_only_outcome_ids) {
        assert.equal((await anon.get(`/api/outcomes/${ids[id]}`)).status, 404, id);
        assert.equal((await s17.get(`/api/outcomes/${ids[id]}`)).status, 404, id);
        assert.equal((await jordan.get(`/api/outcomes/${ids["R-502"]}`)).status, 404);
      }
    });

    test("R3-15: R-502 awaits confirmation, and its participants are told so", async () => {
      const res = await s01.get(`/api/outcomes/${ids["R-502"]}`);
      assert.equal(res.status, 200);
      assert.equal(res.data.outcome.confirmed, false);
      assert.equal(res.data.outcome.showcased, false);
      assert.match(res.data.outcome.publicStatus, /once a faculty member on it confirms it/);
    });

    test("R3-16: R-503 is confirmed but stays private, because F-MEI doesn't allow public display", async () => {
      for (const client of [s02, mei]) {
        const { outcome } = (await client.get(`/api/outcomes/${ids["R-503"]}`)).data;
        assert.equal(outcome.confirmed, true);
        assert.equal(outcome.showcased, false);
        assert.match(outcome.publicStatus, /Dr\. Mei Chen doesn't allow public display/);
      }
    });

    test("R3-16: the showcase never shows partner contact details, emails or non-public faculty", async () => {
      const partner = loadIntakeFixture().find((s) => s.title === "Shift handover notes");
      const text = JSON.stringify(await showcase(s17));
      assert.match(text, /Northwind Robotics/);
      for (const hidden of [partner.contact_name, partner.contact_email, "@algomau.ca", "Mei Chen"]) {
        assert.ok(!text.includes(hidden), hidden);
      }
    });

    test("R3-20: visitors can browse completed work and reach the faculty involved", async () => {
      const [r501] = await showcase();
      assert.equal(r501.summary, summaryOf("R-501"));
      assert.equal(r501.completedOn, "2026-08-20");
      assert.deepEqual(r501.links, [{ kind: "repo", label: "Code repository", url: "https://github.com/example/handover" }]);
      assert.deepEqual(r501.faculty, [{ id: ids.users["F-JORDAN"], displayName: "Dr. Jordan Lee" }]);
      assert.equal((await anon.get(`/api/faculty/${r501.faculty[0].id}`)).status, 200);
      assert.equal((await anon.get(`/api/outcomes/${ids["R-501"]}`)).status, 200);
      // S02 hasn't chosen public display, so visitors aren't told who they are.
      assert.deepEqual(r501.students, []);
      assert.equal(r501.otherStudents, 1);
      assert.deepEqual((await showcase(s17))[0].students, [{ id: ids.users.S02, displayName: "Student S02" }]);
    });

    test("R3-17: confirmed public outcomes are on the faculty member's profile, and R-503 isn't on F-MEI's", async () => {
      assert.deepEqual(fixtureShown(await showcase(anon, `?facultyId=${ids.users["F-JORDAN"]}`)), ["R-501"]);
      assert.deepEqual(await showcase(s17, `?facultyId=${ids.users["F-MEI"]}`), []);
      assert.deepEqual(await showcase(anon, `?facultyId=${ids.users["F-ALEX"]}`), []);
      assert.equal((await anon.get("/api/outcomes/showcase?facultyId=abc")).status, 400);
    });
  });

  describe("R3-17, R3-18: student profiles", () => {
    test("a student's profile lists their outcomes; visitors see it only if the student chose public display", async () => {
      const s02Id = ids.users.S02;
      assert.equal((await anon.get(`/api/students/${s02Id}`)).status, 404);
      assert.equal((await s17.get(`/api/students/${s02Id}`)).status, 200);
      assert.deepEqual(await showcase(anon, `?studentId=${s02Id}`), []);
      assert.deepEqual(fixtureShown(await showcase(s17, `?studentId=${s02Id}`)), ["R-501"]);

      await s02.put("/api/account/student-profile", { displayName: "Sam Okafor", allowPublicProfile: true });
      assert.equal((await anon.get(`/api/students/${s02Id}`)).data.student.displayName, "Sam Okafor");
      assert.deepEqual(fixtureShown(await showcase(anon, `?studentId=${s02Id}`)), ["R-501"]);
      assert.deepEqual((await showcase())[0].students, [{ id: s02Id, displayName: "Sam Okafor" }]);
      // Faculty aren't student profiles.
      assert.equal((await s17.get(`/api/students/${ids.users["F-JORDAN"]}`)).status, 404);
    });

    test("hiding an outcome from your own profile keeps it on the faculty profile and the showcase", async () => {
      const s02Id = ids.users.S02;
      const res = await s02.put(`/api/outcomes/${ids["R-501"]}/show-on-profile`, { show: false });
      assert.equal(res.status, 200);
      assert.equal(res.data.outcome.you.showOnProfile, false);
      assert.deepEqual(await showcase(anon, `?studentId=${s02Id}`), []);
      assert.deepEqual(fixtureShown(await showcase()), ["R-501"]);
      assert.deepEqual(fixtureShown(await showcase(anon, `?facultyId=${ids.users["F-JORDAN"]}`)), ["R-501"]);
      assert.deepEqual((await showcase())[0].students.map((s) => s.displayName), ["Sam Okafor"]);
      await s02.put(`/api/outcomes/${ids["R-501"]}/show-on-profile`, { show: true });
      assert.deepEqual(fixtureShown(await showcase(anon, `?studentId=${s02Id}`)), ["R-501"]);
    });

    test("only the student's own choice changes, and only students make it", async () => {
      assert.equal((await jordan.put(`/api/outcomes/${ids["R-501"]}/show-on-profile`, { show: false })).status, 403);
      assert.equal((await s17.put(`/api/outcomes/${ids["R-501"]}/show-on-profile`, { show: false })).status, 404);
      assert.equal((await s02.put(`/api/outcomes/${ids["R-501"]}/show-on-profile`, { show: "no" })).status, 400);
    });
  });

  describe("R3-15, R3-21: confirmation", () => {
    test("students and non-participating faculty can't confirm", async () => {
      assert.equal((await s01.post(`/api/outcomes/${ids["R-502"]}/confirm`)).status, 403);
      assert.equal((await jordan.post(`/api/outcomes/${ids["R-502"]}/confirm`)).status, 404);
      assert.equal((await anon.post(`/api/outcomes/${ids["R-502"]}/confirm`)).status, 401);
      const row = await t.db.query("SELECT confirmed_by FROM outcomes WHERE id = $1", [ids["R-502"]]);
      assert.equal(row.rows[0].confirmed_by, null);
    });

    test("a participating verified faculty member confirms it, and it becomes public", async () => {
      const res = await alex.post(`/api/outcomes/${ids["R-502"]}/confirm`);
      assert.equal(res.status, 200);
      assert.equal(res.data.outcome.confirmedBy, "Dr. Alex Morgan");
      assert.equal(res.data.outcome.showcased, true);
      assert.ok(fixtureShown(await showcase()).includes("R-502"));
      assert.equal((await alex.post(`/api/outcomes/${ids["R-502"]}/confirm`)).status, 409);
    });

    test("editing clears the confirmation, so only confirmed content is ever public", async () => {
      const res = await s01.put(`/api/outcomes/${ids["R-502"]}`, {
        summary: "Dashboard delivered to the partner.",
        completedOn: "2026-11-01",
        links: { demo: "https://example.org/demo" },
      });
      assert.equal(res.status, 200, JSON.stringify(res.data));
      assert.equal(res.data.outcome.confirmed, false);
      assert.ok(!fixtureShown(await showcase()).includes("R-502"));
      assert.equal((await anon.get(`/api/outcomes/${ids["R-502"]}`)).status, 404);
    });

    test("a faculty participant can take a confirmation back", async () => {
      await alex.post(`/api/outcomes/${ids["R-502"]}/confirm`);
      const res = await alex.post(`/api/outcomes/${ids["R-502"]}/unconfirm`);
      assert.equal(res.data.outcome.confirmed, false);
      assert.equal((await alex.post(`/api/outcomes/${ids["R-502"]}/unconfirm`)).status, 409);
    });

    test("an outcome stops being public when its faculty member is no longer verified", async () => {
      await t.db.query("UPDATE users SET is_verified_faculty = false WHERE fixture_id = 'F-JORDAN'");
      assert.deepEqual(fixtureShown(await showcase()), []);
      await t.db.query("UPDATE users SET is_verified_faculty = true WHERE fixture_id = 'F-JORDAN'");
      assert.deepEqual(fixtureShown(await showcase()), ["R-501"]);
    });
  });

  describe("R3-14: recording an outcome", () => {
    let m401;
    let m402;

    before(async () => {
      const rows = await t.db.query("SELECT id, fixture_id FROM matches WHERE fixture_id IN ('M-401', 'M-402')");
      ({ "M-401": m401, "M-402": m402 } = Object.fromEntries(rows.rows.map((r) => [r.fixture_id, r.id])));
    });

    const body = (over = {}) => ({
      matchId: m401,
      summary: "Pick-path heat map for the warehouse floor.",
      completedOn: "2026-11-05",
      links: { repo: "https://github.com/example/pick-path", poster: "https://example.org/poster.pdf" },
      students: [fixtureEmail("S05")],
      faculty: [ids.users["F-ALEX"]],
      ...over,
    });

    test("a student on a confirmed match records one; it starts unconfirmed whatever the body says", async () => {
      const res = await s01.post("/api/outcomes", body({ confirmedBy: ids.users["F-ALEX"], confirmed: true, showcased: true }));
      assert.equal(res.status, 201, JSON.stringify(res.data));
      const { outcome } = res.data;
      assert.equal(outcome.confirmed, false);
      assert.equal(outcome.opportunity.title, "Warehouse pick-path visualisation");
      // The recording student is always a participant.
      assert.deepEqual(outcome.participants.map((p) => [p.role, p.email]), [
        ["faculty", fixtureEmail("F-ALEX")],
        ["student", fixtureEmail("S01")],
        ["student", fixtureEmail("S05")],
      ]);
      assert.deepEqual(outcome.links.map((l) => l.kind), ["repo", "poster"]);
      // The other participants see it; the outcome isn't public yet.
      assert.equal((await s05.get(`/api/outcomes/${outcome.id}`)).status, 200);
      assert.equal((await alex.get(`/api/outcomes/${outcome.id}`)).data.outcome.you.canConfirm, true);
      assert.equal((await anon.get(`/api/outcomes/${outcome.id}`)).status, 404);
    });

    test("faculty record one too, and can name another faculty member by email", async () => {
      const res = await alex.post("/api/outcomes", body({ faculty: [], otherFacultyEmails: [fixtureEmail("F-PRIYA")] }));
      assert.equal(res.status, 201, JSON.stringify(res.data));
      assert.deepEqual(
        res.data.outcome.participants.filter((p) => p.role === "faculty").map((p) => p.email),
        [fixtureEmail("F-ALEX"), fixtureEmail("F-PRIYA")],
      );
    });

    test("only participants of a fully confirmed match can record one", async () => {
      assert.equal((await s17.post("/api/outcomes", body())).status, 404);
      assert.equal((await jordan.post("/api/outcomes", body())).status, 404);
      // M-402 is only partly confirmed.
      const s08 = (await signIn(t, fixtureEmail("S08"))).client;
      assert.equal((await s08.post("/api/outcomes", body({ matchId: m402, students: [] }))).status, 404);
      assert.equal((await anon.post("/api/outcomes", body())).status, 401);
    });

    test("bad input is refused and nothing is stored", async () => {
      const before = (await t.db.query("SELECT count(*)::int AS n FROM outcomes")).rows[0].n;
      const cases = [
        [{ summary: "  " }, "summary"],
        [{ completedOn: "2026-02-30" }, "completedOn"],
        [{ completedOn: "2026-12-01" }, "completedOn"],
        [{ links: { demo: "javascript:alert(1)" } }, "demo"],
        [{ links: { website: "https://example.org" } }, "links"],
        [{ students: [fixtureEmail("S17")] }, "students"],
        [{ faculty: [ids.users["U-PENDING"]] }, "faculty"],
        [{ faculty: [], otherFacultyEmails: [fixtureEmail("S05")] }, "faculty"],
        [{ faculty: [] }, "faculty"],
      ];
      for (const [over, field] of cases) {
        const res = await s01.post("/api/outcomes", body(over));
        assert.equal(res.status, 400, JSON.stringify(over));
        assert.equal(res.data.field, field, JSON.stringify(over));
      }
      assert.equal((await t.db.query("SELECT count(*)::int AS n FROM outcomes")).rows[0].n, before);
    });

    test("the form is offered the confirmed matches the user took part in", async () => {
      const recordable = (await s01.get("/api/outcomes/mine")).data.recordable;
      assert.deepEqual(recordable.map((m) => m.matchId), [m401]);
      assert.deepEqual(recordable[0].faculty.map((f) => f.name), ["Dr. Alex Morgan"]);
      assert.deepEqual((await s17.get("/api/outcomes/mine")).data.recordable, []);
    });
  });
});
