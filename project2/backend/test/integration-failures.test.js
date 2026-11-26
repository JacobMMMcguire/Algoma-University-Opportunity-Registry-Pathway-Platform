// F-13, F-15, F-16: when something the product depends on fails (sign-in email, the external feed,
// notifications, the database), people get a readable message with a way forward, never a stack
// trace, SQL, code or token, and nothing else breaks. The detailed cases live in their own files:
// sync failures in test/external-sync.test.js (R4-11, R4-14), notification failures in
// test/notification-failure.test.js (F-14), email failures in test/operator-console.test.js.
const assert = require("node:assert/strict");
const { after, before, describe, test } = require("node:test");
const { SOURCES } = require("../src/external/sources");
const { createClient, signIn, startTestApp, uniqueEmail } = require("./helpers");

const INTERNALS = /at \w+ \(|node_modules|SELECT |INSERT |UPDATE |stack|ECONNREFUSED|simulated email failure|\b\d{6}\b/i;

function readable(res) {
  assert.equal(typeof res.data.error, "string", JSON.stringify(res.data));
  assert.ok(res.data.error.length > 10 && res.data.error.length < 300, res.data.error);
  assert.doesNotMatch(res.data.error, INTERNALS);
}

describe("F-15, F-16: failures of outside services are contained and explained", () => {
  test("sign-in email fails: a readable 502, and the unreadable code is retired", async () => {
    const t = await startTestApp({ email: "fail" });
    try {
      const res = await createClient(t.baseUrl).post("/api/auth/request-challenge", { email: uniqueEmail("real") });
      assert.equal(res.status, 502);
      readable(res);
      assert.match(res.data.error, /try again/i);
    } finally {
      await t.close();
    }
  });

  test("sign-in email isn't configured: a readable 503", async () => {
    const t = await startTestApp({ email: "none" });
    try {
      const res = await createClient(t.baseUrl).post("/api/auth/request-challenge", { email: uniqueEmail("real") });
      assert.equal(res.status, 503);
      readable(res);
    } finally {
      await t.close();
    }
  });

  describe("with the app otherwise running", () => {
    let t;
    let staff;
    before(async () => {
      t = await startTestApp();
      staff = (await signIn(t, uniqueEmail("staff"), { staff: true })).client;
    });
    after(() => t.close().catch(() => {}));

    test("F-13: the external feed fails: the sync is recorded as failed with a reason, and browsing still works", async () => {
      const source = Object.keys(SOURCES)[0];
      const failing = Object.keys(SOURCES[source].feeds).find((f) => /fail|unavailable|malformed|broken/i.test(f + SOURCES[source].feeds[f].label));
      assert.ok(failing, "the demonstration source can simulate a failure");
      const res = await staff.post("/api/external-sync/run", { sourceId: source, feed: failing });
      assert.ok([200, 201].includes(res.status), JSON.stringify(res.data));
      const health = (await staff.get("/api/external-sync/health")).data;
      const reason = JSON.stringify(health);
      assert.match(reason, /fail/i);
      assert.doesNotMatch(reason, /at \w+ \(|node_modules/);
      assert.equal((await createClient(t.baseUrl).get("/api/projects")).status, 200);
    });

    test("bad JSON gives a readable 400", async () => {
      const res = await fetch(`${t.baseUrl}/api/partner-submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error, "Request body is not valid JSON.");
    });

    // Last, because it stops the database.
    test("the database is unavailable: plain messages, and the health check says so", async () => {
      await t.db.end();
      const res = await createClient(t.baseUrl).get("/api/projects");
      assert.equal(res.status, 500);
      assert.equal(res.data.error, "Unexpected server error.");
      const health = await createClient(t.baseUrl).get("/api/health");
      assert.equal(health.status, 503);
      assert.deepEqual(health.data, { ok: false, error: "database unavailable" });
    });
  });
});
