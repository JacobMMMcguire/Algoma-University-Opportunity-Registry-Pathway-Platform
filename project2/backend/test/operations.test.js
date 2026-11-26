// F-23, F-24 (FINAL_PLAN.md D8): the operator page and its lifecycle summary, against the Final
// fixtures: one orphaned opportunity (O-302), one person who left, one graduate.
const assert = require("node:assert/strict");
const { after, before, describe, test } = require("node:test");
const { buildAllFixtureSql, fixtureEmail, loadLifecycleFixture } = require("../src/fixture");
const { createClient, signIn, startTestApp } = require("./helpers");

describe("F-23: one operator page", () => {
  let t;
  let staff;
  before(async () => {
    t = await startTestApp({ config: { clockDate: loadLifecycleFixture().evaluation_date } });
    await t.db.exec(buildAllFixtureSql());
    staff = (await signIn(t, fixtureEmail("TEST-STAFF"))).client;
  });
  after(() => t.close());

  test("lifecycle problems: everything F-ALEX alone managed, with counts of who left and graduated", async () => {
    const res = await staff.get("/api/operations/lifecycle");
    assert.equal(res.status, 200);
    // O-302 (the fixture's orphan) and F-ALEX's two published R1 projects, P-101 and P-107.
    const orphans = res.data.problems.filter((p) => p.problem === "needs_supervisor").map((p) => p.title).sort();
    assert.deepEqual(orphans, ["Anomaly review dashboard", "Explainable Models for Community Service Data", "Small-Data Model Evaluation"]);
    assert.equal(res.data.counts.needsSupervisor, 3);
    assert.deepEqual(res.data.counts.left, 1);
    assert.deepEqual(res.data.counts.graduated, 1);
    const orphan = res.data.problems.find((p) => p.problem === "needs_supervisor");
    assert.equal(orphan.title, "Anomaly review dashboard");
    assert.match(orphan.explanation, /Reassign/);
    for (const p of res.data.problems.filter((x) => x.problem === "no_deadline")) assert.equal(p.lifecycle.state, "open");
  });

  test("the page is staff only and is linked from the staff menu", async () => {
    assert.equal((await createClient(t.baseUrl).get("/api/operations/lifecycle")).status, 401);
    const html = await (await fetch(`${t.baseUrl}/operations.html`)).text();
    assert.match(html, /<h1>Operations<\/h1>/);
    const common = await (await fetch(`${t.baseUrl}/common.js`)).text();
    assert.match(common, /href: "operations.html", label: "Operations", group: "Staff"/);
  });

  test("F-24: nothing the page reads carries a code, token or partner contact detail", async () => {
    await createClient(t.baseUrl).post("/api/auth/request-challenge", { email: fixtureEmail("S01") });
    const bodies = [];
    for (const url of ["/api/operations/lifecycle", "/api/operations/notifications", "/api/operations/history?limit=50", "/api/external-sync/health"]) {
      bodies.push(JSON.stringify((await staff.get(url)).data));
    }
    const code = (await t.db.query("SELECT code FROM sign_in_challenges ORDER BY id DESC LIMIT 1")).rows[0].code;
    const token = (await t.db.query("SELECT token FROM sessions LIMIT 1")).rows[0].token;
    for (const body of bodies) {
      assert.ok(!body.includes(code), "no sign-in code");
      assert.ok(!body.includes(token), "no session token");
      assert.doesNotMatch(body, /contact_?email|northwind-robotics\.example/i);
    }
  });
});
