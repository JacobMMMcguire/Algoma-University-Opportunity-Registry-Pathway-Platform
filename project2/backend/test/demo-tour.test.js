// The guided tour's role switch (src/routes/demo.js) exists only on a local presentation build.
// These tests prove it is unreachable in production configuration and safe when it is on.
// (test/authorization-sweep.test.js also checks that every kind of caller gets 404 by default.)
const assert = require("node:assert/strict");
const { after, before, describe, test } = require("node:test");
const { loadConfig } = require("../src/config");
const { buildAllFixtureSql, fixtureEmail } = require("../src/fixture");
const { TOUR_ACCOUNTS } = require("../src/routes/demo");
const { createClient, startTestApp, uniqueEmail } = require("./helpers");

describe("guided tour role switch (local presentations only)", () => {
  let t;

  before(async () => {
    t = await startTestApp();
    await t.db.exec(buildAllFixtureSql());
  });
  after(() => t.close());

  test("no environment variable can turn it on: only dev-local sets it after loadConfig", () => {
    const config = loadConfig({ DEMO_TOUR: "true", SIGN_IN_TEST_MODE: "true", demoTour: "true" });
    assert.equal(config.demoTour, undefined);
  });

  test("off by default: 404 for every role, and /api/auth/me doesn't mention it", async () => {
    t.config.demoTour = undefined;
    const client = createClient(t.baseUrl);
    for (const role of ["visitor", "student", "faculty", "staff"]) {
      assert.equal((await client.post("/api/demo/sign-in-as", { role })).status, 404, role);
    }
    const me = (await client.get("/api/auth/me")).data;
    assert.equal(me.authenticated, false);
    assert.equal("demoTour" in me, false);
  });

  test("off whenever sign-in test mode is off, even if the flag is set", async () => {
    t.config.demoTour = true;
    t.config.testMode = false;
    try {
      const client = createClient(t.baseUrl);
      assert.equal((await client.post("/api/demo/sign-in-as", { role: "staff" })).status, 404);
      assert.equal("demoTour" in (await client.get("/api/auth/me")).data, false);
    } finally {
      t.config.testMode = true;
      t.config.demoTour = undefined;
    }
  });

  describe("when the local build turns it on", () => {
    before(() => {
      t.config.demoTour = true;
    });
    after(() => {
      t.config.demoTour = undefined;
    });

    test("it switches one browser through the tour's roles, and back to a visitor", async () => {
      const client = createClient(t.baseUrl);
      assert.equal((await client.get("/api/auth/me")).data.demoTour, true);

      const expected = {
        student: { isStaff: false, isVerifiedFaculty: false },
        faculty: { isStaff: false, isVerifiedFaculty: true },
        staff: { isStaff: true, isVerifiedFaculty: false },
      };
      for (const [role, flags] of Object.entries(expected)) {
        const res = await client.post("/api/demo/sign-in-as", { role });
        assert.equal(res.status, 200, role);
        const me = (await client.get("/api/auth/me")).data;
        assert.equal(me.user.email, fixtureEmail(TOUR_ACCOUNTS[role]));
        assert.equal(me.user.isStaff, flags.isStaff, role);
        assert.equal(me.user.isVerifiedFaculty, flags.isVerifiedFaculty, role);
      }

      assert.equal((await client.post("/api/demo/sign-in-as", { role: "visitor" })).status, 200);
      assert.equal((await client.get("/api/auth/me")).data.authenticated, false);
    });

    test("switching ends the previous session rather than leaving it usable", async () => {
      const client = createClient(t.baseUrl);
      await client.post("/api/demo/sign-in-as", { role: "staff" });
      const before = (await t.db.query("SELECT count(*)::int AS n FROM sessions")).rows[0].n;
      await client.post("/api/demo/sign-in-as", { role: "student" });
      assert.equal((await t.db.query("SELECT count(*)::int AS n FROM sessions")).rows[0].n, before);
    });

    test("only the tour's own fixture accounts: no other role, account or email can be named", async () => {
      const client = createClient(t.baseUrl);
      for (const body of [
        { role: "admin" },
        { role: "F-ALEX" },
        { role: "constructor" },
        { role: "__proto__" },
        { role: ["staff"] },
        { email: fixtureEmail("TEST-STAFF") },
        { email: uniqueEmail("real") },
        {},
      ]) {
        assert.equal((await client.post("/api/demo/sign-in-as", body)).status, 400, JSON.stringify(body));
      }
      assert.equal((await client.get("/api/auth/me")).data.authenticated, false);
    });

    test("it never grants a role: the accounts keep exactly the roles the fixtures gave them", async () => {
      const before = (await t.db.query("SELECT email, is_staff, is_verified_faculty FROM users ORDER BY id")).rows;
      const client = createClient(t.baseUrl);
      for (const role of Object.keys(TOUR_ACCOUNTS)) {
        await client.post("/api/demo/sign-in-as", { role, isStaff: true, isVerifiedFaculty: true });
      }
      const afterRows = (await t.db.query("SELECT email, is_staff, is_verified_faculty FROM users ORDER BY id")).rows;
      assert.deepEqual(afterRows, before);
    });
  });
});
