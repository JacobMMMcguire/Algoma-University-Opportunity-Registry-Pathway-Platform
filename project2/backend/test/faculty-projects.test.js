// R1-11 to R1-16: faculty create project drafts, publish them explicitly, edit and close their
// own projects; visibility follows the owner's public choice; nobody can change another
// faculty member's project.
const assert = require("node:assert/strict");
const { after, before, describe, test } = require("node:test");
const { createClient, signIn, startTestApp, uniqueEmail } = require("./helpers");

const VALID = {
  title: "Mapping invasive species in the St. Marys River",
  description: "Field sampling and lab identification of invasive plants along the river.",
  researchAreas: ["Ecology", "Field work"],
  studentLevel: "Third- or fourth-year undergraduate",
  targetTerm: "Winter 2027",
  prerequisites: "BIOL 1006 or equivalent. Comfortable working outdoors.",
};

describe("faculty projects", () => {
  let t;
  before(async () => {
    t = await startTestApp();
  });
  after(() => t.close());

  async function faculty(publicProfile = true) {
    return signIn(t, uniqueEmail("prof"), { faculty: true, publicProfile });
  }

  async function student() {
    return (await signIn(t, uniqueEmail("student"))).client;
  }

  async function storedProject(id) {
    const result = await t.db.query("SELECT * FROM projects WHERE id = $1", [id]);
    return result.rows[0];
  }

  async function createDraft(client, fields = {}) {
    const res = await client.post("/api/projects", { ...VALID, ...fields });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    return res.data.project;
  }

  async function createPublished(client, fields = {}) {
    const project = await createDraft(client, fields);
    const res = await client.post(`/api/projects/${project.id}/publish`);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    return res.data.project;
  }

  function listed(res, id) {
    return res.data.projects.some((p) => p.id === id);
  }

  describe("R1-11: faculty can create a project draft", () => {
    test("a verified faculty member can create a draft with every field", async () => {
      const { client, user } = await faculty();
      const project = await createDraft(client);
      assert.equal(project.status, "draft");
      assert.equal(project.title, VALID.title);
      assert.equal(project.description, VALID.description);
      assert.deepEqual(project.researchAreas, VALID.researchAreas);
      assert.equal(project.studentLevel, VALID.studentLevel);
      assert.equal(project.targetTerm, VALID.targetTerm);
      assert.equal(project.prerequisites, VALID.prerequisites);
      assert.equal(project.faculty.id, user.id);
      assert.equal((await storedProject(project.id)).faculty_user_id, user.id);

      const mine = (await client.get("/api/projects/mine")).data;
      assert.deepEqual(mine.projects.map((p) => p.id), [project.id]);
      assert.ok(mine.limits && mine.studentLevelSuggestions.length > 0);
    });

    test("student level and the background note are optional", async () => {
      const { client } = await faculty();
      const { studentLevel, prerequisites, ...required } = VALID;
      const res = await client.post("/api/projects", required);
      assert.equal(res.status, 201);
      assert.equal(res.data.project.studentLevel, null);
      assert.equal(res.data.project.prerequisites, null);

      const blank = await createDraft(client, { studentLevel: "  ", prerequisites: "" });
      assert.equal(blank.studentLevel, null);
      assert.equal(blank.prerequisites, null);
    });

    test("required fields and formats are validated", async () => {
      const { client, user } = await faculty();
      const bad = [
        { ...VALID, title: "  " },
        { ...VALID, title: undefined },
        { ...VALID, title: "x".repeat(151) },
        { ...VALID, description: "" },
        { ...VALID, description: "x".repeat(1001) },
        { ...VALID, researchAreas: [] },
        { ...VALID, researchAreas: [" "] },
        { ...VALID, researchAreas: "Ecology" },
        { ...VALID, researchAreas: Array.from({ length: 11 }, (_, i) => `Area ${i}`) },
        { ...VALID, researchAreas: ["x".repeat(61)] },
        { ...VALID, targetTerm: "" },
        { ...VALID, targetTerm: "x".repeat(61) },
        { ...VALID, studentLevel: 3 },
        { ...VALID, studentLevel: "x".repeat(61) },
        { ...VALID, prerequisites: ["a"] },
        { ...VALID, prerequisites: "x".repeat(1001) },
      ];
      for (const body of bad) {
        const res = await client.post("/api/projects", body);
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.ok(res.data.error && res.data.field);
      }
      const count = await t.db.query("SELECT count(*)::int AS n FROM projects WHERE faculty_user_id = $1", [user.id]);
      assert.equal(count.rows[0].n, 0);
    });

    test("whitespace is tidied and duplicate areas are dropped", async () => {
      const { client } = await faculty();
      const project = await createDraft(client, {
        title: "  Lake   sampling ",
        researchAreas: ["Ecology", " ecology", "", "Water   quality"],
        targetTerm: " Fall  2027 ",
      });
      assert.equal(project.title, "Lake sampling");
      assert.deepEqual(project.researchAreas, ["Ecology", "Water quality"]);
      assert.equal(project.targetTerm, "Fall 2027");
    });

    test("only verified faculty can create projects", async () => {
      const { client, user } = await signIn(t, uniqueEmail("student"));
      assert.equal((await client.post("/api/projects", VALID)).status, 403);
      assert.equal((await client.get("/api/projects/mine")).status, 403);
      assert.equal((await createClient(t.baseUrl).post("/api/projects", VALID)).status, 401);
      const count = await t.db.query("SELECT count(*)::int AS n FROM projects WHERE faculty_user_id = $1", [user.id]);
      assert.equal(count.rows[0].n, 0);
    });

    test("revoked faculty can no longer create or manage projects", async () => {
      const { client, user } = await faculty();
      const project = await createDraft(client);
      await t.db.query("UPDATE users SET is_verified_faculty = false WHERE id = $1", [user.id]);
      assert.equal((await client.post("/api/projects", VALID)).status, 403);
      assert.equal((await client.put(`/api/projects/${project.id}`, VALID)).status, 403);
      assert.equal((await client.post(`/api/projects/${project.id}/publish`)).status, 403);
      assert.equal((await storedProject(project.id)).status, "draft");
    });

    test("R1-06: faculty who haven't chosen or declined public display can still save drafts", async () => {
      for (const choice of [null, false]) {
        const { client } = await faculty(choice);
        await createDraft(client);
      }
    });
  });

  describe("R1-12: saving a draft does not publish it", () => {
    test("a draft is not listed or viewable by students or visitors", async () => {
      const { client } = await faculty(true);
      const project = await createDraft(client, { title: "Secret draft" });
      for (const viewer of [await student(), createClient(t.baseUrl)]) {
        assert.ok(!listed(await viewer.get("/api/projects"), project.id));
        const direct = await viewer.get(`/api/projects/${project.id}`);
        assert.equal(direct.status, 404);
        assert.ok(!JSON.stringify(direct.data).includes("Secret draft"));
      }
    });

    test("a status in the request body is ignored when creating or editing", async () => {
      const { client } = await faculty(true);
      const created = await client.post("/api/projects", { ...VALID, status: "published" });
      assert.equal(created.status, 201);
      assert.equal(created.data.project.status, "draft");

      const edited = await client.put(`/api/projects/${created.data.project.id}`, { ...VALID, status: "published" });
      assert.equal(edited.data.project.status, "draft");
      assert.equal((await storedProject(created.data.project.id)).status, "draft");
      assert.ok(!listed(await createClient(t.baseUrl).get("/api/projects"), created.data.project.id));
    });

    test("editing a published project keeps it published and doesn't need republishing", async () => {
      const { client } = await faculty(true);
      const project = await createPublished(client);
      const edited = await client.put(`/api/projects/${project.id}`, { ...VALID, title: "New title" });
      assert.equal(edited.data.project.status, "published");
      const seen = await createClient(t.baseUrl).get(`/api/projects/${project.id}`);
      assert.equal(seen.data.project.title, "New title");
    });

    test("the owner can preview their own draft by id", async () => {
      const { client } = await faculty(true);
      const project = await createDraft(client);
      const preview = await client.get(`/api/projects/${project.id}`);
      assert.equal(preview.status, 200);
      assert.equal(preview.data.project.status, "draft");
      assert.equal(preview.data.project.publiclyVisible, false);
    });
  });

  describe("R1-13: faculty explicitly publish a project", () => {
    test("the owner can publish a draft, after which it is discoverable", async () => {
      const { client } = await faculty(true);
      const project = await createDraft(client);
      const published = await client.post(`/api/projects/${project.id}/publish`);
      assert.equal(published.status, 200);
      assert.equal(published.data.project.status, "published");
      assert.equal((await storedProject(project.id)).status, "published");
      assert.ok(listed(await (await student()).get("/api/projects"), project.id));
    });

    test("publishing twice is harmless", async () => {
      const { client } = await faculty(true);
      const project = await createPublished(client);
      const again = await client.post(`/api/projects/${project.id}/publish`);
      assert.equal(again.status, 200);
      assert.equal(again.data.project.status, "published");
    });

    test("R1-05: publishing needs the public-profile choice first", async () => {
      const { client } = await faculty(null);
      const project = await createDraft(client);
      const blocked = await client.post(`/api/projects/${project.id}/publish`);
      assert.equal(blocked.status, 409);
      assert.equal(blocked.data.code, "public_profile_choice_required");
      assert.equal((await storedProject(project.id)).status, "draft");
    });

    test("R1-06: faculty who decline public display can still publish", async () => {
      const { client } = await faculty(false);
      const project = await createPublished(client);
      assert.equal(project.status, "published");
    });

    test("students and visitors cannot publish", async () => {
      const { client } = await faculty(true);
      const project = await createDraft(client);
      assert.equal((await (await student()).post(`/api/projects/${project.id}/publish`)).status, 403);
      assert.equal((await createClient(t.baseUrl).post(`/api/projects/${project.id}/publish`)).status, 401);
      assert.equal((await storedProject(project.id)).status, "draft");
    });

    test("publishing an unknown project is a 404, and a malformed id a 400", async () => {
      const { client } = await faculty(true);
      assert.equal((await client.post("/api/projects/999999/publish")).status, 404);
      assert.equal((await client.post("/api/projects/abc/publish")).status, 400);
      assert.equal((await client.post("/api/projects/99999999999/publish")).status, 400);
    });
  });

  describe("R1-14: project visibility follows the faculty member's public choice", () => {
    test("a public faculty member's published project is visible to logged-out visitors", async () => {
      const { client } = await faculty(true);
      const project = await createPublished(client);
      const anon = createClient(t.baseUrl);
      const one = await anon.get(`/api/projects/${project.id}`);
      assert.equal(one.status, 200);
      assert.equal(one.data.project.publiclyVisible, true);
      assert.ok(listed(await anon.get("/api/projects"), project.id));
    });

    test("a signed-in-only faculty member's project is hidden from visitors but shown to signed-in users", async () => {
      const { client } = await faculty(false);
      const project = await createPublished(client, { title: "Members only project" });

      const anon = createClient(t.baseUrl);
      const direct = await anon.get(`/api/projects/${project.id}`);
      assert.equal(direct.status, 404);
      assert.ok(!JSON.stringify(direct.data).includes("Members only project"));
      assert.ok(!listed(await anon.get("/api/projects"), project.id));

      const viewer = await student();
      const seen = await viewer.get(`/api/projects/${project.id}`);
      assert.equal(seen.status, 200);
      assert.equal(seen.data.project.publiclyVisible, false);
      assert.ok(listed(await viewer.get("/api/projects"), project.id));
    });

    test("hidden, draft and missing projects get the same 404", async () => {
      const hiddenOwner = await faculty(false);
      const hidden = await createPublished(hiddenOwner.client);
      const draft = await createDraft((await faculty(true)).client);
      const anon = createClient(t.baseUrl);
      const missing = await anon.get("/api/projects/999999");
      for (const id of [hidden.id, draft.id]) {
        const res = await anon.get(`/api/projects/${id}`);
        assert.equal(res.status, 404);
        assert.deepEqual(res.data, missing.data);
      }
    });

    test("changing the public choice changes project visibility immediately", async () => {
      const { client } = await faculty(true);
      const project = await createPublished(client);
      const anon = createClient(t.baseUrl);
      assert.equal((await anon.get(`/api/projects/${project.id}`)).status, 200);
      await client.put("/api/account/public-profile", { allowPublicProfile: false });
      assert.equal((await anon.get(`/api/projects/${project.id}`)).status, 404);
      assert.ok(!listed(await anon.get("/api/projects"), project.id));
      await client.put("/api/account/public-profile", { allowPublicProfile: true });
      assert.equal((await anon.get(`/api/projects/${project.id}`)).status, 200);
    });

    test("projects of revoked faculty are hidden from everyone else", async () => {
      const { client, user } = await faculty(true);
      const project = await createPublished(client);
      await t.db.query("UPDATE users SET is_verified_faculty = false WHERE id = $1", [user.id]);
      const viewer = await student();
      for (const c of [viewer, createClient(t.baseUrl)]) {
        assert.equal((await c.get(`/api/projects/${project.id}`)).status, 404);
        assert.ok(!listed(await c.get("/api/projects"), project.id));
      }
      // Nothing was deleted: re-verifying brings it back.
      await t.db.query("UPDATE users SET is_verified_faculty = true WHERE id = $1", [user.id]);
      assert.equal((await viewer.get(`/api/projects/${project.id}`)).status, 200);
    });

    test("projects show the owner's profile name but no account details", async () => {
      const { client, user } = await faculty(true);
      await client.put("/api/faculty/me/profile", {
        displayName: "Dr. Named Owner",
        description: "Research.",
        researchAreas: ["Ecology"],
        inquiryPreference: "open",
      });
      const project = await createPublished(client);
      const { project: seen } = (await createClient(t.baseUrl).get(`/api/projects/${project.id}`)).data;
      assert.deepEqual(seen.faculty, { id: user.id, displayName: "Dr. Named Owner" });
      assert.ok(!JSON.stringify(seen).includes(user.email));
      assert.ok(!("email" in seen.faculty));
    });

    test("the list can be narrowed to one faculty member", async () => {
      const a = await faculty(true);
      const b = await faculty(true);
      const pa = await createPublished(a.client);
      const pb = await createPublished(b.client);
      const anon = createClient(t.baseUrl);
      const res = await anon.get(`/api/projects?facultyId=${a.user.id}`);
      assert.ok(listed(res, pa.id));
      assert.ok(!listed(res, pb.id));
      assert.equal((await anon.get("/api/projects?facultyId=abc")).status, 400);
    });
  });

  describe("R1-15: faculty edit and close their own projects", () => {
    test("the owner can edit every field", async () => {
      const { client } = await faculty(true);
      const project = await createDraft(client);
      const changes = {
        title: "Revised title",
        description: "Revised description.",
        researchAreas: ["Limnology"],
        studentLevel: "Graduate",
        targetTerm: "Fall 2027",
        prerequisites: null,
      };
      const res = await client.put(`/api/projects/${project.id}`, changes);
      assert.equal(res.status, 200);
      for (const [key, value] of Object.entries(changes)) assert.deepEqual(res.data.project[key], value, key);
      const stored = await storedProject(project.id);
      assert.equal(stored.title, "Revised title");
      assert.equal(stored.prerequisites, null);
    });

    test("closing withdraws a project from discovery without deleting it", async () => {
      const { client, user } = await faculty(true);
      const project = await createPublished(client);
      const closed = await client.post(`/api/projects/${project.id}/close`);
      assert.equal(closed.status, 200);
      assert.equal(closed.data.project.status, "closed");

      for (const viewer of [await student(), createClient(t.baseUrl)]) {
        assert.ok(!listed(await viewer.get("/api/projects"), project.id));
        assert.equal((await viewer.get(`/api/projects/${project.id}`)).status, 404);
      }

      const stored = await storedProject(project.id);
      assert.equal(stored.status, "closed");
      assert.equal(stored.title, VALID.title);
      assert.ok((await client.get("/api/projects/mine")).data.projects.some((p) => p.id === project.id));
      const account = await t.db.query("SELECT * FROM users WHERE id = $1", [user.id]);
      assert.equal(account.rows[0].is_verified_faculty, true);
    });

    test("closing one project leaves the owner's other projects alone", async () => {
      const { client } = await faculty(true);
      const keep = await createPublished(client, { title: "Keep me" });
      const close = await createPublished(client, { title: "Close me" });
      await client.post(`/api/projects/${close.id}/close`);
      assert.equal((await storedProject(keep.id)).status, "published");
      assert.equal((await storedProject(keep.id)).title, "Keep me");
    });

    test("a closed project can be edited and reopened", async () => {
      const { client } = await faculty(true);
      const project = await createPublished(client);
      await client.post(`/api/projects/${project.id}/close`);
      const edited = await client.put(`/api/projects/${project.id}`, { ...VALID, targetTerm: "Summer 2027" });
      assert.equal(edited.data.project.status, "closed");
      const reopened = await client.post(`/api/projects/${project.id}/publish`);
      assert.equal(reopened.data.project.status, "published");
      assert.equal(reopened.data.project.targetTerm, "Summer 2027");
      assert.ok(listed(await createClient(t.baseUrl).get("/api/projects"), project.id));
    });

    test("a draft can be closed without ever being published", async () => {
      const { client } = await faculty(true);
      const project = await createDraft(client);
      const closed = await client.post(`/api/projects/${project.id}/close`);
      assert.equal(closed.data.project.status, "closed");
    });

    test("there is no route to delete a project", async () => {
      const { client } = await faculty(true);
      const project = await createPublished(client);
      assert.equal((await client.delete(`/api/projects/${project.id}`)).status, 404);
      assert.ok(await storedProject(project.id));
    });

    test("invalid edits are rejected and leave the project unchanged", async () => {
      const { client } = await faculty(true);
      const project = await createDraft(client);
      const before = await storedProject(project.id);
      const res = await client.put(`/api/projects/${project.id}`, { ...VALID, title: "" });
      assert.equal(res.status, 400);
      assert.equal(res.data.field, "title");
      assert.deepEqual(await storedProject(project.id), before);
    });
  });

  describe("R1-16: faculty cannot change another faculty member's project", () => {
    async function twoFaculty() {
      const a = await faculty(true);
      const b = await faculty(true);
      const project = await createPublished(a.client, { title: "Owned by A" });
      return { a, b, project, before: await storedProject(project.id) };
    }

    test("editing another faculty member's project by id is a 404 and changes nothing", async () => {
      const { b, project, before } = await twoFaculty();
      const res = await b.client.put(`/api/projects/${project.id}`, { ...VALID, title: "Hijacked" });
      assert.equal(res.status, 404);
      assert.ok(!JSON.stringify(res.data).includes("Owned by A"));
      assert.deepEqual(await storedProject(project.id), before);
    });

    test("closing or publishing another faculty member's project is a 404 and changes nothing", async () => {
      const { a, b, project, before } = await twoFaculty();
      assert.equal((await b.client.post(`/api/projects/${project.id}/close`)).status, 404);
      assert.deepEqual(await storedProject(project.id), before);

      await a.client.post(`/api/projects/${project.id}/close`);
      const closed = await storedProject(project.id);
      assert.equal((await b.client.post(`/api/projects/${project.id}/publish`)).status, 404);
      assert.deepEqual(await storedProject(project.id), closed);
    });

    test("owner or id fields in the body are ignored", async () => {
      const { a, b, project, before } = await twoFaculty();
      const takeover = {
        ...VALID,
        title: "Written by B",
        id: project.id,
        projectId: project.id,
        facultyUserId: a.user.id,
        faculty_user_id: a.user.id,
        userId: a.user.id,
        faculty: { id: a.user.id },
      };

      const created = await b.client.post("/api/projects", takeover);
      assert.equal(created.status, 201);
      assert.notEqual(created.data.project.id, project.id);
      assert.equal(created.data.project.faculty.id, b.user.id);
      assert.equal((await storedProject(created.data.project.id)).faculty_user_id, b.user.id);

      const ownEdit = await b.client.put(`/api/projects/${created.data.project.id}`, takeover);
      assert.equal(ownEdit.status, 200);
      assert.equal((await storedProject(created.data.project.id)).faculty_user_id, b.user.id);

      assert.deepEqual(await storedProject(project.id), before);
    });

    test("other faculty can't see someone else's drafts, even by id", async () => {
      const a = await faculty(true);
      const b = await faculty(true);
      const draft = await createDraft(a.client);
      assert.equal((await b.client.get(`/api/projects/${draft.id}`)).status, 404);
      assert.ok(!(await b.client.get("/api/projects/mine")).data.projects.some((p) => p.id === draft.id));
    });

    test("staff accounts can't edit faculty projects either", async () => {
      const { project, before } = await twoFaculty();
      const staff = (await signIn(t, uniqueEmail("staff"), { staff: true })).client;
      assert.equal((await staff.put(`/api/projects/${project.id}`, VALID)).status, 403);
      assert.equal((await staff.post(`/api/projects/${project.id}/close`)).status, 403);
      assert.deepEqual(await storedProject(project.id), before);
    });
  });
});
