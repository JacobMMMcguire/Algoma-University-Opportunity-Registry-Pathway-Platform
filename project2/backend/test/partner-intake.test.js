// R2-01 to R2-06: accountless partner intake. Anyone can submit a project idea without an
// account; it arrives awaiting a faculty supervisor, visible only to verified faculty and staff; partner text is
// data; incomplete submissions leave nothing behind; contact details never reach students or
// the public; capacity is captured and shown to faculty. Checked against the R2 fixture.
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { after, before, describe, test } = require("node:test");
const { buildIntakeFixtureSql, intakeRequestBody, loadIntakeFixture } = require("../src/fixture");
const { createClient, loadFixtureInto, signIn, startTestApp, uniqueEmail } = require("./helpers");

const FIXTURE_DIR = path.join(__dirname, "..", "..", "r2_fixtures");
const expected = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "expected_intake_outcomes.json"), "utf8"));
const fixtureSubmissions = loadIntakeFixture();
const byFixtureId = (id) => fixtureSubmissions.find((s) => s.fixture_id === id);

const VALID = {
  organisation: "Soo Greenhouse Co-op",
  contactName: "Sam Partner",
  contactEmail: "sam@soo-greenhouse.example",
  title: "Greenhouse humidity logger",
  description: "Log humidity readings and flag days outside the safe range.",
  researchAreas: ["Data Science"],
  capacity: "multiple-teams",
};

describe("partner intake", () => {
  let t;
  let anon;
  let staff;
  let faculty;
  let student;
  let ids; // fixture id -> submission id, for the fixture submissions accepted through the API

  before(async () => {
    t = await startTestApp();
    await loadFixtureInto(t);
    anon = createClient(t.baseUrl);
    staff = (await signIn(t, uniqueEmail("staff"), { staff: true })).client;
    faculty = (await signIn(t, uniqueEmail("prof"), { faculty: true, publicProfile: true })).client;
    student = (await signIn(t, uniqueEmail("student"))).client;

    // Every fixture submission, sent the way a partner would: logged out, through the API.
    ids = new Map();
    for (const s of fixtureSubmissions) {
      const res = await anon.post("/api/partner-submissions", intakeRequestBody(s));
      if (res.status === 201) ids.set(s.fixture_id, res.data.submission.id);
    }
  });
  after(() => t.close());

  async function stored(id) {
    return (await t.db.query("SELECT * FROM partner_submissions WHERE id = $1", [id])).rows[0];
  }

  async function supervisorCount(id) {
    return Number((await t.db.query("SELECT count(*) AS n FROM opportunity_supervisors WHERE submission_id = $1", [id])).rows[0].n);
  }

  async function count() {
    return Number((await t.db.query("SELECT count(*) AS n FROM partner_submissions")).rows[0].n);
  }

  // Everything a student or logged-out visitor can fetch, as one string to search.
  async function everythingVisibleTo(client) {
    const paths = ["/api/projects", "/api/opportunities", "/api/faculty", "/api/options", "/api/partner-submissions"];
    for (const id of ids.values()) {
      paths.push(`/api/partner-submissions/${id}`, `/api/opportunities/${id}`);
    }
    const bodies = [];
    for (const p of paths) bodies.push(JSON.stringify((await client.get(p)).data));
    return bodies.join("\n");
  }

  describe("R2-01 public intake surface", () => {
    test("the intake form page is served to logged-out visitors", async () => {
      const res = await fetch(`${t.baseUrl}/partner.html`);
      assert.equal(res.status, 200);
      const html = await res.text();
      for (const id of ["organisation", "contactName", "contactEmail", "title", "description", "researchAreas-picker", "capacity"]) {
        assert.match(html, new RegExp(`id="${id}"`), id);
      }
    });

    test("a logged-out visitor submits every field with no account and no sign-in", async () => {
      const usersBefore = (await t.db.query("SELECT count(*) AS n FROM users")).rows[0].n;
      const client = createClient(t.baseUrl);
      const res = await client.post("/api/partner-submissions", VALID);
      assert.equal(res.status, 201, JSON.stringify(res.data));
      assert.equal(res.data.submission.state.value, "awaiting_supervisor");
      const row = await stored(res.data.submission.id);
      assert.equal(row.organisation, VALID.organisation);
      assert.equal(row.contact_name, VALID.contactName);
      assert.equal(row.contact_email, VALID.contactEmail);
      assert.equal(row.title, VALID.title);
      assert.equal(row.description, VALID.description);
      assert.deepEqual(row.research_areas, VALID.researchAreas);
      assert.equal(row.capacity, VALID.capacity);
      // No account was made, and no session cookie handed out.
      assert.equal((await t.db.query("SELECT count(*) AS n FROM users")).rows[0].n, usersBefore);
      assert.equal((await client.get("/api/auth/me")).data.authenticated, false);
    });

    test("the fixture's accepted submissions are accepted", () => {
      assert.deepEqual([...ids.keys()].sort(), [...expected.accepted_submission_ids].sort());
    });

    test("the same partner can submit more than once", async () => {
      const [first, second] = expected.same_partner_multiple_submissions["Northwind Robotics"];
      assert.ok(ids.get(first) && ids.get(second));
      assert.notEqual(ids.get(first), ids.get(second));
      assert.equal((await stored(ids.get(first))).organisation, (await stored(ids.get(second))).organisation);
    });

    test("multiple areas are kept, in the fixed list's spelling", async () => {
      const res = await anon.post("/api/partner-submissions", { ...VALID, researchAreas: ["data science", "Software Engineering"] });
      assert.equal(res.status, 201);
      assert.deepEqual((await stored(res.data.submission.id)).research_areas, ["Data Science", "Software Engineering"]);
    });
  });

  describe("R2-02 intake is not publication", () => {
    test("every accepted submission arrives with no supervisor, awaiting one", async () => {
      for (const id of ids.values()) {
        assert.equal(await supervisorCount(id), 0);
        assert.equal((await faculty.get(`/api/partner-submissions/${id}`)).data.submission.state.value, "awaiting_supervisor");
      }
    });

    test("logged-out visitors and students cannot list or open submissions", async () => {
      const id = ids.get("S-201");
      assert.equal((await anon.get("/api/partner-submissions")).status, 401);
      assert.equal((await anon.get(`/api/partner-submissions/${id}`)).status, 401);
      assert.equal((await student.get("/api/partner-submissions")).status, 403);
      assert.equal((await student.get(`/api/partner-submissions/${id}`)).status, 403);
    });

    test("no fixture submission is student-visible on arrival", async () => {
      assert.deepEqual(expected.student_visible_on_arrival, []);
      for (const client of [anon, student]) {
        const text = await everythingVisibleTo(client);
        for (const s of fixtureSubmissions) {
          if (s.title) assert.ok(!text.includes(s.title), `"${s.title}" leaked`);
        }
      }
    });

    test("verified faculty and staff see every accepted submission", async () => {
      for (const client of [faculty, staff]) {
        const res = await client.get("/api/partner-submissions");
        assert.equal(res.status, 200);
        const listed = new Set(res.data.submissions.map((s) => s.id));
        for (const id of ids.values()) assert.ok(listed.has(id));
        assert.ok(res.data.submissions.every((s) => s.state.value === "awaiting_supervisor"));
      }
    });

    test("faculty whose verification is revoked lose access", async () => {
      const { client, user } = await signIn(t, uniqueEmail("revoked"), { faculty: true, publicProfile: true });
      assert.equal((await client.get("/api/partner-submissions")).status, 200);
      await t.db.query("UPDATE users SET is_verified_faculty = false WHERE id = $1", [user.id]);
      assert.equal((await client.get("/api/partner-submissions")).status, 403);
    });
  });

  describe("R2-03 partner data is untrusted", () => {
    const hostileId = expected.untrusted_content_submission_id;

    test("the hostile fixture submission is stored verbatim as an ordinary submission awaiting a supervisor", async () => {
      const row = await stored(ids.get(hostileId));
      assert.equal(row.description, byFixtureId(hostileId).description);
      assert.equal(row.engagement_state, "not_contacted");
      assert.equal(await supervisorCount(ids.get(hostileId)), 0);
    });

    test("faculty get the text back as plain data, unchanged", async () => {
      const res = await faculty.get(`/api/partner-submissions/${ids.get(hostileId)}`);
      assert.equal(res.status, 200);
      assert.equal(res.data.submission.description, byFixtureId(hostileId).description);
      assert.equal(res.data.submission.state.value, "awaiting_supervisor");
      assert.equal(res.data.submission.supervisorCount, 0);
    });

    test("state, approval or supervision fields in the body are ignored", async () => {
      const res = await anon.post("/api/partner-submissions", {
        ...VALID,
        status: "published",
        state: "supervised",
        engagementState: "partner_confirmed",
        supervisors: [1],
        approved: true,
        supervised: true,
        verified: true,
        supervisorId: 1,
        id: 999999,
        fixture_id: "S-999",
      });
      assert.equal(res.status, 201);
      const row = await stored(res.data.submission.id);
      assert.equal(await supervisorCount(row.id), 0);
      assert.equal(row.engagement_state, "not_contacted");
      assert.notEqual(row.id, 999999);
      assert.equal(row.fixture_id, null);
      assert.deepEqual(Object.keys(res.data.submission).sort(), ["createdAt", "id", "state", "title"]);
    });

    test("SQL-looking text is stored as text and changes nothing else", async () => {
      const before = await count();
      const sneaky = "x'); INSERT INTO opportunity_supervisors VALUES (1, 1); --";
      const res = await anon.post("/api/partner-submissions", { ...VALID, title: sneaky, organisation: sneaky });
      assert.equal(res.status, 201);
      assert.equal((await stored(res.data.submission.id)).title, sneaky);
      assert.equal(await count(), before + 1);
      const supervised = await t.db.query("SELECT count(*) AS n FROM opportunity_supervisors");
      assert.equal(Number(supervised.rows[0].n), 0);
    });

    test("NUL and other control characters are removed rather than breaking the save", async () => {
      const res = await anon.post("/api/partner-submissions", { ...VALID, title: "Bad\u0000 title\u0007", description: "Line one\nLine two\u0000" });
      assert.equal(res.status, 201, JSON.stringify(res.data));
      const row = await stored(res.data.submission.id);
      assert.equal(row.title, "Bad title");
      assert.equal(row.description, "Line one\nLine two");
    });

    test("the review page renders partner text with textContent, never as HTML", () => {
      const script = fs.readFileSync(path.join(__dirname, "..", "public", "submissions.js"), "utf8");
      // The one innerHTML is the fixed "Please sign in" message, which holds no partner text.
      const htmlSinks = script.match(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/g) || [];
      assert.equal(htmlSinks.length, 1);
      assert.match(script, /\$\("denied"\)\.innerHTML = 'Please <a href="index.html">sign in<\/a> first.';/);
    });
  });

  describe("R2-04 required fields are validated", () => {
    test("the fixture's rejected submission is rejected with actionable reasons for each problem", async () => {
      for (const fixtureId of expected.rejected_submission_ids) {
        const before = await count();
        const res = await anon.post("/api/partner-submissions", intakeRequestBody(byFixtureId(fixtureId)));
        assert.equal(res.status, 400);
        assert.equal(await count(), before, "a rejected submission must not create a record");
        const fields = res.data.errors.map((e) => e.field).sort();
        // S-204: "organisation is empty", "title is empty".
        assert.deepEqual(fields, ["organisation", "title"]);
        assert.match(res.data.error, /organisation/i);
        assert.match(res.data.error, /title/i);
      }
    });

    for (const [field, label] of [
      ["organisation", "organisation"],
      ["contactEmail", "email"],
      ["title", "title"],
    ]) {
      test(`missing ${field} is rejected and stores nothing`, async () => {
        for (const value of [undefined, "", "   "]) {
          const before = await count();
          const res = await anon.post("/api/partner-submissions", { ...VALID, [field]: value });
          assert.equal(res.status, 400);
          assert.equal(res.data.field, field);
          assert.match(res.data.errors[0].message, new RegExp(label, "i"));
          assert.equal(await count(), before);
        }
      });
    }

    test("other invalid values are rejected and store nothing", async () => {
      const cases = [
        { contactEmail: "not an email" },
        { contactName: "" },
        { description: "" },
        { capacity: "" },
        { capacity: "dozens" },
        { researchAreas: ["Underwater Basket Weaving"] },
        { researchAreas: "Data Science" },
        { title: "x".repeat(151) },
        { description: "x".repeat(1001) },
      ];
      for (const fields of cases) {
        const before = await count();
        const res = await anon.post("/api/partner-submissions", { ...VALID, ...fields });
        assert.equal(res.status, 400, JSON.stringify(fields));
        assert.ok(res.data.errors.length >= 1);
        assert.equal(await count(), before);
      }
    });

    test("a non-object or malformed body is a 400, not a crash", async () => {
      const before = await count();
      for (const body of ["[]", '"text"', "{bad json"]) {
        const res = await fetch(`${t.baseUrl}/api/partner-submissions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
        assert.equal(res.status, 400, body);
      }
      assert.equal(await count(), before);
    });

    test("areas are optional", async () => {
      const res = await anon.post("/api/partner-submissions", { ...VALID, researchAreas: [] });
      assert.equal(res.status, 201);
      assert.deepEqual((await stored(res.data.submission.id)).research_areas, []);
    });

    test("rejected fixture submissions never appear in faculty or staff views", async () => {
      for (const client of [faculty, staff]) {
        const res = await client.get("/api/partner-submissions");
        const descriptions = res.data.submissions.map((s) => s.description);
        for (const fixtureId of expected.rejected_submission_ids) {
          assert.ok(!descriptions.includes(byFixtureId(fixtureId).description));
        }
      }
    });
  });

  describe("R2-05 partner contact details are not public", () => {
    test("faculty and staff see the contact name and email", async () => {
      const s = byFixtureId("S-201");
      for (const client of [faculty, staff]) {
        const res = await client.get(`/api/partner-submissions/${ids.get("S-201")}`);
        assert.deepEqual(res.data.submission.contact, { name: s.contact_name, email: s.contact_email });
        const list = await client.get("/api/partner-submissions");
        const listed = list.data.submissions.find((x) => x.id === ids.get("S-201"));
        assert.equal(listed.contact.email, s.contact_email);
      }
    });

    test("no contact name or email appears anywhere a student or logged-out visitor can reach", async () => {
      for (const client of [anon, student]) {
        const text = await everythingVisibleTo(client);
        for (const s of fixtureSubmissions) {
          assert.ok(!text.includes(s.contact_email), `${s.contact_email} leaked`);
          if (s.contact_name !== "Unknown") assert.ok(!text.includes(s.contact_name), `${s.contact_name} leaked`);
        }
      }
    });

    test("the submit response doesn't echo contact details", async () => {
      const res = await anon.post("/api/partner-submissions", VALID);
      assert.ok(!JSON.stringify(res.data).includes(VALID.contactEmail));
      assert.ok(!JSON.stringify(res.data).includes(VALID.contactName));
    });
  });

  describe("R2-06 capacity indication", () => {
    test("the form's capacity choices come from /api/options", async () => {
      const res = await anon.get("/api/options");
      assert.deepEqual(
        res.data.partnerCapacities.map((c) => c.value),
        ["one-team-only", "multiple-teams", "not-sure"],
      );
    });

    test("each fixture submission's capacity is stored and shown to faculty with a label", async () => {
      const res = await faculty.get("/api/partner-submissions");
      const byId = new Map(res.data.submissions.map((s) => [s.id, s]));
      for (const [capacity, fixtureIds] of Object.entries(expected.capacity_spread)) {
        for (const fixtureId of fixtureIds) {
          const shown = byId.get(ids.get(fixtureId)).capacity;
          assert.equal(shown.value, capacity);
          assert.ok(shown.label.length > 0);
        }
      }
    });
  });

  describe("fixture seeding", () => {
    test("seeding loads the accepted fixture submissions awaiting a supervisor, skips the rejected one, and is rerunnable", async () => {
      const sql = buildIntakeFixtureSql(fixtureSubmissions);
      await t.db.exec(sql);
      await t.db.exec(sql);
      const seeded = await t.db.query(
        "SELECT fixture_id, engagement_state FROM partner_submissions WHERE fixture_id IS NOT NULL ORDER BY fixture_id",
      );
      assert.deepEqual(
        seeded.rows.map((r) => r.fixture_id),
        [...expected.accepted_submission_ids].sort(),
      );
      assert.ok(seeded.rows.every((r) => r.engagement_state === "not_contacted"));
      const supervised = await t.db.query(
        "SELECT count(*) AS n FROM opportunity_supervisors os JOIN partner_submissions ps ON ps.id = os.submission_id WHERE ps.fixture_id IS NOT NULL",
      );
      assert.equal(Number(supervised.rows[0].n), 0);
    });
  });
});
