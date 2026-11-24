// F-14 (FINAL_PLAN.md D5): a notification failure never blocks the submission that caused it, the
// submission can still be found by browsing, and operators can see the failure and retry it.
const assert = require("node:assert/strict");
const { after, before, describe, test } = require("node:test");
const { createClient, signIn, startTestApp, uniqueEmail } = require("./helpers");

const submission = (title) => ({
  organisation: "Lakeside Logistics",
  contactName: "Sam Rivera",
  contactEmail: "sam.rivera@lakeside.example",
  title,
  description: "Route planning for winter deliveries.",
  researchAreas: ["Data Science"],
  capacity: "not-sure",
});

describe("F-14: notification failure is contained", () => {
  let t;
  let partner;
  let staff;
  let faculty;
  let facultyUser;
  let student;

  before(async () => {
    t = await startTestApp();
    partner = createClient(t.baseUrl);
    staff = (await signIn(t, uniqueEmail("staff"), { staff: true })).client;
    ({ client: faculty, user: facultyUser } = await signIn(t, uniqueEmail("faculty"), { faculty: true }));
    student = (await signIn(t, uniqueEmail("student"))).client;
    assert.equal((await faculty.put("/api/notifications/subscriptions", { mode: "all" })).status, 200);
  });
  after(() => t.close());

  const notificationsFor = async (submissionId) =>
    (await t.db.query("SELECT user_id FROM notifications WHERE submission_id = $1", [submissionId])).rows;
  const setSimulation = (enabled) => staff.put("/api/operations/settings/simulate-notification-failure", { enabled });

  test("normally the submission is saved and its subscribers notified, and the delivery is recorded", async () => {
    const res = await partner.post("/api/partner-submissions", submission("Winter routes"));
    assert.equal(res.status, 201);
    const id = res.data.submission.id;
    assert.deepEqual((await notificationsFor(id)).map((r) => r.user_id), [facultyUser.id]);
    const delivery = await t.db.query("SELECT status, notified_count FROM notification_deliveries WHERE submission_id = $1", [id]);
    assert.deepEqual(delivery.rows[0], { status: "delivered", notified_count: 1 });
  });

  describe("when notifying fails", () => {
    let id;
    before(async () => {
      assert.equal((await setSimulation(true)).status, 200);
      const res = await partner.post("/api/partner-submissions", submission("Cold storage audit"));
      assert.equal(res.status, 201, "the partner's submission still succeeds");
      id = res.data.submission.id;
    });

    test("the submission is saved, and faculty can still find it by browsing (R2-19)", async () => {
      assert.equal((await notificationsFor(id)).length, 0);
      const listed = (await faculty.get("/api/partner-submissions")).data.submissions.map((s) => s.id);
      assert.ok(listed.includes(id));
      assert.equal((await faculty.get(`/api/partner-submissions/${id}`)).status, 200);
    });

    test("operators see the failure with a readable reason and no partner contact details (F-23, F-24)", async () => {
      const res = await staff.get("/api/operations/notifications");
      assert.equal(res.status, 200);
      assert.equal(res.data.counts.failed, 1);
      const failure = res.data.deliveries.find((d) => d.submissionId === id);
      assert.equal(failure.title, "Cold storage audit");
      assert.match(failure.lastError, /notification service is unavailable/);
      assert.doesNotMatch(JSON.stringify(res.data), /lakeside\.example|Sam Rivera/);
    });

    test("a retry while it is still failing stays failed and counts the attempt", async () => {
      const retry = await staff.post(`/api/operations/notifications/${id}/retry`);
      assert.equal(retry.data.delivered, false);
      const row = await t.db.query("SELECT status, attempts FROM notification_deliveries WHERE submission_id = $1", [id]);
      assert.deepEqual(row.rows[0], { status: "failed", attempts: 2 });
    });

    test("after the service recovers, a retry notifies the subscribers once", async () => {
      assert.equal((await setSimulation(false)).status, 200);
      assert.equal((await staff.post(`/api/operations/notifications/${id}/retry`)).data.delivered, true);
      assert.equal((await staff.post(`/api/operations/notifications/${id}/retry`)).data.delivered, true);
      assert.deepEqual((await notificationsFor(id)).map((r) => r.user_id), [facultyUser.id]);
      assert.equal((await staff.get("/api/operations/notifications")).data.counts.failed, 0);
      const notified = (await faculty.get("/api/notifications")).data.notifications.map((n) => n.opportunity.id);
      assert.ok(notified.includes(id));
    });

    test("turning the simulation on and off and retrying are recorded with who did it (F-08)", async () => {
      const rows = await t.db.query("SELECT action FROM audit_events WHERE actor_id IS NOT NULL ORDER BY id");
      assert.deepEqual(
        rows.rows.map((r) => r.action),
        [
          "setting.simulate_notification_failure",
          "notification.retry",
          "setting.simulate_notification_failure",
          "notification.retry",
          "notification.retry",
        ],
      );
    });
  });

  test("only staff reach the operations routes", async () => {
    for (const client of [createClient(t.baseUrl), student, faculty]) {
      const expected = client === faculty || client === student ? 403 : 401;
      assert.equal((await client.get("/api/operations/notifications")).status, expected);
      assert.equal((await client.post("/api/operations/notifications/1/retry")).status, expected);
      assert.equal((await client.put("/api/operations/settings/simulate-notification-failure", { enabled: true })).status, expected);
    }
  });

  test("the simulation can't be turned on outside test mode", async () => {
    const live = await startTestApp({ config: { testMode: false } });
    try {
      const { client } = await signIn(live, uniqueEmail("staff"), { staff: true });
      assert.equal((await client.put("/api/operations/settings/simulate-notification-failure", { enabled: true })).status, 403);
    } finally {
      await live.close();
    }
  });
});
