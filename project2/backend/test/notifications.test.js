// R2-16 to R2-20: verified faculty subscribe to all new opportunities or to chosen areas from
// their own settings; the settings are private; matching submissions put an entry in their
// in-product notification list; notifications never gate browsing; changes apply to
// submissions from then on. Checked against r2_fixtures/faculty_subscriptions.json and the
// expected recipients in expected_intake_outcomes.json.
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { after, before, describe, test } = require("node:test");
const { buildSubscriptionFixtureSql, intakeRequestBody, loadIntakeFixture, loadSubscriptionFixture } = require("../src/fixture");
const { createClient, loadFixtureInto, signIn, startTestApp, uniqueEmail } = require("./helpers");

const expected = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "r2_fixtures", "expected_intake_outcomes.json"), "utf8"),
);

const PARTNER = {
  organisation: "Algoma Steelworks Lab",
  contactName: "Chris Partner",
  contactEmail: "chris@steelworks-lab.example",
  title: "Notification test idea",
  description: "A project idea used to check notifications.",
  researchAreas: ["Cybersecurity"],
  capacity: "not-sure",
};

describe("faculty notification subscriptions", () => {
  let t;
  let anon;
  let student;
  let fixture;
  let ids; // fixture submission id -> database id
  const clients = new Map(); // fixture faculty id -> signed-in client

  before(async () => {
    t = await startTestApp();
    fixture = await loadFixtureInto(t);
    await t.db.exec(buildSubscriptionFixtureSql(loadSubscriptionFixture()));
    anon = createClient(t.baseUrl);
    student = (await signIn(t, uniqueEmail("student"))).client;
    for (const id of ["F-ALEX", "F-PRIYA", "F-JORDAN", "F-MEI"]) {
      clients.set(id, (await signIn(t, `fixture-${id.toLowerCase()}@algomau.ca`)).client);
    }
    // The fixture's submissions arrive the way a partner sends them.
    ids = new Map();
    for (const s of loadIntakeFixture()) {
      const res = await anon.post("/api/partner-submissions", intakeRequestBody(s));
      if (res.status === 201) ids.set(s.fixture_id, res.data.submission.id);
    }
  });
  after(() => t.close());

  async function notifiedFor(submissionId) {
    const result = await t.db.query(
      `SELECT users.fixture_id, users.id FROM notifications JOIN users ON users.id = notifications.user_id
       WHERE submission_id = $1 ORDER BY users.id`,
      [submissionId],
    );
    return result.rows;
  }

  async function submit(fields = {}) {
    const res = await anon.post("/api/partner-submissions", { ...PARTNER, ...fields });
    assert.equal(res.status, 201);
    return res.data.submission.id;
  }

  async function newFaculty() {
    return signIn(t, uniqueEmail("prof"), { faculty: true, publicProfile: true });
  }

  describe("R2-16 subscribe to all or to areas", () => {
    test("a faculty member saves 'all', 'areas' and 'none' from their own settings", async () => {
      const { client } = await newFaculty();
      assert.deepEqual((await client.get("/api/notifications/subscriptions")).data.subscription.mode, "none");
      let res = await client.put("/api/notifications/subscriptions", { mode: "all" });
      assert.equal(res.status, 200);
      assert.equal(res.data.subscription.mode, "all");
      res = await client.put("/api/notifications/subscriptions", { mode: "areas", researchAreas: ["data science", "Ecology"] });
      assert.equal(res.status, 200);
      assert.deepEqual(res.data.subscription.researchAreas, ["Data Science", "Ecology"]);
      const read = (await client.get("/api/notifications/subscriptions")).data.subscription;
      assert.equal(read.mode, "areas");
      assert.deepEqual(read.researchAreas, ["Data Science", "Ecology"]);
    });

    test("invalid settings are rejected and change nothing", async () => {
      const { client } = await newFaculty();
      await client.put("/api/notifications/subscriptions", { mode: "all" });
      for (const body of [{}, { mode: "some" }, { mode: "areas" }, { mode: "areas", researchAreas: [] }, { mode: "areas", researchAreas: ["Alchemy"] }]) {
        assert.equal((await client.put("/api/notifications/subscriptions", body)).status, 400, JSON.stringify(body));
      }
      assert.equal((await client.get("/api/notifications/subscriptions")).data.subscription.mode, "all");
    });

    test("only verified faculty have subscriptions or notifications", async () => {
      for (const [client, status] of [[anon, 401], [student, 403]]) {
        assert.equal((await client.get("/api/notifications/subscriptions")).status, status);
        assert.equal((await client.put("/api/notifications/subscriptions", { mode: "all" })).status, status);
        assert.equal((await client.get("/api/notifications")).status, status);
      }
    });

    test("subscribing doesn't need the public-display choice (R1-06)", async () => {
      const { client } = await signIn(t, uniqueEmail("undecided"), { faculty: true });
      assert.equal((await client.put("/api/notifications/subscriptions", { mode: "all" })).status, 200);
    });
  });

  describe("R2-17 subscriptions are private", () => {
    test("no public, student-facing or other faculty view shows a subscription", async () => {
      const alex = fixture.facultyId("F-ALEX");
      for (const client of [anon, student, clients.get("F-PRIYA")]) {
        for (const p of ["/api/faculty", `/api/faculty/${alex}`, "/api/projects", "/api/opportunities", "/api/auth/me"]) {
          const text = JSON.stringify((await client.get(p)).data);
          assert.ok(!/subscri|"mode"/i.test(text), `${p} leaks subscription settings`);
        }
      }
      // Each faculty member reads only their own.
      const priya = (await clients.get("F-PRIYA").get("/api/notifications/subscriptions")).data.subscription;
      assert.deepEqual(priya.researchAreas, ["Human-Computer Interaction"]);
    });
  });

  describe("R2-18 notification on match", () => {
    test("the fixture submissions notify exactly the expected faculty, and never F-MEI", async () => {
      for (const [fixtureId, facultyIds] of Object.entries(expected.notified_faculty_by_submission)) {
        const got = (await notifiedFor(ids.get(fixtureId))).map((row) => row.fixture_id).sort();
        assert.deepEqual(got, [...facultyIds].sort(), fixtureId);
      }
      const mei = await t.db.query("SELECT count(*) AS n FROM notifications WHERE user_id = $1", [fixture.facultyId("F-MEI")]);
      assert.equal(Number(mei.rows[0].n), 0);
    });

    test("notified faculty see the opportunity in their notification list", async () => {
      const res = await clients.get("F-JORDAN").get("/api/notifications");
      assert.equal(res.status, 200);
      const listed = res.data.notifications.map((n) => n.opportunity.id).sort((a, b) => a - b);
      assert.deepEqual(listed, [...ids.values()].sort((a, b) => a - b));
      const alex = (await clients.get("F-ALEX").get("/api/notifications")).data.notifications;
      assert.deepEqual(
        alex.map((n) => n.opportunity.title).sort(),
        ["Anomaly review dashboard", "Warehouse pick-path visualisation"],
      );
      // The list never includes the partner's contact details.
      assert.ok(!JSON.stringify(alex).includes("@northwind-robotics.example"));
    });

    test("the rejected submission notifies nobody", async () => {
      const total = await t.db.query("SELECT count(DISTINCT submission_id) AS n FROM notifications");
      assert.ok(Number(total.rows[0].n) >= expected.accepted_submission_ids.length);
      const before = await t.db.query("SELECT count(*) AS n FROM notifications");
      const rejected = loadIntakeFixture().find((s) => s.fixture_id === "S-204");
      assert.equal((await anon.post("/api/partner-submissions", intakeRequestBody(rejected))).status, 400);
      const afterCount = await t.db.query("SELECT count(*) AS n FROM notifications");
      assert.equal(afterCount.rows[0].n, before.rows[0].n);
    });

    test("revoked faculty are not notified", async () => {
      const { client, user } = await newFaculty();
      await client.put("/api/notifications/subscriptions", { mode: "all" });
      await t.db.query("UPDATE users SET is_verified_faculty = false WHERE id = $1", [user.id]);
      const id = await submit();
      assert.ok(!(await notifiedFor(id)).some((row) => row.id === user.id));
    });
  });

  describe("R2-19 notifications don't gate access", () => {
    test("F-MEI, never notified, can still browse and open every opportunity", async () => {
      const mei = clients.get("F-MEI");
      assert.equal((await mei.get("/api/notifications")).data.notifications.length, 0);
      const listed = new Set((await mei.get("/api/partner-submissions")).data.submissions.map((s) => s.id));
      for (const id of ids.values()) {
        assert.ok(listed.has(id));
        assert.equal((await mei.get(`/api/partner-submissions/${id}`)).status, 200);
      }
    });

    test("an unnotified faculty member can still supervise", async () => {
      const mei = clients.get("F-MEI");
      const id = ids.get("S-205"); // notified only F-JORDAN
      const res = await mei.put(`/api/partner-submissions/${id}/willingness`);
      assert.equal(res.status, 200);
      assert.equal(res.data.submission.state.value, "supervised");
      await mei.delete(`/api/partner-submissions/${id}/willingness`);
    });
  });

  describe("R2-20 subscriptions are editable", () => {
    test("a change applies to later submissions and doesn't rewrite earlier notifications", async () => {
      const { client, user } = await newFaculty();
      await client.put("/api/notifications/subscriptions", { mode: "areas", researchAreas: ["Ecology"] });
      const first = await submit({ researchAreas: ["Ecology"] });
      assert.ok((await notifiedFor(first)).some((row) => row.id === user.id));

      await client.put("/api/notifications/subscriptions", { mode: "areas", researchAreas: ["Physics"] });
      const ecology = await submit({ researchAreas: ["Ecology"] });
      const physics = await submit({ researchAreas: ["Physics"] });
      assert.ok(!(await notifiedFor(ecology)).some((row) => row.id === user.id));
      assert.ok((await notifiedFor(physics)).some((row) => row.id === user.id));

      await client.put("/api/notifications/subscriptions", { mode: "none" });
      const later = await submit({ researchAreas: ["Physics"] });
      assert.ok(!(await notifiedFor(later)).some((row) => row.id === user.id));

      const mine = (await client.get("/api/notifications")).data.notifications.map((n) => n.opportunity.id).sort();
      assert.deepEqual(mine, [first, physics].sort(), "earlier notifications are kept; none are added retroactively");
    });

    test("switching to 'all' doesn't notify about opportunities submitted before", async () => {
      const { client } = await newFaculty();
      await client.put("/api/notifications/subscriptions", { mode: "all" });
      assert.equal((await client.get("/api/notifications")).data.notifications.length, 0);
      const id = await submit({ researchAreas: [] });
      const mine = (await client.get("/api/notifications")).data.notifications;
      assert.deepEqual(mine.map((n) => n.opportunity.id), [id], "'all' includes submissions with no areas");
    });
  });
});
