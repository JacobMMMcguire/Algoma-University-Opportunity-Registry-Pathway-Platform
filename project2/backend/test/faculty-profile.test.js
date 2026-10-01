// R1-08, R1-09, R1-10 (and R1-16 for profiles): faculty maintain their own profile, the
// inquiry preference is shown in plain language, and visibility follows the public choice.
const assert = require("node:assert/strict");
const { after, before, describe, test } = require("node:test");
const { RESEARCH_AREAS } = require("../src/catalog");
const { createClient, signIn, startTestApp, uniqueEmail } = require("./helpers");

const VALID = {
  displayName: "Dr. Ada Example",
  description: "I study fresh-water ecology in the Great Lakes basin.",
  researchAreas: ["Ecology", "Freshwater and Great Lakes Science"],
  inquiryPreference: "open",
  externalLinks: ["https://example.org/lab"],
};

describe("faculty profile", () => {
  let t;
  before(async () => {
    t = await startTestApp();
  });
  after(() => t.close());

  async function faculty(publicProfile = true) {
    return signIn(t, uniqueEmail("prof"), { faculty: true, publicProfile });
  }

  async function storedProfile(userId) {
    const result = await t.db.query("SELECT * FROM faculty_profiles WHERE user_id = $1", [userId]);
    return result.rows[0];
  }

  describe("R1-08: faculty can maintain their own profile", () => {
    test("a verified faculty member can create and then update their profile", async () => {
      const { client, user } = await faculty();
      assert.equal((await client.get("/api/faculty/me/profile")).data.profile, null);

      const created = await client.put("/api/faculty/me/profile", VALID);
      assert.equal(created.status, 200);
      assert.equal(created.data.profile.id, user.id);
      assert.equal(created.data.profile.displayName, VALID.displayName);
      assert.deepEqual(created.data.profile.researchAreas, VALID.researchAreas);
      assert.deepEqual(created.data.profile.externalLinks, VALID.externalLinks);

      const updated = await client.put("/api/faculty/me/profile", {
        ...VALID,
        displayName: "Dr. Ada Updated",
        researchAreas: ["Environmental Science"],
        inquiryPreference: "projects_only",
        externalLinks: [],
      });
      assert.equal(updated.status, 200);

      const mine = (await client.get("/api/faculty/me/profile")).data.profile;
      assert.equal(mine.displayName, "Dr. Ada Updated");
      assert.deepEqual(mine.researchAreas, ["Environmental Science"]);
      assert.equal(mine.inquiryPreferenceCode, "projects_only");
      assert.deepEqual(mine.externalLinks, []);
      const count = await t.db.query("SELECT count(*)::int AS n FROM faculty_profiles WHERE user_id = $1", [user.id]);
      assert.equal(count.rows[0].n, 1);
    });

    test("external links are optional", async () => {
      const { client } = await faculty();
      const { externalLinks, ...withoutLinks } = VALID;
      const saved = await client.put("/api/faculty/me/profile", withoutLinks);
      assert.equal(saved.status, 200);
      assert.deepEqual(saved.data.profile.externalLinks, []);
    });

    test("required fields and formats are validated", async () => {
      const { client, user } = await faculty();
      const bad = [
        { ...VALID, displayName: "   " },
        { ...VALID, displayName: "x".repeat(101) },
        { ...VALID, description: "" },
        { ...VALID, description: "x".repeat(1001) },
        { ...VALID, researchAreas: [] },
        { ...VALID, researchAreas: ["  "] },
        { ...VALID, researchAreas: "Ecology" },
        { ...VALID, researchAreas: RESEARCH_AREAS.slice(0, 11) },
        { ...VALID, researchAreas: ["Water quality"] },
        { ...VALID, inquiryPreference: "maybe" },
        { ...VALID, inquiryPreference: undefined },
        { ...VALID, externalLinks: ["not a url"] },
        { ...VALID, externalLinks: ["javascript:alert(1)"] },
        { ...VALID, externalLinks: "https://example.org" },
      ];
      for (const body of bad) {
        const res = await client.put("/api/faculty/me/profile", body);
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.ok(res.data.error);
      }
      assert.equal(await storedProfile(user.id), undefined);
    });

    test("whitespace is tidied and duplicate areas are dropped", async () => {
      const { client } = await faculty();
      const saved = await client.put("/api/faculty/me/profile", {
        ...VALID,
        displayName: "  Dr.   Ada  ",
        researchAreas: ["Ecology", " ecology ", "", "freshwater and   great lakes science"],
      });
      assert.equal(saved.data.profile.displayName, "Dr. Ada");
      assert.deepEqual(saved.data.profile.researchAreas, ["Ecology", "Freshwater and Great Lakes Science"]);
    });

    test("only verified faculty can create a profile", async () => {
      const { client, user } = await signIn(t, uniqueEmail("student"));
      assert.equal((await client.put("/api/faculty/me/profile", VALID)).status, 403);
      assert.equal((await client.get("/api/faculty/me/profile")).status, 403);
      assert.equal(await storedProfile(user.id), undefined);
      assert.equal((await createClient(t.baseUrl).put("/api/faculty/me/profile", VALID)).status, 401);
    });

    test("R1-05: saving a profile for display needs the public-profile choice first", async () => {
      const { client } = await faculty(null);
      const blocked = await client.put("/api/faculty/me/profile", VALID);
      assert.equal(blocked.status, 409);
      assert.equal(blocked.data.code, "public_profile_choice_required");
    });

    test("R1-06: faculty who decline public display can still keep a profile", async () => {
      const { client } = await faculty(false);
      assert.equal((await client.put("/api/faculty/me/profile", VALID)).status, 200);
    });
  });

  describe("R1-09: inquiry preference is understandable", () => {
    test("all three preferences are offered with plain-language labels", async () => {
      const { client } = await faculty();
      const { inquiryOptions } = (await client.get("/api/faculty/me/profile")).data;
      assert.deepEqual(
        inquiryOptions.map((o) => o.value),
        ["open", "projects_only", "not_accepting"],
      );
      for (const option of inquiryOptions) assert.ok(option.label && option.explanation);
    });

    test("the student-facing profile shows a label, not the internal code", async () => {
      const expected = {
        open: /general student inquiries/i,
        projects_only: /listed projects only/i,
        not_accepting: /not currently accepting/i,
      };
      const { client, user } = await faculty();
      const student = (await signIn(t, uniqueEmail("student"))).client;
      for (const [code, label] of Object.entries(expected)) {
        await client.put("/api/faculty/me/profile", { ...VALID, inquiryPreference: code });
        for (const viewer of [student, createClient(t.baseUrl)]) {
          const { profile } = (await viewer.get(`/api/faculty/${user.id}`)).data;
          assert.match(profile.inquiryPreference.label, label);
          assert.ok(profile.inquiryPreference.explanation);
          assert.equal(profile.inquiryPreferenceCode, undefined);
          assert.ok(!JSON.stringify(profile).includes(code), `profile exposes "${code}"`);
        }
      }
    });
  });

  describe("R1-10: public and signed-in-only profiles differ correctly", () => {
    test("a public profile can be viewed and listed by logged-out visitors", async () => {
      const { client, user } = await faculty(true);
      await client.put("/api/faculty/me/profile", { ...VALID, displayName: "Public Prof" });
      const anon = createClient(t.baseUrl);

      const one = await anon.get(`/api/faculty/${user.id}`);
      assert.equal(one.status, 200);
      assert.equal(one.data.profile.displayName, "Public Prof");
      assert.equal(one.data.profile.publiclyVisible, true);
      assert.ok((await anon.get("/api/faculty")).data.faculty.some((p) => p.id === user.id));
    });

    test("a signed-in-only profile is hidden from logged-out visitors but shown to signed-in users", async () => {
      const { client, user } = await faculty(false);
      await client.put("/api/faculty/me/profile", { ...VALID, displayName: "Private Prof" });

      const anon = createClient(t.baseUrl);
      const direct = await anon.get(`/api/faculty/${user.id}`);
      assert.equal(direct.status, 404);
      assert.ok(!JSON.stringify(direct.data).includes("Private Prof"));
      assert.ok(!(await anon.get("/api/faculty")).data.faculty.some((p) => p.id === user.id));

      const student = (await signIn(t, uniqueEmail("student"))).client;
      const seen = await student.get(`/api/faculty/${user.id}`);
      assert.equal(seen.status, 200);
      assert.equal(seen.data.profile.publiclyVisible, false);
      assert.ok((await student.get("/api/faculty")).data.faculty.some((p) => p.id === user.id));
    });

    test("an unknown profile and a hidden profile get the same 404", async () => {
      const { client, user } = await faculty(false);
      await client.put("/api/faculty/me/profile", VALID);
      const anon = createClient(t.baseUrl);
      const hidden = await anon.get(`/api/faculty/${user.id}`);
      const missing = await anon.get("/api/faculty/999999");
      assert.equal(hidden.status, 404);
      assert.deepEqual(hidden.data, missing.data);
    });

    test("changing the choice changes public visibility immediately", async () => {
      const { client, user } = await faculty(true);
      await client.put("/api/faculty/me/profile", VALID);
      const anon = createClient(t.baseUrl);
      assert.equal((await anon.get(`/api/faculty/${user.id}`)).status, 200);
      await client.put("/api/account/public-profile", { allowPublicProfile: false });
      assert.equal((await anon.get(`/api/faculty/${user.id}`)).status, 404);
      await client.put("/api/account/public-profile", { allowPublicProfile: true });
      assert.equal((await anon.get(`/api/faculty/${user.id}`)).status, 200);
    });

    test("revoked faculty profiles are hidden from everyone", async () => {
      const { client, user } = await faculty(true);
      await client.put("/api/faculty/me/profile", VALID);
      await t.db.query("UPDATE users SET is_verified_faculty = false WHERE id = $1", [user.id]);
      const student = (await signIn(t, uniqueEmail("student"))).client;
      assert.equal((await createClient(t.baseUrl).get(`/api/faculty/${user.id}`)).status, 404);
      assert.equal((await student.get(`/api/faculty/${user.id}`)).status, 404);
    });

    test("profiles expose no account details; the email appears only as the R1-22 contact", async () => {
      const { client, user } = await faculty(true);
      await client.put("/api/faculty/me/profile", VALID);
      const anon = createClient(t.baseUrl);
      const listedProfile = (await anon.get("/api/faculty")).data.faculty.find((p) => p.id === user.id);
      assert.ok(!JSON.stringify(listedProfile).includes(user.email));
      const { profile } = (await anon.get(`/api/faculty/${user.id}`)).data;
      assert.ok(!("email" in profile) && !("isStaff" in profile));
      const { contact, ...rest } = profile;
      assert.deepEqual(contact, { email: user.email });
      assert.ok(!JSON.stringify(rest).includes(user.email));
    });

    test("a non-numeric id is rejected", async () => {
      assert.equal((await createClient(t.baseUrl).get("/api/faculty/abc")).status, 400);
      assert.equal((await createClient(t.baseUrl).get("/api/faculty/99999999999")).status, 400);
      assert.equal((await createClient(t.baseUrl).get("/api/faculty/1e3")).status, 400);
    });
  });

  describe("R1-16: faculty cannot change another faculty member's profile", () => {
    test("ids in the request body are ignored; the owner is always the signed-in user", async () => {
      const a = await faculty();
      const b = await faculty();
      await a.client.put("/api/faculty/me/profile", { ...VALID, displayName: "Owner A" });
      const before = await storedProfile(a.user.id);

      const res = await b.client.put("/api/faculty/me/profile", {
        ...VALID,
        displayName: "Written by B",
        id: a.user.id,
        userId: a.user.id,
        user_id: a.user.id,
        facultyUserId: a.user.id,
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.profile.id, b.user.id);
      assert.deepEqual(await storedProfile(a.user.id), before);
      assert.equal((await storedProfile(b.user.id)).display_name, "Written by B");
    });

    test("there is no route to write a profile by id", async () => {
      const a = await faculty();
      const b = await faculty();
      await a.client.put("/api/faculty/me/profile", { ...VALID, displayName: "Owner A" });
      const before = await storedProfile(a.user.id);
      for (const method of ["put", "patch", "post"]) {
        const res = await b.client[method](`/api/faculty/${a.user.id}`, { ...VALID, displayName: "Hijacked" });
        assert.equal(res.status, 404);
      }
      assert.equal((await b.client.delete(`/api/faculty/${a.user.id}`)).status, 404);
      assert.deepEqual(await storedProfile(a.user.id), before);
    });
  });
});
