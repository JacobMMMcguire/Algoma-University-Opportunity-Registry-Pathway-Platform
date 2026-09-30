const { createApp } = require("../src/app");
const { loadConfig } = require("../src/config");
const { createLocalDb } = require("../src/db");

// Starts the real app on a random port against a fresh in-memory Postgres with all migrations
// applied. Emails are captured in `sentEmails` instead of being sent. `extend({ app, db })`
// can add test-only routes before the server starts (use paths outside /api).
async function startTestApp({ config: configOverrides = {}, extend } = {}) {
  const db = await createLocalDb();
  const sentEmails = [];
  const config = { ...loadConfig({ SIGN_IN_TEST_MODE: "true" }), ...configOverrides };
  const app = createApp({
    db,
    config,
    sendSignInEmail: async (email, code) => {
      sentEmails.push({ email, code });
    },
  });
  if (extend) extend({ app, db });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    db,
    config,
    sentEmails,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await db.end();
    },
  };
}

// An HTTP client that keeps its own session cookie, like one browser.
function createClient(baseUrl) {
  let cookie = "";
  async function request(method, path, body) {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (cookie) headers.cookie = cookie;
    const res = await fetch(baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }
  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    put: (path, body) => request("PUT", path, body),
    patch: (path, body) => request("PATCH", path, body),
    delete: (path) => request("DELETE", path),
  };
}

// Signs in through the real passwordless flow and returns a client holding that session.
// `roles` sets capabilities directly in the database, the way the first staff account is made.
async function signIn(testApp, email, roles = {}) {
  const client = createClient(testApp.baseUrl);
  const requested = await client.post("/api/auth/request-challenge", { email });
  if (requested.status !== 201) throw new Error(`request-challenge failed: ${JSON.stringify(requested.data)}`);
  const { code } = testApp.sentEmails.filter((sent) => sent.email === email.toLowerCase()).at(-1);
  const verified = await client.post("/api/auth/verify", { email, code });
  if (verified.status !== 200) throw new Error(`verify failed: ${JSON.stringify(verified.data)}`);

  const user = verified.data.user;
  if (roles.staff || roles.faculty || roles.publicProfile !== undefined) {
    await testApp.db.query(
      `UPDATE users SET is_staff = $1, is_verified_faculty = $2, public_profile_choice = $3 WHERE id = $4`,
      [Boolean(roles.staff), Boolean(roles.faculty), roles.publicProfile ?? null, user.id],
    );
  }
  return { client, user };
}

let counter = 0;
// A unique @algomau.ca address per call, so tests never share rate limits or accounts.
function uniqueEmail(prefix = "user") {
  counter += 1;
  return `${prefix}${counter}.${process.pid}@algomau.ca`;
}

module.exports = { startTestApp, createClient, signIn, uniqueEmail };
