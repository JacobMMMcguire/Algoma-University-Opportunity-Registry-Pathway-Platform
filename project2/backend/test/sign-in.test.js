// R1-01, R1-02, R1-03: passwordless, short-lived, single-use, domain-restricted sign-in.
const assert = require("node:assert/strict");
const { after, before, describe, test } = require("node:test");
const { createClient, signIn, startTestApp, uniqueEmail } = require("./helpers");

describe("sign-in", () => {
  let t;
  before(async () => {
    t = await startTestApp();
  });
  after(() => t.close());

  const latestCode = (email) => t.sentEmails.filter((sent) => sent.email === email).at(-1).code;

  test("R1-01: a code is issued, emailed, and signs the user in without a password", async () => {
    const email = uniqueEmail();
    const client = createClient(t.baseUrl);
    const requested = await client.post("/api/auth/request-challenge", { email });
    assert.equal(requested.status, 201);
    assert.equal(requested.data.emailSent, true);
    assert.match(latestCode(email), /^\d{6}$/);

    const verified = await client.post("/api/auth/verify", { email, code: latestCode(email) });
    assert.equal(verified.status, 200);
    const me = await client.get("/api/auth/me");
    assert.equal(me.data.authenticated, true);
    assert.equal(me.data.user.email, email);
  });

  test("R1-01: a code can only be used once", async () => {
    const email = uniqueEmail();
    const first = createClient(t.baseUrl);
    await first.post("/api/auth/request-challenge", { email });
    const code = latestCode(email);
    assert.equal((await first.post("/api/auth/verify", { email, code })).status, 200);
    const second = createClient(t.baseUrl);
    assert.equal((await second.post("/api/auth/verify", { email, code })).status, 400);
  });

  test("R1-01: two simultaneous attempts with the same code cannot both succeed", async () => {
    const email = uniqueEmail();
    await createClient(t.baseUrl).post("/api/auth/request-challenge", { email });
    const code = latestCode(email);
    const results = await Promise.all(
      [1, 2, 3].map(() => createClient(t.baseUrl).post("/api/auth/verify", { email, code })),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400, 400]);
  });

  test("R1-01: an expired code is rejected", async () => {
    const email = uniqueEmail();
    const client = createClient(t.baseUrl);
    await client.post("/api/auth/request-challenge", { email });
    await t.db.query("UPDATE sign_in_challenges SET expires_at = now() - interval '1 second' WHERE email = $1", [email]);
    assert.equal((await client.post("/api/auth/verify", { email, code: latestCode(email) })).status, 400);
  });

  test("R1-01: five wrong guesses kill the code, even if the right one follows", async () => {
    const email = uniqueEmail();
    const client = createClient(t.baseUrl);
    await client.post("/api/auth/request-challenge", { email });
    const code = latestCode(email);
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await client.post("/api/auth/verify", { email, code: wrong })).status, 400);
    }
    assert.equal((await client.post("/api/auth/verify", { email, code })).status, 400);
  });

  test("R1-01: requests are limited to 3 codes per address per 10 minutes", async () => {
    const email = uniqueEmail();
    const client = createClient(t.baseUrl);
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await client.post("/api/auth/request-challenge", { email })).status, 201);
    }
    assert.equal((await client.post("/api/auth/request-challenge", { email })).status, 429);
  });

  test("R1-02: addresses outside algomau.ca get no code and no account", async () => {
    const client = createClient(t.baseUrl);
    for (const email of [
      "someone@gmail.com",
      "someone@sub.algomau.ca",
      "someone@algomau.ca.evil.com",
      "someone@algomau.cam",
      "algomau.ca@evil.com",
    ]) {
      const res = await client.post("/api/auth/request-challenge", { email });
      assert.equal(res.status, 422, email);
      const users = await t.db.query("SELECT 1 FROM users WHERE email = $1", [email]);
      assert.equal(users.rows.length, 0, email);
    }
    assert.equal(t.sentEmails.some((sent) => !sent.email.endsWith("@algomau.ca")), false);
  });

  test("R1-02: the domain match is case-insensitive", async () => {
    const res = await createClient(t.baseUrl).post("/api/auth/request-challenge", { email: "Mixed.Case@AlgomaU.CA" });
    assert.equal(res.status, 201);
  });

  test("R1-03: claiming faculty or staff while signing in grants nothing", async () => {
    const email = uniqueEmail();
    const client = createClient(t.baseUrl);
    await client.post("/api/auth/request-challenge", { email, role: "faculty", isStaff: true });
    const verified = await client.post("/api/auth/verify", {
      email,
      code: latestCode(email),
      role: "faculty",
      isVerifiedFaculty: true,
      is_verified_faculty: true,
      isStaff: true,
      is_staff: true,
    });
    assert.equal(verified.data.user.isVerifiedFaculty, false);
    assert.equal(verified.data.user.isStaff, false);
  });

  test("sign-out ends the session", async () => {
    const { client } = await signIn(t, uniqueEmail());
    await client.post("/api/auth/logout");
    assert.equal((await client.get("/api/auth/me")).data.authenticated, false);
  });

  test("test mode off hides the operator console", async () => {
    const off = await startTestApp({ config: { testMode: false } });
    try {
      assert.equal((await createClient(off.baseUrl).get("/api/auth/pending-challenges")).status, 404);
    } finally {
      await off.close();
    }
  });
});
