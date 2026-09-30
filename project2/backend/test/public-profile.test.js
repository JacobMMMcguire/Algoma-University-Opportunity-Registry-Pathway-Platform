// R1-05, R1-06, R1-07: explicit public-profile choice that can be changed later.
const assert = require("node:assert/strict");
const { after, before, describe, test } = require("node:test");
const { createAuth } = require("../src/auth");
const { PUBLIC_FACULTY_SQL } = require("../src/visibility");
const { signIn, startTestApp, uniqueEmail } = require("./helpers");

describe("public-profile choice", () => {
  let t;
  before(async () => {
    // Stand-in for a publish endpoint, which R1-13 will add, to test the R1-05 guard.
    t = await startTestApp({
      extend: ({ app, db }) => {
        app.post("/test-only/publish", createAuth(db).requirePublicProfileChoice, (_req, res) => res.json({ ok: true }));
      },
    });
  });
  after(() => t.close());

  async function isPublic(userId) {
    const result = await t.db.query(`SELECT ${PUBLIC_FACULTY_SQL} AS public FROM users WHERE id = $1`, [userId]);
    return result.rows[0].public;
  }

  test("R1-05: a new faculty member has made no choice and cannot publish until they do", async () => {
    const { client, user } = await signIn(t, uniqueEmail("prof"), { faculty: true });
    assert.equal((await client.get("/api/auth/me")).data.user.publicProfileChoice, null);
    assert.equal(await isPublic(user.id), false);

    const blocked = await client.post("/test-only/publish");
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.code, "public_profile_choice_required");

    await client.put("/api/account/public-profile", { allowPublicProfile: true });
    assert.equal((await client.post("/test-only/publish")).status, 200);
  });

  test("R1-05: the choice must be an explicit yes or no", async () => {
    const { client } = await signIn(t, uniqueEmail("prof"), { faculty: true });
    for (const value of [undefined, null, "true", 1]) {
      assert.equal((await client.put("/api/account/public-profile", { allowPublicProfile: value })).status, 400);
    }
  });

  test("R1-06: declining public display still allows faculty features", async () => {
    const { client, user } = await signIn(t, uniqueEmail("prof"), { faculty: true });
    const saved = await client.put("/api/account/public-profile", { allowPublicProfile: false });
    assert.equal(saved.data.user.publicProfileChoice, false);
    assert.equal(saved.data.user.publiclyVisible, false);
    assert.equal(await isPublic(user.id), false);
    assert.equal((await client.post("/test-only/publish")).status, 200);
  });

  test("R1-07: the choice can be changed later and visibility follows immediately", async () => {
    const { client, user } = await signIn(t, uniqueEmail("prof"), { faculty: true });
    await client.put("/api/account/public-profile", { allowPublicProfile: true });
    assert.equal(await isPublic(user.id), true);
    await client.put("/api/account/public-profile", { allowPublicProfile: false });
    assert.equal(await isPublic(user.id), false);
    assert.equal((await client.get("/api/auth/me")).data.user.publicProfileChoice, false);
  });

  test("only verified faculty can set the choice", async () => {
    const { client } = await signIn(t, uniqueEmail("student"));
    assert.equal((await client.put("/api/account/public-profile", { allowPublicProfile: true })).status, 403);
  });

  test("revoked faculty are not public even if they had allowed it", async () => {
    const { user } = await signIn(t, uniqueEmail("prof"), { faculty: true, publicProfile: true });
    assert.equal(await isPublic(user.id), true);
    await t.db.query("UPDATE users SET is_verified_faculty = false WHERE id = $1", [user.id]);
    assert.equal(await isPublic(user.id), false);
  });
});
