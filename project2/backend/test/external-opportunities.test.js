// R4-01 to R4-06, R4-16, R4-18, R4-19, R4-21 to R4-27: external opportunities as students, faculty
// and visitors see them, with the R1 to R3 fixtures loaded so readiness can use real outcomes.
const assert = require("node:assert/strict");
const { after, before, describe, test } = require("node:test");
const { buildR2FixtureSql, buildR3FixtureSql, loadLifecycleFixture } = require("../src/fixture");
const { SOURCES, normaliseMitacsRecord } = require("../src/external/sources");
const { createClient, loadFixtureInto, signIn, startTestApp, uniqueEmail } = require("./helpers");

const SOURCE = "mitacs-demo";

describe("external opportunities", () => {
  let t;
  let anon;
  let staff;
  let faculty;
  let facultyUser;
  let privateFaculty;
  let student;
  let outcomeStudent;
  let ids;

  before(async () => {
    // A clock after MX-1002's v1 closing date (2027-01-31), for R4-25.
    t = await startTestApp({ config: { clockDate: "2027-02-10" } });
    await loadFixtureInto(t);
    await t.db.exec(buildR2FixtureSql());
    await t.db.exec(buildR3FixtureSql());
    anon = createClient(t.baseUrl);
    staff = (await signIn(t, uniqueEmail("staff"), { staff: true })).client;
    ({ client: faculty, user: facultyUser } = await signIn(t, uniqueEmail("faculty"), { faculty: true, publicProfile: true }));
    await t.db.query("INSERT INTO faculty_profiles (user_id, display_name) VALUES ($1, 'Dr. Public')", [facultyUser.id]);
    const p = await signIn(t, uniqueEmail("privfac"), { faculty: true, publicProfile: false });
    privateFaculty = p.client;
    await t.db.query("INSERT INTO faculty_profiles (user_id, display_name) VALUES ($1, 'Dr. Private')", [p.user.id]);
    student = (await signIn(t, uniqueEmail("student"))).client;
    // A fixture student who took part in a confirmed R3 outcome.
    const withOutcome = await t.db.query(
      `SELECT op.email FROM outcome_participants op JOIN outcomes o ON o.id = op.outcome_id
       WHERE op.role = 'student' AND o.confirmed_by IS NOT NULL ORDER BY op.email LIMIT 1`,
    );
    outcomeStudent = (await signIn(t, withOutcome.rows[0].email)).client;
    await staff.post("/api/external-sync/run", { sourceId: SOURCE, feed: "v1" });
    const rows = await t.db.query("SELECT id, external_id FROM external_opportunities");
    ids = Object.fromEntries(rows.rows.map((r) => [r.external_id, r.id]));
  });
  after(() => t.close());

  test("R4-01: the source is data, and a second source needs no model change", async () => {
    const sources = await t.db.query("SELECT id, owner_name FROM external_sources");
    assert.deepEqual(sources.rows, [{ id: SOURCE, owner_name: "Mitacs" }]);
    const { runSync } = require("../src/external/sync");
    const other = {
      ...SOURCES[SOURCE],
      id: "other-demo",
      name: "Another provider (test)",
      ownerName: "Another provider",
      allowedHosts: ["other.example"],
      fetchFeed: async () => ({
        source_id: "other-demo",
        records: [{ external_id: "O-1", title: "Other", description: "", areas: [], authoritative_url: "https://other.example/1" }],
      }),
    };
    const result = await runSync(t.db, other, "v1");
    assert.equal(result.status, "succeeded");
    const o = (await anon.get("/api/external-opportunities?q=Other")).data.opportunities;
    assert.equal(o[0].source.ownerName, "Another provider");
    await t.db.query("DELETE FROM external_opportunities WHERE source_id = 'other-demo'");
  });

  test("R4-02, R4-03: students browse external opportunities with the same filters, each marked with its owner", async () => {
    const res = await anon.get("/api/external-opportunities?area=Data%20Science");
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.opportunities.map((o) => o.source.externalId).sort(), ["MX-1001", "MX-1004"]);
    for (const o of res.data.opportunities) {
      assert.equal(o.kind, "external");
      assert.equal(o.externallyOwned, true);
      assert.equal(o.wording.ownership, "Owned by Mitacs, not Algoma University.");
    }
    assert.equal((await anon.get("/api/external-opportunities?q=pipeline")).data.opportunities.length, 1);
    // No Algoma student level or term, so those filters leave them out.
    assert.equal((await anon.get("/api/external-opportunities?level=graduate")).data.opportunities.length, 0);
    assert.equal((await anon.get("/api/external-opportunities?area=Nope")).status, 400);
  });

  test("R4-04, R4-05: provenance in plain language and a handoff to the provider", async () => {
    const o = (await anon.get(`/api/external-opportunities/${ids["MX-1001"]}`)).data.opportunity;
    assert.equal(o.source.name, "Mitacs (synthetic demonstration feed)");
    assert.equal(o.authoritativeUrl, "https://mitacs.example/opportunities/MX-1001");
    assert.equal(o.wording.apply, "View / apply through Mitacs");
    assert.match(o.wording.applyNote, /not here/);
    assert.ok(o.freshness.lastSuccessfulSyncAt);
  });

  test("R4-06, R4-19: wording never says Algoma decides eligibility, or that the provider endorses anyone", async () => {
    const o = (await anon.get(`/api/external-opportunities/${ids["MX-1001"]}`)).data.opportunity;
    const text = Object.values(o.wording).join(" ");
    assert.match(o.wording.authority, /does not decide or check eligibility/);
    assert.match(o.wording.interest, /not selection, approval or endorsement by Mitacs/);
    assert.doesNotMatch(text, /Algoma (approves|decides|selects|determines)/i);
  });

  test("R4-07: a link off the provider's site, or a script link, is refused; text is never interpreted", () => {
    const source = SOURCES[SOURCE];
    const base = { external_id: "X-1", title: "T", areas: [], closes: "2027-01-01" };
    for (const url of ["javascript:alert(1)", "https://evil.example/mitacs.example", "data:text/html,hi", "https://user:pw@mitacs.example/x"]) {
      assert.ok(normaliseMitacsRecord({ ...base, authoritative_url: url }, source).reasons, url);
    }
    const ok = normaliseMitacsRecord({ ...base, title: "A\u0000B <b>x</b>", authoritative_url: "https://mitacs.example/x" }, source);
    assert.equal(ok.record.title, "A B <b>x</b>");
  });

  test("R4-18, R4-26: verified faculty record interest for themselves only; others are refused", async () => {
    const url = `/api/external-opportunities/${ids["MX-1001"]}/interest`;
    assert.equal((await anon.put(url, {})).status, 401);
    assert.equal((await student.put(url, {})).status, 403);
    assert.equal((await staff.put(url, {})).status, 403);
    // Naming someone else in the body changes nothing about who is recorded.
    assert.equal((await faculty.put(url, { facultyUserId: 1, faculty_user_id: 1, note: "Ask me." })).status, 200);
    assert.equal((await privateFaculty.put(url, {})).status, 200);
    const rows = await t.db.query("SELECT faculty_user_id FROM external_interest WHERE external_opportunity_id = $1", [ids["MX-1001"]]);
    assert.equal(rows.rows.length, 2);
    assert.ok(rows.rows.some((r) => r.faculty_user_id === facultyUser.id));
  });

  test("R4-18: visitors see only faculty who chose public display; signed-in users see both", async () => {
    const names = async (client) =>
      (await client.get(`/api/external-opportunities/${ids["MX-1001"]}`)).data.opportunity.interestedFaculty.map((f) => f.displayName);
    assert.deepEqual(await names(anon), ["Dr. Public"]);
    assert.deepEqual(await names(student), ["Dr. Private", "Dr. Public"]);
    const filtered = await anon.get(`/api/external-opportunities?facultyId=${facultyUser.id}`);
    assert.deepEqual(filtered.data.opportunities.map((o) => o.source.externalId), ["MX-1001"]);
  });

  test("R4-18: withdrawing interest removes only your own", async () => {
    assert.equal((await privateFaculty.delete(`/api/external-opportunities/${ids["MX-1001"]}/interest`)).status, 200);
    const rows = await t.db.query("SELECT count(*)::int AS n FROM external_interest WHERE external_opportunity_id = $1", [ids["MX-1001"]]);
    assert.equal(rows.rows[0].n, 1);
  });

  test("R4-16, R4-26: source-controlled fields cannot be edited through any route", async () => {
    const id = ids["MX-1004"];
    const before = (await t.db.query("SELECT title, authoritative_url FROM external_opportunities WHERE id = $1", [id])).rows[0];
    for (const client of [staff, faculty]) {
      assert.equal((await client.put(`/api/external-opportunities/${id}`, { title: "Edited" })).status, 404);
      assert.equal((await client.post(`/api/external-opportunities/${id}`, { title: "Edited" })).status, 404);
      await client.put(`/api/external-opportunities/${id}/guidance`, { title: "Edited", authoritativeUrl: "https://evil.example", note: "Local note" });
    }
    const afterRow = (await t.db.query("SELECT title, authoritative_url FROM external_opportunities WHERE id = $1", [id])).rows[0];
    assert.deepEqual(afterRow, before);
  });

  test("R4-26: guidance and student tracking need the right role", async () => {
    const id = ids["MX-1004"];
    assert.equal((await anon.put(`/api/external-opportunities/${id}/guidance`, { suggestPriorOutcome: true })).status, 401);
    assert.equal((await student.put(`/api/external-opportunities/${id}/guidance`, { suggestPriorOutcome: true })).status, 403);
    assert.equal((await faculty.put(`/api/external-opportunities/${id}/my-status`, { status: "applied" })).status, 403);
    assert.equal((await staff.put(`/api/external-opportunities/${id}/my-status`, { status: "applied" })).status, 403);
    assert.equal((await student.put(`/api/external-opportunities/${id}/my-status`, { status: "approved" })).status, 400);
  });

  test("R4-21 to R4-23: readiness is a transparent suggestion that never blocks", async () => {
    const id = ids["MX-1002"];
    await staff.put(`/api/external-opportunities/${id}/guidance`, { suggestPriorOutcome: true, note: "Security coursework helps." });
    const o = (await student.get(`/api/external-opportunities/${id}`)).data.opportunity;
    assert.equal(o.readiness.isRequirement, false);
    assert.match(o.readiness.basedOn, /confirmed/);
    assert.match(o.readiness.reminder, /never a gate/);
    assert.equal(o.readiness.you.meetsSuggestion, false);
    // Still fully available: the link, and recording an application.
    assert.equal(o.authoritativeUrl, "https://mitacs.example/opportunities/MX-1002");
    assert.equal((await student.put(`/api/external-opportunities/${id}/my-status`, { status: "applied" })).status, 200);
    // Visitors see the suggestion but no personal evaluation.
    const pub = (await anon.get(`/api/external-opportunities/${id}`)).data.opportunity;
    assert.equal(pub.readiness.you, null);
  });

  test("R4-24: readiness cites the confirmed R3 outcomes the student took part in", async () => {
    const o = (await outcomeStudent.get(`/api/external-opportunities/${ids["MX-1002"]}`)).data.opportunity;
    assert.equal(o.readiness.you.meetsSuggestion, true);
    assert.ok(o.readiness.you.confirmedOutcomes.length >= 1);
    const summaries = loadLifecycleFixture().outcomes.map((x) => x.summary);
    for (const outcome of o.readiness.you.confirmedOutcomes) assert.ok(summaries.includes(outcome.summary));
  });

  test("R4-25: an Algoma date past the provider's closing date doesn't expire it", async () => {
    // The clock is 2027-02-10; MX-1002 (v1) closes 2027-01-31.
    const list = (await anon.get("/api/external-opportunities")).data.opportunities.map((o) => o.source.externalId);
    assert.ok(list.includes("MX-1002"));
    const o = (await anon.get(`/api/external-opportunities/${ids["MX-1002"]}`)).data.opportunity;
    assert.equal(o.closing.passed, true);
    assert.match(o.closing.text, /Only Mitacs can say/);
    assert.equal(o.sourceState.value, "listed");
  });

  test("R4-27: local discovery is unchanged by external opportunities", async () => {
    const projects = await anon.get("/api/projects");
    const opportunities = await anon.get("/api/opportunities");
    assert.equal(projects.status, 200);
    assert.equal(opportunities.status, 200);
    assert.ok(projects.data.projects.every((p) => p.kind !== "external"));
  });
});
