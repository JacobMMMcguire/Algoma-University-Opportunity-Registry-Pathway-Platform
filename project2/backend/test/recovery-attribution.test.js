// F-06 to F-08 (FINAL_PLAN.md D1, D4): mistakes can be corrected without deleting anything, and
// privilege, publication, consent, engagement and match changes record who made them and when.
const assert = require("node:assert/strict");
const { after, before, describe, test } = require("node:test");
const { createClient, signIn, startTestApp, uniqueEmail } = require("./helpers");

const PROFILE = {
  displayName: "Dr. Robin Hale",
  description: "Studies Great Lakes food webs.",
  researchAreas: ["Ecology"],
  inquiryPreference: "open",
  externalLinks: [],
};

describe("F-06 to F-08: recovery and attribution", () => {
  let t;
  let staff;
  let robin;
  let robinUser;
  let other;
  let s1;
  let s1Email;
  let s2;
  let s2Email;
  let outsider;
  let visitor;

  before(async () => {
    t = await startTestApp({ config: { clockDate: "2026-11-06" } });
    visitor = createClient(t.baseUrl);
    staff = (await signIn(t, uniqueEmail("staff"), { staff: true })).client;
    ({ client: robin, user: robinUser } = await signIn(t, uniqueEmail("robin"), { faculty: true, publicProfile: true }));
    other = (await signIn(t, uniqueEmail("other"), { faculty: true, publicProfile: true })).client;
    s1Email = uniqueEmail("student-one");
    s2Email = uniqueEmail("student-two");
    s1 = (await signIn(t, s1Email)).client;
    s2 = (await signIn(t, s2Email)).client;
    outsider = (await signIn(t, uniqueEmail("outsider"))).client;
    assert.equal((await robin.put("/api/faculty/me/profile", PROFILE)).status, 200);
    assert.equal((await other.put("/api/faculty/me/profile", { ...PROFILE, displayName: "Dr. Kai Moss" })).status, 200);
  });
  after(() => t.close());

  const history = async (subjectType, subjectId) => {
    const res = await staff.get(`/api/operations/history?subjectType=${subjectType}&subjectId=${subjectId}&limit=50`);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    return res.data.events.slice().reverse(); // oldest first
  };

  const newProject = async (title) => {
    const res = await robin.post("/api/projects", {
      title,
      description: "Sample the river mouth.",
      researchAreas: ["Ecology"],
      targetTerm: "Winter 2027",
      deadline: "2026-12-15",
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    return res.data.project.id;
  };

  test("F-02, F-08: granting and revoking faculty are recorded with who did it and the values", async () => {
    const { user } = await signIn(t, uniqueEmail("new-faculty"));
    assert.equal((await staff.post(`/api/admin/users/${user.id}/verify-faculty`)).status, 200);
    assert.equal((await staff.post(`/api/admin/users/${user.id}/revoke-faculty`)).status, 200);
    const events = await history("user", user.id);
    assert.deepEqual(
      events.map((e) => [e.action, e.detail.from, e.detail.to]),
      [
        ["faculty.verify", false, true],
        ["faculty.revoke", true, false],
      ],
    );
    assert.ok(events.every((e) => e.by && !Number.isNaN(Date.parse(e.at))));
  });

  test("F-04, F-08: a consent change is recorded and applies at once", async () => {
    const projectId = await newProject("Consent check");
    assert.equal((await robin.post(`/api/projects/${projectId}/publish`)).status, 200);
    assert.equal((await visitor.get(`/api/projects/${projectId}`)).status, 200);
    assert.equal((await robin.put("/api/account/public-profile", { allowPublicProfile: false })).status, 200);
    assert.equal((await visitor.get(`/api/projects/${projectId}`)).status, 404);
    assert.equal((await robin.put("/api/account/public-profile", { allowPublicProfile: true })).status, 200);
    assert.equal((await visitor.get(`/api/projects/${projectId}`)).status, 200);
    const consent = (await history("user", robinUser.id)).filter((e) => e.action === "consent.faculty_public_profile");
    assert.deepEqual(consent.map((e) => [e.detail.from, e.detail.to]), [
      [true, false],
      [false, true],
    ]);
  });

  describe("F-06: a project published by mistake goes back to a draft", () => {
    let projectId;
    before(async () => {
      projectId = await newProject("Published too early");
      assert.equal((await robin.post(`/api/projects/${projectId}/publish`)).status, 200);
    });

    test("only the owner can unpublish it; anyone else gets 404 and nothing changes", async () => {
      assert.equal((await other.post(`/api/projects/${projectId}/unpublish`)).status, 404);
      assert.equal((await s1.post(`/api/projects/${projectId}/unpublish`)).status, 403);
      assert.equal((await visitor.post(`/api/projects/${projectId}/unpublish`)).status, 401);
      assert.equal((await visitor.get(`/api/projects/${projectId}`)).status, 200);
    });

    test("unpublishing hides it everywhere, keeps the record, and publishing again restores it", async () => {
      const res = await robin.post(`/api/projects/${projectId}/unpublish`);
      assert.equal(res.status, 200);
      assert.equal(res.data.project.status, "draft");
      assert.equal((await visitor.get(`/api/projects/${projectId}`)).status, 404);
      assert.equal((await s1.get(`/api/projects/${projectId}`)).status, 404);
      assert.ok(!(await s1.get("/api/projects")).data.projects.some((p) => p.id === projectId));
      assert.equal((await robin.get(`/api/projects/${projectId}`)).status, 200, "the owner can still preview it");
      assert.equal((await robin.post(`/api/projects/${projectId}/unpublish`)).status, 409);

      assert.equal((await robin.post(`/api/projects/${projectId}/publish`)).status, 200);
      assert.equal((await visitor.get(`/api/projects/${projectId}`)).status, 200);
      const events = await history("project", projectId);
      assert.deepEqual(
        events.map((e) => [e.action, e.detail.from, e.detail.to]),
        [
          ["project.publish", "draft", "published"],
          ["project.unpublish", "published", "draft"],
          ["project.publish", "draft", "published"],
        ],
      );
    });
  });

  test("F-06, F-07: a mistaken engagement state is corrected, and the earlier one is kept", async () => {
    const created = await createClient(t.baseUrl).post("/api/partner-submissions", {
      organisation: "Northshore Mills",
      contactName: "Ada Park",
      contactEmail: "ada.park@northshore.example",
      title: "Sawdust reuse study",
      description: "Find uses for mill waste.",
      researchAreas: ["Ecology"],
      capacity: "not-sure",
    });
    const id = created.data.submission.id;
    assert.equal((await robin.put(`/api/partner-submissions/${id}/engagement`, { state: "discussion_underway" })).status, 200);
    assert.equal((await other.put(`/api/partner-submissions/${id}/engagement`, { state: "partner_confirmed" })).status, 200);
    const fixed = await robin.put(`/api/partner-submissions/${id}/engagement`, { state: "discussion_underway" });
    assert.equal(fixed.data.submission.engagement.value, "discussion_underway");
    const events = await history("partner_submission", id);
    assert.deepEqual(
      events.map((e) => [e.action, e.detail.from, e.detail.to, e.by]),
      [
        ["engagement.set", "not_contacted", "discussion_underway", "Dr. Robin Hale"],
        ["engagement.set", "discussion_underway", "partner_confirmed", "Dr. Kai Moss"],
        ["engagement.set", "partner_confirmed", "discussion_underway", "Dr. Robin Hale"],
      ],
    );
    assert.doesNotMatch(JSON.stringify(events), /ada\.park|Ada Park/, "no partner contact details in the log (F-24)");
  });

  describe("F-06: undoing a mistaken match confirmation", () => {
    let projectId;
    let matchId;

    before(async () => {
      projectId = await newProject("River mouth sampling");
      assert.equal((await robin.post(`/api/projects/${projectId}/publish`)).status, 200);
      const res = await robin.post("/api/matches", { kind: "project", opportunityId: projectId, students: [s1Email, s2Email] });
      assert.equal(res.status, 201, JSON.stringify(res.data));
      matchId = res.data.match.id;
      assert.equal((await s1.post(`/api/matches/${matchId}/confirm`)).status, 200);
      assert.equal((await s2.post(`/api/matches/${matchId}/confirm`)).status, 200);
    });

    const lifecycleState = async () => (await robin.get(`/api/lifecycle/project/${projectId}`)).data.item.lifecycle.state;
    const undo = (client, body) => client.post(`/api/matches/${matchId}/undo-confirmation`, body);

    test("a fully confirmed match still can't be declined (R3-04), but it can be undone", async () => {
      assert.equal(await lifecycleState(), "matched");
      const match = (await s1.get(`/api/matches/${matchId}`)).data.match;
      assert.equal(match.state, "confirmed");
      assert.equal(match.you.canDecline, false);
      assert.equal(match.you.canUndoConfirmation, true);
      assert.equal((await s1.post(`/api/matches/${matchId}/decline`)).status, 409);
    });

    test("people outside the match get 404, and a non-managing faculty member can't undo it", async () => {
      assert.equal((await undo(outsider)).status, 404);
      assert.equal((await undo(other, { studentEmail: s1Email })).status, 404);
      assert.equal((await undo(visitor)).status, 401);
      assert.equal((await s1.get(`/api/matches/${matchId}`)).data.match.state, "confirmed");
    });

    test("a student undoes only their own confirmation; the run is no longer Matched", async () => {
      // Naming someone else in the body changes nothing: a student always undoes their own.
      const res = await undo(s1, { studentEmail: s2Email });
      assert.equal(res.status, 200, JSON.stringify(res.data));
      assert.equal(res.data.match.state, "partly_confirmed");
      const responses = Object.fromEntries(res.data.match.students.map((s) => [s.email, s.response]));
      assert.deepEqual(responses, { [s1Email]: "pending", [s2Email]: "confirmed" });
      assert.equal(await lifecycleState(), "open");
      assert.equal((await undo(s1)).status, 409, "nothing left to undo");
      assert.equal((await s1.post(`/api/matches/${matchId}/confirm`)).status, 200);
      assert.equal(await lifecycleState(), "matched");
    });

    test("the managing faculty member returns a named student's answer to not answered", async () => {
      assert.equal((await undo(robin, {})).status, 400);
      assert.equal((await undo(robin, { studentEmail: uniqueEmail("nobody") })).status, 400);
      const res = await undo(robin, { studentEmail: s2Email });
      assert.equal(res.status, 200);
      assert.equal(res.data.match.students.find((s) => s.email === s2Email).response, "pending");
      assert.equal((await s2.post(`/api/matches/${matchId}/confirm`)).status, 200);
    });

    test("RC-03: with an outcome recorded, undoing keeps the outcome but takes it off the showcase until reconfirmed", async () => {
      const recorded = await s1.post("/api/outcomes", {
        matchId,
        summary: "Sampled the river mouth over six weeks.",
        completedOn: "2026-11-05",
        links: {},
        students: [s2Email],
        faculty: [robinUser.id],
      });
      assert.equal(recorded.status, 201, JSON.stringify(recorded.data));
      const outcomeId = recorded.data.outcome.id;
      assert.equal((await robin.post(`/api/outcomes/${outcomeId}/confirm`)).status, 200);
      const showcased = async () => (await visitor.get("/api/outcomes/showcase")).data.outcomes.some((o) => o.id === outcomeId);
      assert.equal(await showcased(), true);

      const before = (await s1.get(`/api/matches/${matchId}`)).data.match;
      assert.match(before.you.undoWarning, /outcome has been recorded/);
      assert.equal((await undo(s1)).status, 200);
      assert.equal(await showcased(), false, "not public while the match isn't fully confirmed");
      assert.equal((await s1.get(`/api/outcomes/${outcomeId}`)).status, 200, "the participants still have it");
      assert.equal((await s1.post(`/api/matches/${matchId}/confirm`)).status, 200);
      assert.equal(await showcased(), true);
    });

    test("F-08: every answer and undo is recorded with who did it", async () => {
      const events = await history("match", matchId);
      assert.deepEqual(
        events.map((e) => [e.action, e.detail.by || null]),
        [
          ["match.propose", null],
          ["match.confirm", null],
          ["match.confirm", null],
          ["match.undo_confirmation", "student"],
          ["match.confirm", null],
          ["match.undo_confirmation", "faculty"],
          ["match.confirm", null],
          ["match.undo_confirmation", "student"],
          ["match.confirm", null],
        ],
      );
      assert.equal(events[3].detail.studentEmail, s1Email);
      assert.equal(events[5].detail.studentEmail, s2Email);
      assert.equal(events[5].by, "Dr. Robin Hale");
    });
  });

  test("F-08: only staff read the history, and it pages", async () => {
    for (const [client, status] of [
      [visitor, 401],
      [s1, 403],
      [robin, 403],
    ]) {
      assert.equal((await client.get("/api/operations/history")).status, status);
    }
    const first = await staff.get("/api/operations/history?limit=2");
    assert.equal(first.data.events.length, 2);
    assert.ok(first.data.next);
    const second = await staff.get(`/api/operations/history?limit=2&before=${first.data.next}`);
    assert.ok(second.data.events.every((e) => e.id < first.data.next));
    assert.equal((await staff.get("/api/operations/history?subjectId=abc")).status, 400);
  });
});
