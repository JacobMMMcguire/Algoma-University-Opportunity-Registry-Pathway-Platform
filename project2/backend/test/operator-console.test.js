// R1-01 test mode: sign-in codes are surfaced only to an *authorised* operator, and only for the
// fixture test accounts. Regression tests for the instructor's Critical finding: previously any
// visitor could read every pending code at /api/auth/pending-challenges and sign in as anyone.
const assert = require("node:assert/strict");
const { after, before, describe, test } = require("node:test");
const { loadConfig } = require("../src/config");
const { fixtureEmail } = require("../src/fixture");
const { TEST_OPERATOR_SECRET, createClient, loadFixtureInto, signIn, startTestApp, uniqueEmail } = require("./helpers");

describe("operator console authorisation", () => {
  let t;
  const realAddress = "real.person@algomau.ca";
  const staffTestAccount = fixtureEmail("TEST-STAFF");

  before(async () => {
    t = await startTestApp();
    await loadFixtureInto(t);
    const visitor = createClient(t.baseUrl);
    await visitor.post("/api/auth/request-challenge", { email: realAddress });
    await visitor.post("/api/auth/request-challenge", { email: staffTestAccount });
  });
  after(() => t.close());

  async function readConsole(secret) {
    const res = await fetch(`${t.baseUrl}/api/auth/pending-challenges`, {
      headers: secret === undefined ? {} : { "x-operator-secret": secret },
    });
    return { status: res.status, data: await res.json() };
  }

  test("an anonymous visitor cannot read any code, so cannot take over the staff test account", async () => {
    const res = await readConsole();
    assert.equal(res.status, 401);
    assert.ok(!JSON.stringify(res.data).match(/\d{6}/));
    // The rest of the old attack: without the code, verify cannot succeed.
    const verify = await createClient(t.baseUrl).post("/api/auth/verify", { email: staffTestAccount, code: "000000" });
    assert.equal(verify.status, 400);
  });

  test("a wrong or empty operator secret is refused", async () => {
    assert.equal((await readConsole("wrong-secret-wrong-secret-wrong")).status, 401);
    assert.equal((await readConsole("")).status, 401);
    assert.equal((await readConsole(`${TEST_OPERATOR_SECRET}x`)).status, 401);
  });

  test("a signed-in user who isn't staff is refused", async () => {
    const { client } = await signIn(t, uniqueEmail("student"));
    assert.equal((await client.get("/api/auth/pending-challenges")).status, 403);
  });

  test("the operator secret shows test-account codes only, never a real user's", async () => {
    const res = await readConsole(TEST_OPERATOR_SECRET);
    assert.equal(res.status, 200);
    const emails = res.data.map((row) => row.email);
    assert.ok(emails.includes(staffTestAccount));
    assert.ok(!emails.includes(realAddress));
  });

  test("signed-in staff can read test-account codes, but not real users' either", async () => {
    const { client } = await signIn(t, uniqueEmail("staff"), { staff: true });
    const res = await client.get("/api/auth/pending-challenges");
    assert.equal(res.status, 200);
    assert.ok(!res.data.some((row) => row.email === realAddress));
  });

  test("a real user's code still works for them, by email", async () => {
    const email = uniqueEmail("real");
    const client = createClient(t.baseUrl);
    await client.post("/api/auth/request-challenge", { email });
    const { code } = t.sentEmails.filter((sent) => sent.email === email).at(-1);
    assert.equal((await client.post("/api/auth/verify", { email, code })).status, 200);
  });

  test("if a real user's email fails, they get an error and the unreadable code is retired", async () => {
    const failing = await startTestApp({ email: "fail" });
    try {
      const res = await createClient(failing.baseUrl).post("/api/auth/request-challenge", { email: realAddress });
      assert.equal(res.status, 502);
      const pending = await failing.db.query(
        "SELECT count(*)::int AS n FROM sign_in_challenges WHERE email = $1 AND used_at IS NULL",
        [realAddress],
      );
      assert.equal(pending.rows[0].n, 0);
    } finally {
      await failing.close();
    }
  });

  test("without email configured, real users are told sign-in is unavailable; test accounts still work", async () => {
    const noEmail = await startTestApp({ email: "none" });
    try {
      await loadFixtureInto(noEmail);
      const client = createClient(noEmail.baseUrl);
      assert.equal((await client.post("/api/auth/request-challenge", { email: realAddress })).status, 503);
      assert.equal((await client.post("/api/auth/request-challenge", { email: staffTestAccount })).status, 201);
    } finally {
      await noEmail.close();
    }
  });

  test("with test mode off the console is gone, even with the secret", async () => {
    const off = await startTestApp({ config: { testMode: false } });
    try {
      const res = await fetch(`${off.baseUrl}/api/auth/pending-challenges`, {
        headers: { "x-operator-secret": TEST_OPERATOR_SECRET },
      });
      assert.equal(res.status, 404);
    } finally {
      await off.close();
    }
  });

  test("an operator secret too short to resist guessing is ignored", () => {
    assert.equal(loadConfig({ OPERATOR_SECRET: "short" }).operatorSecret, "");
    assert.equal(loadConfig({ OPERATOR_SECRET: "x".repeat(24) }).operatorSecret, "x".repeat(24));
  });
});
