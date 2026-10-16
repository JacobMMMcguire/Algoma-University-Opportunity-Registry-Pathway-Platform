// R2-07 to R2-15, R2-21 to R2-25: an industry opportunity becomes student-visible when the first
// verified faculty member is willing to supervise it; others can join without being blocked;
// withdrawing only removes yourself; faculty see the interest count and partner engagement,
// which locks nothing and is never public; students discover supervised opportunities next to
// faculty projects and contact the supervisors, never the partner; and only verified faculty can
// change any of it, whatever the request says.
const assert = require("node:assert/strict");
const { after, before, describe, test } = require("node:test");
const { createClient, signIn, startTestApp, uniqueEmail } = require("./helpers");

const PARTNER = {
  organisation: "Lakeshore Logistics",
  contactName: "Morgan Partner",
  contactEmail: "morgan@lakeshore-logistics.example",
  title: "Dock scheduling assistant",
  description: "Help us schedule truck arrivals at our loading docks.",
  researchAreas: ["Software Engineering", "Data Science"],
  capacity: "one-team-only",
};

describe("faculty publication gate and coordination", () => {
  let t;
  let anon;
  let student;
  let staff;
  let counter = 0;

  before(async () => {
    t = await startTestApp();
    anon = createClient(t.baseUrl);
    student = (await signIn(t, uniqueEmail("student"))).client;
    staff = (await signIn(t, uniqueEmail("staff"), { staff: true })).client;
  });
  after(() => t.close());

  // A verified faculty member with a profile. `publicProfile: false` means signed-in-only display.
  async function faculty({ publicProfile = true, inquiry = "open", withProfile = true } = {}) {
    counter += 1;
    const signedIn = await signIn(t, uniqueEmail("prof"), { faculty: true, publicProfile });
    const name = `Dr. Supervisor ${counter}`;
    if (withProfile) {
      await t.db.query(
        `INSERT INTO faculty_profiles (user_id, display_name, description, research_areas, inquiry_preference)
         VALUES ($1, $2, 'Research.', '{Software Engineering}', $3)`,
        [signedIn.user.id, name, inquiry],
      );
    }
    return { ...signedIn, name };
  }

  async function submit(fields = {}) {
    counter += 1;
    const res = await anon.post("/api/partner-submissions", { ...PARTNER, title: `${PARTNER.title} ${counter}`, ...fields });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    return res.data.submission.id;
  }

  const willing = (client, id, body) => client.put(`/api/partner-submissions/${id}/willingness`, body);
  const withdraw = (client, id, body) => client.delete(`/api/partner-submissions/${id}/willingness`, body);
  const engage = (client, id, state, extra = {}) => client.put(`/api/partner-submissions/${id}/engagement`, { state, ...extra });
  const review = async (client, id) => (await client.get(`/api/partner-submissions/${id}`)).data.submission;

  async function discoverable(client, id) {
    const list = await client.get("/api/opportunities");
    assert.equal(list.status, 200);
    const listed = list.data.opportunities.some((o) => o.id === id);
    const detail = await client.get(`/api/opportunities/${id}`);
    assert.equal(listed, detail.status === 200, "the list and the detail page must agree");
    if (!listed) assert.equal(detail.status, 404);
    return listed;
  }

  async function supervisorRows(id) {
    const result = await t.db.query("SELECT faculty_user_id FROM opportunity_supervisors WHERE submission_id = $1 ORDER BY faculty_user_id", [id]);
    return result.rows.map((row) => row.faculty_user_id);
  }

  describe("R2-07 first supervisor publishes", () => {
    test("one verified faculty member's willingness makes it student-visible, with no staff step", async () => {
      const id = await submit();
      const a = await faculty();
      assert.equal(await discoverable(student, id), false);
      const res = await willing(a.client, id);
      assert.equal(res.status, 200, JSON.stringify(res.data));
      assert.equal(res.data.submission.state.value, "supervised");
      assert.equal(await discoverable(student, id), true);
      assert.equal(await discoverable(anon, id), true);
    });
  });

  describe("R2-08 awaiting-supervisor state", () => {
    test("faculty see 'Awaiting faculty supervisor' and students can't find it at all", async () => {
      const id = await submit({ title: "Unmistakable awaiting title", researchAreas: ["Cybersecurity"] });
      const a = await faculty();
      const shown = await review(a.client, id);
      assert.equal(shown.state.value, "awaiting_supervisor");
      assert.equal(shown.state.label, "Awaiting faculty supervisor");
      for (const client of [student, anon]) {
        assert.equal(await discoverable(client, id), false);
        for (const query of ["?q=Unmistakable", "?area=Cybersecurity", `?q=${encodeURIComponent(PARTNER.organisation)}`]) {
          const res = await client.get(`/api/opportunities${query}`);
          assert.ok(!res.data.opportunities.some((o) => o.id === id), query);
        }
        const facets = (await client.get("/api/opportunities")).data.filters;
        assert.ok(!JSON.stringify(facets).includes("Cybersecurity"), "filter choices must not reveal it either");
      }
    });
  });

  describe("R2-09 willingness does not lock others out", () => {
    test("a second and third faculty member can record willingness too, equally", async () => {
      const id = await submit();
      const [a, b, c] = [await faculty(), await faculty(), await faculty()];
      assert.equal((await willing(a.client, id)).status, 200);
      assert.equal((await willing(b.client, id)).status, 200);
      const res = await willing(c.client, id);
      assert.equal(res.status, 200);
      assert.equal(res.data.submission.supervisorCount, 3);
      assert.deepEqual(res.data.submission.supervisors.map((s) => s.id).sort(), [a.user.id, b.user.id, c.user.id].sort());
      const studentView = (await student.get(`/api/opportunities/${id}`)).data.opportunity;
      assert.equal(studentView.supervisors.length, 3);
    });

    test("recording willingness twice changes nothing", async () => {
      const id = await submit();
      const a = await faculty();
      await willing(a.client, id);
      const again = await willing(a.client, id);
      assert.equal(again.status, 200);
      assert.equal(again.data.submission.supervisorCount, 1);
    });
  });

  describe("R2-10 withdrawing willingness", () => {
    test("when the only supervisor withdraws, it awaits a supervisor again and leaves discovery", async () => {
      const id = await submit();
      const a = await faculty();
      await willing(a.client, id);
      assert.equal(await discoverable(student, id), true);
      const res = await withdraw(a.client, id);
      assert.equal(res.status, 200);
      assert.equal(res.data.submission.state.value, "awaiting_supervisor");
      assert.equal(res.data.submission.state.label, "Awaiting faculty supervisor");
      assert.equal(await discoverable(student, id), false);
      assert.equal(await discoverable(anon, id), false);
    });

    test("when others remain, it stays student-visible", async () => {
      const id = await submit();
      const [a, b] = [await faculty(), await faculty()];
      await willing(a.client, id);
      await willing(b.client, id);
      const res = await withdraw(a.client, id);
      assert.equal(res.data.submission.state.value, "supervised");
      assert.deepEqual(res.data.submission.supervisors.map((s) => s.id), [b.user.id]);
      assert.equal(await discoverable(student, id), true);
      const studentView = (await student.get(`/api/opportunities/${id}`)).data.opportunity;
      assert.deepEqual(studentView.supervisors.map((s) => s.id), [b.user.id]);
    });

    test("a faculty member can withdraw and record willingness again", async () => {
      const id = await submit();
      const a = await faculty();
      await willing(a.client, id);
      await withdraw(a.client, id);
      const res = await willing(a.client, id);
      assert.equal(res.data.submission.state.value, "supervised");
    });

    test("a supervisor whose verification is revoked stops counting, and comes back if re-verified", async () => {
      const id = await submit();
      const a = await faculty();
      await willing(a.client, id);
      await t.db.query("UPDATE users SET is_verified_faculty = false WHERE id = $1", [a.user.id]);
      assert.equal(await discoverable(student, id), false);
      const other = await faculty();
      assert.equal((await review(other.client, id)).state.value, "awaiting_supervisor");
      await t.db.query("UPDATE users SET is_verified_faculty = true WHERE id = $1", [a.user.id]);
      assert.equal(await discoverable(student, id), true);
    });
  });

  describe("R2-11 visible interest count", () => {
    test("another faculty member sees how many verified faculty are willing, and who", async () => {
      const id = await submit();
      const [a, b, viewer] = [await faculty(), await faculty(), await faculty()];
      assert.equal((await review(viewer.client, id)).supervisorCount, 0);
      await willing(a.client, id);
      await willing(b.client, id);
      const shown = await review(viewer.client, id);
      assert.equal(shown.supervisorCount, 2);
      assert.deepEqual(shown.supervisors.map((s) => s.displayName).sort(), [a.name, b.name].sort());
      assert.equal(shown.viewerIsSupervisor, false);
      const listed = (await viewer.client.get("/api/partner-submissions")).data.submissions.find((s) => s.id === id);
      assert.equal(listed.supervisorCount, 2);
    });
  });

  describe("R2-12 partner engagement state", () => {
    test("starts as Not contacted and can be set to each of the four states", async () => {
      const id = await submit();
      const a = await faculty();
      const shown = await review(a.client, id);
      assert.equal(shown.engagement.value, "not_contacted");
      assert.equal(shown.engagement.label, "Not contacted");
      assert.equal(shown.engagement.by, null);
      const labels = {
        not_contacted: "Not contacted",
        discussion_underway: "Discussion underway",
        partner_confirmed: "Partner confirmed",
        no_longer_pursuing: "No longer pursuing",
      };
      for (const [state, label] of Object.entries(labels)) {
        const res = await engage(a.client, id, state);
        assert.equal(res.status, 200);
        assert.equal(res.data.submission.engagement.value, state);
        assert.equal(res.data.submission.engagement.label, label);
      }
    });

    test("unknown states are rejected and change nothing", async () => {
      const id = await submit();
      const a = await faculty();
      await engage(a.client, id, "discussion_underway");
      for (const state of [undefined, "", "locked", "approved"]) {
        assert.equal((await engage(a.client, id, state)).status, 400);
      }
      assert.equal((await review(a.client, id)).engagement.value, "discussion_underway");
    });
  });

  describe("R2-13 engagement is visible to other faculty", () => {
    test("another faculty member sees that discussion is underway and who is leading it", async () => {
      const id = await submit();
      const [a, b] = [await faculty(), await faculty()];
      await engage(a.client, id, "discussion_underway");
      const shown = await review(b.client, id);
      assert.equal(shown.engagement.label, "Discussion underway");
      assert.deepEqual(shown.engagement.by, { id: a.user.id, displayName: a.name });
      assert.ok(shown.engagement.updatedAt);
      const listed = (await b.client.get("/api/partner-submissions")).data.submissions.find((s) => s.id === id);
      assert.equal(listed.engagement.by.displayName, a.name);
      // Staff can see it as well.
      assert.equal((await review(staff, id)).engagement.by.id, a.user.id);
    });
  });

  describe("R2-14 engagement is not exclusivity", () => {
    test("with discussion underway by one faculty member, another can still volunteer, read the partner contact, and update engagement", async () => {
      const id = await submit();
      const [a, b] = [await faculty(), await faculty()];
      await engage(a.client, id, "discussion_underway");
      await willing(a.client, id);
      const res = await willing(b.client, id);
      assert.equal(res.status, 200);
      assert.equal(res.data.submission.supervisorCount, 2);
      assert.equal(res.data.submission.contact.email, PARTNER.contactEmail);
      const updated = await engage(b.client, id, "partner_confirmed");
      assert.equal(updated.status, 200);
      assert.equal(updated.data.submission.engagement.by.id, b.user.id);
    });
  });

  describe("R2-15 engagement is never public", () => {
    test("students and visitors get no engagement state or engaging faculty member", async () => {
      const id = await submit();
      const [a, b] = [await faculty(), await faculty()];
      await willing(a.client, id);
      await engage(b.client, id, "discussion_underway");
      for (const client of [student, anon]) {
        const text = JSON.stringify([(await client.get("/api/opportunities")).data, (await client.get(`/api/opportunities/${id}`)).data]);
        assert.ok(!/engagement|discussion|not_contacted|Not contacted/i.test(text));
        assert.ok(!text.includes(b.name), "the engaging faculty member must not be named");
        assert.ok(!text.includes(PARTNER.contactEmail) && !text.includes(PARTNER.contactName));
        assert.ok(!/capacity/i.test(text));
      }
    });
  });

  describe("R2-21 students discover supervised opportunities alongside faculty projects", () => {
    test("supervised industry opportunities are listed, marked as industry, and filter like projects", async () => {
      const id = await submit({ title: "Fleet telemetry explorer", researchAreas: ["Data Science"] });
      const a = await faculty();
      await willing(a.client, id);
      const listed = (await student.get("/api/opportunities")).data.opportunities.find((o) => o.id === id);
      assert.equal(listed.kind, "industry");
      assert.equal(listed.organisation, PARTNER.organisation);
      const has = async (query) => (await student.get(`/api/opportunities${query}`)).data.opportunities.some((o) => o.id === id);
      assert.equal(await has("?area=Data%20Science"), true);
      assert.equal(await has("?area=Cybersecurity"), false);
      assert.equal(await has("?q=telemetry"), true);
      assert.equal(await has(`?q=${encodeURIComponent(a.name)}`), true);
      assert.equal(await has(`?q=${encodeURIComponent("Lakeshore")}`), true);
      assert.equal(await has(`?facultyId=${a.user.id}`), true);
      assert.equal(await has("?term=Winter%202027"), false, "industry opportunities have no term");
      assert.equal(await has("?level=undergraduate"), false, "industry opportunities have no level");
      assert.equal((await student.get("/api/opportunities?area=Nonsense")).status, 400);
    });

    test("the projects page lists both kinds and labels each", async () => {
      const html = await (await fetch(`${t.baseUrl}/projects.html`)).text();
      assert.match(html, /id="filter-type"/);
      const script = await (await fetch(`${t.baseUrl}/projects.js`)).text();
      assert.match(script, /\/api\/opportunities/);
      assert.match(script, /Faculty project/);
      assert.match(script, /Industry project/);
    });
  });

  describe("R2-22 supervisor is identified", () => {
    test("students see each supervisor and can open their profile", async () => {
      const id = await submit();
      const [a, b] = [await faculty(), await faculty()];
      await willing(a.client, id);
      await willing(b.client, id);
      const shown = (await student.get(`/api/opportunities/${id}`)).data.opportunity;
      assert.deepEqual(shown.supervisors.map((s) => s.displayName).sort(), [a.name, b.name].sort());
      for (const s of shown.supervisors) assert.equal((await student.get(`/api/faculty/${s.id}`)).status, 200);
    });

    test("logged-out visitors see only supervisors who allowed public display, and only through them", async () => {
      const [pub, priv] = [await faculty(), await faculty({ publicProfile: false })];
      const privateOnly = await submit();
      await willing(priv.client, privateOnly);
      assert.equal(await discoverable(student, privateOnly), true);
      assert.equal(await discoverable(anon, privateOnly), false);

      const mixed = await submit();
      await willing(pub.client, mixed);
      await willing(priv.client, mixed);
      const anonView = (await anon.get(`/api/opportunities/${mixed}`)).data.opportunity;
      assert.deepEqual(anonView.supervisors.map((s) => s.id), [pub.user.id]);
      assert.equal((await anon.get(`/api/faculty/${pub.user.id}`)).status, 200);
      assert.equal((await anon.get(`/api/faculty/${priv.user.id}`)).status, 404);
    });
  });

  describe("R2-23 contact goes to the supervising faculty", () => {
    test("the contact action uses the supervisor's university email, never the partner's", async () => {
      const id = await submit();
      const [open, closed] = [await faculty(), await faculty({ inquiry: "not_accepting" })];
      await willing(open.client, id);
      await willing(closed.client, id);
      for (const client of [student, anon]) {
        const res = await client.get(`/api/opportunities/${id}`);
        const byId = new Map(res.data.opportunity.supervisors.map((s) => [s.id, s]));
        assert.equal(byId.get(open.user.id).contact.email, open.user.email);
        assert.equal(byId.get(closed.user.id).contact, null);
        assert.ok(!JSON.stringify(res.data).includes(PARTNER.contactEmail));
      }
    });
  });

  describe("R2-24 authorization is enforced server-side", () => {
    test("a signed-in student can't record willingness, set engagement, read partner contacts, or change state", async () => {
      const id = await submit();
      const a = await faculty();
      await willing(a.client, id);
      await engage(a.client, id, "discussion_underway");
      assert.equal((await willing(student, id)).status, 403);
      assert.equal((await withdraw(student, id)).status, 403);
      assert.equal((await engage(student, id, "no_longer_pursuing")).status, 403);
      assert.equal((await student.get(`/api/partner-submissions/${id}`)).status, 403);
      assert.equal((await student.get("/api/partner-submissions")).status, 403);
      assert.deepEqual(await supervisorRows(id), [a.user.id]);
      assert.equal((await review(a.client, id)).engagement.value, "discussion_underway");
    });

    test("staff who aren't verified faculty can read but not record willingness or engagement", async () => {
      const id = await submit();
      assert.equal((await staff.get(`/api/partner-submissions/${id}`)).status, 200);
      assert.equal((await willing(staff, id)).status, 403);
      assert.equal((await engage(staff, id, "discussion_underway")).status, 403);
      assert.deepEqual(await supervisorRows(id), []);
    });

    test("logged-out requests are refused", async () => {
      const id = await submit();
      assert.equal((await willing(anon, id)).status, 401);
      assert.equal((await withdraw(anon, id)).status, 401);
      assert.equal((await engage(anon, id, "discussion_underway")).status, 401);
    });

    test("naming someone else in the body records or withdraws only yourself", async () => {
      const id = await submit();
      const [a, b] = [await faculty(), await faculty()];
      await willing(a.client, id);
      const res = await willing(b.client, id, { facultyUserId: a.user.id, userId: a.user.id, supervisors: [] });
      assert.equal(res.status, 200);
      assert.deepEqual(await supervisorRows(id), [a.user.id, b.user.id].sort((x, y) => x - y));
      await withdraw(b.client, id, { facultyUserId: a.user.id });
      assert.deepEqual(await supervisorRows(id), [a.user.id]);
      const engaged = await engage(b.client, id, "discussion_underway", { userId: a.user.id, engagementUserId: a.user.id });
      assert.equal(engaged.data.submission.engagement.by.id, b.user.id);
    });

    test("a faculty member withdrawing when not a supervisor removes nobody", async () => {
      const id = await submit();
      const [a, b] = [await faculty(), await faculty()];
      await willing(a.client, id);
      assert.equal((await withdraw(b.client, id)).status, 200);
      assert.deepEqual(await supervisorRows(id), [a.user.id]);
    });

    test("willingness needs the public-display choice and a profile, like publishing a project", async () => {
      const id = await submit();
      const undecided = await signIn(t, uniqueEmail("undecided"), { faculty: true });
      const choice = await willing(undecided.client, id);
      assert.equal(choice.status, 409);
      assert.equal(choice.data.code, "public_profile_choice_required");
      const noProfile = await faculty({ withProfile: false });
      const profile = await willing(noProfile.client, id);
      assert.equal(profile.status, 409);
      assert.equal(profile.data.code, "faculty_profile_required");
      assert.deepEqual(await supervisorRows(id), []);
      // Declining public display is fine (R1-06).
      const declined = await faculty({ publicProfile: false });
      assert.equal((await willing(declined.client, id)).status, 200);
    });

    test("revoked faculty can't record willingness or engagement", async () => {
      const id = await submit();
      const a = await faculty();
      await t.db.query("UPDATE users SET is_verified_faculty = false WHERE id = $1", [a.user.id]);
      assert.equal((await willing(a.client, id)).status, 403);
      assert.equal((await engage(a.client, id, "discussion_underway")).status, 403);
    });

    test("bad and missing ids are 400 and 404", async () => {
      const a = await faculty();
      assert.equal((await willing(a.client, "abc")).status, 400);
      assert.equal((await willing(a.client, 999999)).status, 404);
      assert.equal((await engage(a.client, 999999, "discussion_underway")).status, 404);
      assert.equal((await student.get("/api/opportunities/999999")).status, 404);
      assert.equal((await student.get("/api/opportunities/abc")).status, 400);
    });
  });

  describe("R2-25 Release 1 regression", () => {
    test("faculty project discovery is unchanged by industry opportunities", async () => {
      const id = await submit({ title: "Must not appear in projects" });
      const a = await faculty();
      await willing(a.client, id);
      for (const client of [student, anon]) {
        const res = await client.get("/api/projects");
        assert.equal(res.status, 200);
        assert.deepEqual(Object.keys(res.data).sort(), ["filters", "projects"]);
        assert.ok(!res.data.projects.some((p) => p.title === "Must not appear in projects"));
      }
    });
  });
});
