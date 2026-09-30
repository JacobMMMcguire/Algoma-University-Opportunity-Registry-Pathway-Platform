// R1-04: staff grant and revoke verified-faculty capability; revocation keeps the account.
const assert = require("node:assert/strict");
const { after, before, describe, test } = require("node:test");
const { createClient, signIn, startTestApp, uniqueEmail } = require("./helpers");

describe("faculty verification", () => {
  let t;
  let staff;
  before(async () => {
    t = await startTestApp();
    staff = (await signIn(t, uniqueEmail("staff"), { staff: true })).client;
  });
  after(() => t.close());

  test("staff can grant and revoke; revocation keeps the account and applies immediately", async () => {
    const { client: person, user } = await signIn(t, uniqueEmail("prof"));

    const granted = await staff.post(`/api/admin/users/${user.id}/verify-faculty`);
    assert.equal(granted.status, 200);
    assert.equal(granted.data.user.isVerifiedFaculty, true);
    assert.equal((await person.put("/api/account/public-profile", { allowPublicProfile: false })).status, 200);

    const revoked = await staff.post(`/api/admin/users/${user.id}/revoke-faculty`);
    assert.equal(revoked.data.user.isVerifiedFaculty, false);
    const stillThere = await t.db.query("SELECT email FROM users WHERE id = $1", [user.id]);
    assert.equal(stillThere.rows.length, 1);
    // Same session, next request: faculty features are gone.
    assert.equal((await person.put("/api/account/public-profile", { allowPublicProfile: true })).status, 403);
    assert.equal((await person.get("/api/auth/me")).data.authenticated, true);
  });

  test("non-staff and signed-out users cannot grant or list users", async () => {
    const { client: student, user } = await signIn(t, uniqueEmail("student"));
    const { client: faculty } = await signIn(t, uniqueEmail("prof"), { faculty: true });
    assert.equal((await student.post(`/api/admin/users/${user.id}/verify-faculty`)).status, 403);
    assert.equal((await faculty.post(`/api/admin/users/${user.id}/verify-faculty`)).status, 403);
    assert.equal((await createClient(t.baseUrl).post(`/api/admin/users/${user.id}/verify-faculty`)).status, 401);
    assert.equal((await student.get("/api/admin/users")).status, 403);
    assert.equal((await t.db.query("SELECT is_verified_faculty FROM users WHERE id = $1", [user.id])).rows[0].is_verified_faculty, false);
  });

  test("staff get clear errors for unknown or malformed ids", async () => {
    assert.equal((await staff.post("/api/admin/users/999999/verify-faculty")).status, 404);
    assert.equal((await staff.post("/api/admin/users/abc/verify-faculty")).status, 400);
  });

  test("staff can list users with their current roles", async () => {
    const email = uniqueEmail("listed");
    await signIn(t, email, { faculty: true });
    const list = await staff.get("/api/admin/users");
    const row = list.data.find((u) => u.email === email);
    assert.equal(row.isVerifiedFaculty, true);
    assert.equal(row.isStaff, false);
  });
});
