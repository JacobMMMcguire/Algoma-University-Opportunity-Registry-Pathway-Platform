// The provided R1 fixture: it loads repeatably, and the app shows exactly what the fixture says
// each audience should see (its expected_public / expected_authenticated flags).
const assert = require("node:assert/strict");
const { after, before, describe, test } = require("node:test");
const { buildFixtureSql, fixtureEmail, loadFixture } = require("../src/fixture");
const { createClient, loadFixtureInto, signIn, startTestApp } = require("./helpers");

const fixture = loadFixture();

describe("R1 fixture", () => {
  let t;
  let ids;
  before(async () => {
    t = await startTestApp();
    ids = await loadFixtureInto(t);
  });
  after(() => t.close());

  const listedIds = (res) => new Set(res.data.projects.map((p) => p.id));

  test("logged-out visitors see exactly the fixture's expected_public projects", async () => {
    const anon = createClient(t.baseUrl);
    const listed = listedIds(await anon.get("/api/projects"));
    for (const p of fixture.projects) {
      const id = ids.projectId(p.fixture_id);
      assert.equal(listed.has(id), p.expected_public, `${p.fixture_id} in public list`);
      assert.equal((await anon.get(`/api/projects/${id}`)).status, p.expected_public ? 200 : 404, `${p.fixture_id} by URL`);
    }
  });

  test("signed-in users also see expected_authenticated projects, and still no drafts or withdrawn ones", async () => {
    const { client } = await signIn(t, fixtureEmail("TEST-STUDENT"));
    const listed = listedIds(await client.get("/api/projects"));
    for (const p of fixture.projects) {
      const expected = p.expected_public || p.expected_authenticated === true;
      assert.equal(listed.has(ids.projectId(p.fixture_id)), expected, p.fixture_id);
    }
  });

  test("faculty visibility follows public_profile and verified_faculty", async () => {
    const anon = new Set((await createClient(t.baseUrl).get("/api/faculty")).data.faculty.map((f) => f.id));
    const { client } = await signIn(t, fixtureEmail("TEST-STUDENT"));
    const signedIn = new Set((await client.get("/api/faculty")).data.faculty.map((f) => f.id));
    for (const f of fixture.faculty) {
      const id = ids.facultyId(f.fixture_id);
      assert.equal(anon.has(id), f.verified_faculty && f.public_profile, `${f.fixture_id} public`);
      assert.equal(signedIn.has(id), f.verified_faculty, `${f.fixture_id} signed in`);
    }
  });

  test("fixture values arrive translated: inquiry labels, closed status, terms", async () => {
    const anon = createClient(t.baseUrl);
    const priya = (await anon.get(`/api/faculty/${ids.facultyId("F-PRIYA")}`)).data.profile;
    assert.equal(priya.inquiryPreference.label, "Inquiries about listed projects only");
    const withdrawn = await t.db.query("SELECT status FROM projects WHERE fixture_id = 'P-108'");
    assert.equal(withdrawn.rows[0].status, "closed");
    const p104 = (await anon.get(`/api/projects/${ids.projectId("P-104")}`)).data.project;
    assert.equal(p104.targetTerm, "Spring 2027");
    assert.equal(p104.studentLevel, "Undergraduate or Graduate");
  });

  test("reseeding creates no duplicates and resets fixture records to the fixture's values", async () => {
    await t.db.query("UPDATE projects SET title = 'Edited' WHERE fixture_id = 'P-101'");
    const before = await t.db.query("SELECT (SELECT count(*) FROM users)::int u, (SELECT count(*) FROM projects)::int p");
    await t.db.exec(buildFixtureSql(fixture));
    const after = await t.db.query("SELECT (SELECT count(*) FROM users)::int u, (SELECT count(*) FROM projects)::int p");
    assert.deepEqual(after.rows[0], before.rows[0]);
    const p101 = await t.db.query("SELECT title FROM projects WHERE fixture_id = 'P-101'");
    assert.equal(p101.rows[0].title, fixture.projects.find((p) => p.fixture_id === "P-101").title);
  });

  test("fixture accounts are never emailed and can sign in through test mode", async () => {
    const sentBefore = t.sentEmails.length;
    const { client } = await signIn(t, fixtureEmail("F-ALEX"));
    assert.equal(t.sentEmails.length, sentBefore);
    assert.equal((await client.get("/api/auth/me")).data.user.isVerifiedFaculty, true);
  });

  test("with test mode off, fixture accounts are refused instead of emailed", async () => {
    const off = await startTestApp({ config: { testMode: false } });
    try {
      await loadFixtureInto(off);
      const res = await createClient(off.baseUrl).post("/api/auth/request-challenge", { email: fixtureEmail("F-ALEX") });
      assert.equal(res.status, 403);
      assert.equal(off.sentEmails.length, 0);
    } finally {
      await off.close();
    }
  });

  test("evaluator accounts exist for every role", async () => {
    const roles = async (fixtureId) => (await signIn(t, fixtureEmail(fixtureId))).user;
    assert.equal((await roles("TEST-STAFF")).isStaff, true);
    const student = await roles("TEST-STUDENT");
    assert.equal(student.isStaff || student.isVerifiedFaculty, false);
    assert.equal((await roles("F-PRIYA")).isVerifiedFaculty, true);
    assert.equal((await roles("U-PENDING")).isVerifiedFaculty, false);
  });

  test("a fixture value outside the fixed lists is reported, not silently loaded", () => {
    const broken = structuredClone(fixture);
    broken.projects[0].areas = ["Astrology"];
    assert.throws(() => buildFixtureSql(broken), /Astrology/);
    broken.projects[0].areas = ["Data Science"];
    broken.projects[0].status = "archived";
    assert.throws(() => buildFixtureSql(broken), /archived/);
  });
});
