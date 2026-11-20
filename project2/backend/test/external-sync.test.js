// R4-08 to R4-17, R4-20, R4-26: synchronising the supplied feeds, checked against the R4 fixture's
// expected_sync_results.json (v1 is last week's sync, v2 this week's).
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { after, before, describe, test } = require("node:test");
const { createClient, signIn, startTestApp, uniqueEmail } = require("./helpers");

const expected = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "r4_fixtures", "expected_sync_results.json"), "utf8"));
const SOURCE = "mitacs-demo";

describe("external source synchronisation (R4 fixture)", () => {
  let t;
  let anon;
  let staff;
  let faculty;
  let facultyUser;
  let student;
  let studentUser;
  const ids = {};

  const run = (feed, client = staff) => client.post("/api/external-sync/run", { sourceId: SOURCE, feed });
  const classes = (result, classification) =>
    result.data.items.filter((i) => i.classification === classification).map((i) => i.externalId).sort();
  const snapshot = async () =>
    (await t.db.query("SELECT id, external_id, title, description, areas, authoritative_url, closes_on, source_state FROM external_opportunities ORDER BY id")).rows;

  before(async () => {
    t = await startTestApp();
    anon = createClient(t.baseUrl);
    staff = (await signIn(t, uniqueEmail("staff"), { staff: true })).client;
    ({ client: faculty, user: facultyUser } = await signIn(t, uniqueEmail("faculty"), { faculty: true, publicProfile: true }));
    await t.db.query("INSERT INTO faculty_profiles (user_id, display_name, research_areas) VALUES ($1, 'Dr. Interested', '{Cybersecurity}')", [facultyUser.id]);
    ({ client: student, user: studentUser } = await signIn(t, uniqueEmail("student")));
  });
  after(() => t.close());

  test("R4-26: only staff can trigger a sync or read sync health", async () => {
    assert.equal((await run("v1", anon)).status, 401);
    assert.equal((await run("v1", student)).status, 403);
    assert.equal((await run("v1", faculty)).status, 403);
    assert.equal((await anon.get("/api/external-sync/health")).status, 401);
    assert.equal((await student.get("/api/external-sync/health")).status, 403);
    assert.equal((await faculty.get("/api/external-sync/health")).status, 403);
    assert.equal((await t.db.query("SELECT count(*)::int AS n FROM external_sync_runs")).rows[0].n, 0);
  });

  test("R4-08: v1, the first sync, classifies every record as new", async () => {
    const result = await run("v1");
    assert.equal(result.status, 200);
    assert.equal(result.data.status, "succeeded");
    assert.deepEqual(classes(result, "new"), ["MX-1001", "MX-1002", "MX-1003", "MX-1004"]);
    for (const row of await snapshot()) ids[row.external_id] = row.id;
  });

  test("R4-15: local data is recorded on MX-1002 and MX-1003 before this week's change", async () => {
    assert.equal((await faculty.put(`/api/external-opportunities/${ids["MX-1002"]}/interest`, { note: "Happy to advise on security." })).status, 200);
    assert.equal((await faculty.put(`/api/external-opportunities/${ids["MX-1003"]}/interest`, {})).status, 200);
    assert.equal((await student.put(`/api/external-opportunities/${ids["MX-1002"]}/my-status`, { status: "interested" })).status, 200);
    assert.equal((await student.put(`/api/external-opportunities/${ids["MX-1002"]}/my-status`, { status: "applied" })).status, 200);
    assert.equal(
      (await faculty.put(`/api/external-opportunities/${ids["MX-1002"]}/guidance`, { suggestPriorOutcome: true, note: "Security coursework helps." })).status,
      200,
    );
  });

  let v2;
  test("R4-08: v2 is classified exactly as expected_sync_results.json says", async () => {
    v2 = await run("v2");
    assert.equal(v2.data.status, "succeeded");
    assert.deepEqual(classes(v2, "new"), expected.new_external_ids);
    assert.deepEqual(classes(v2, "unchanged"), expected.unchanged_external_ids);
    assert.deepEqual(classes(v2, "changed"), expected.changed_external_ids);
    assert.deepEqual(classes(v2, "not_seen"), expected.not_seen_external_ids);
    for (const [externalId, fields] of Object.entries(expected.changed_fields)) {
      const item = v2.data.items.find((i) => i.externalId === externalId);
      assert.deepEqual([...item.changedFields].sort(), [...fields].sort(), externalId);
    }
  });

  test("R4-12: the malformed record is reported with its reasons and skipped; the rest are processed", async () => {
    assert.equal(v2.data.malformed.length, expected.malformed_record_count);
    assert.equal(v2.data.counts.malformed, expected.malformed_record_count);
    const reasons = v2.data.malformed[0].reasons.join("; ");
    for (const reason of ["empty external_id", "empty title", "unparseable closes date"]) assert.match(reasons, new RegExp(reason));
    assert.equal((await snapshot()).length, 5);
    assert.equal((await t.db.query("SELECT count(*)::int AS n FROM external_opportunities WHERE external_id = '' OR title = ''")).rows[0].n, 0);
  });

  test("R4-10: MX-1003 is marked not seen, keeps its last-known content and is not deleted", async () => {
    const res = await anon.get(`/api/external-opportunities/${ids["MX-1003"]}`);
    assert.equal(res.status, 200);
    const o = res.data.opportunity;
    assert.equal(o.sourceState.value, "not_seen");
    assert.equal(o.title, "Globalink research award — interaction design");
    assert.equal(o.authoritativeUrl, "https://mitacs.example/opportunities/MX-1003");
    assert.match(o.sourceState.text, /stopped listing/);
    // Distinguishable from a withdrawal by the source.
    assert.notEqual(o.sourceState.value, "withdrawn");
    // It leaves discovery but its page stays.
    const list = (await anon.get("/api/external-opportunities")).data.opportunities.map((x) => x.source.externalId);
    assert.ok(!list.includes("MX-1003"));
  });

  test("R4-15, R4-16: every local field on MX-1002 survives the change; the source fields are the provider's", async () => {
    const o = (await faculty.get(`/api/external-opportunities/${ids["MX-1002"]}`)).data.opportunity;
    assert.equal(o.title, "Accelerate internship — secure systems review (extended)");
    assert.equal(o.closing.closesOn, "2027-03-31");
    assert.deepEqual(o.interestedFaculty.map((f) => f.displayName), ["Dr. Interested"]);
    assert.equal(o.interestedFaculty[0].note, "Happy to advise on security.");
    assert.deepEqual(o.you.guidance, { suggestPriorOutcome: true, note: "Security coursework helps." });
    const tracking = (await student.get(`/api/external-opportunities/${ids["MX-1002"]}`)).data.opportunity.you.tracking;
    assert.equal(tracking.status, "applied");
    assert.deepEqual(tracking.history.map((h) => h.status), ["applied", "interested"]);
  });

  test("R4-17: the change is recorded, and the interested faculty member can tell it moved", async () => {
    const o = (await faculty.get(`/api/external-opportunities/${ids["MX-1002"]}`)).data.opportunity;
    const change = o.sourceHistory.find((e) => e.kind === "changed");
    assert.deepEqual([...change.changedFields].sort(), [...expected.changed_fields["MX-1002"]].sort());
    assert.equal(change.previousTitle, "Accelerate internship — secure systems review");
    assert.equal(change.previousClosesOn, "2027-01-31");
    assert.ok(o.you.interest.changedSinceInterest.length > 0);
    const mine = (await faculty.get("/api/external-opportunities/mine")).data.interests;
    const entry = mine.find((x) => x.source.externalId === "MX-1002");
    assert.equal(entry.changedSinceInterest, true);
    assert.deepEqual([...entry.fieldsChangedSinceInterest].sort(), [...expected.changed_fields["MX-1002"]].sort());
  });

  test("R4-07: MX-1005 is an ordinary external record; its text changes nothing", async () => {
    const o = (await anon.get(`/api/external-opportunities/${ids["MX-1005"] || (await t.db.query("SELECT id FROM external_opportunities WHERE external_id = 'MX-1005'")).rows[0].id}`)).data.opportunity;
    assert.equal(o.source.id, SOURCE);
    assert.equal(o.source.ownerName, "Mitacs");
    assert.equal(o.externallyOwned, true);
    assert.match(o.wording.ownership, /^Owned by Mitacs, not Algoma University\.$/);
    assert.equal(o.authoritativeUrl, "https://mitacs.example/opportunities/MX-1005");
    // Stored as text, exactly as sent; the pages render it with textContent.
    assert.match(o.description, /<script>alert\('x'\)<\/script>/);
    const roles = await t.db.query("SELECT count(*)::int AS n FROM users WHERE is_staff OR is_verified_faculty");
    assert.equal(roles.rows[0].n, 2); // the staff and faculty accounts this test made, nobody else
    const s = (await t.db.query("SELECT is_staff, is_verified_faculty FROM users WHERE id = $1", [studentUser.id])).rows[0];
    assert.deepEqual(s, { is_staff: false, is_verified_faculty: false });
  });

  test("R4-09: running v2 again creates no duplicates and reports MX-1003 as still not seen", async () => {
    const again = await run("v2");
    assert.equal((await snapshot()).length, 5);
    assert.deepEqual(classes(again, "unchanged"), ["MX-1001", "MX-1002", "MX-1004", "MX-1005"]);
    assert.deepEqual(classes(again, "changed"), []);
    assert.deepEqual(classes(again, "new"), []);
    assert.deepEqual(classes(again, "not_seen"), []);
    assert.deepEqual(classes(again, "still_not_seen"), ["MX-1003"]);
  });

  for (const feed of ["unreachable", "unparseable"]) {
    test(`R4-11: a failed sync (${feed}) changes nothing and keeps the last successful time`, async () => {
      const before = await snapshot();
      const lastSuccess = (await anon.get("/api/external-opportunities")).data.sources[0].lastSuccessfulSyncAt;
      const res = await run(feed);
      assert.equal(res.status, 200);
      assert.equal(res.data.status, "failed");
      assert.deepEqual(await snapshot(), before);
      const list = await anon.get("/api/external-opportunities");
      assert.equal(list.data.sources[0].lastSuccessfulSyncAt, lastSuccess);
      assert.equal(list.data.opportunities.length, 4);
      // R4-13: and the data is now labelled as possibly out of date.
      assert.equal(list.data.opportunities[0].freshness.stale, true);
      assert.match(list.data.opportunities[0].freshness.staleReason, /latest attempt .* failed/);
    });
  }

  test("R4-14: sync health shows the last success, the last failure and its reason, and counts", async () => {
    const res = await staff.get("/api/external-sync/health");
    const source = res.data.sources.find((s) => s.id === SOURCE);
    assert.equal(source.health.healthy, false);
    assert.ok(source.lastSuccessfulRun.finishedAt);
    assert.match(source.lastFailedRun.failureReason, /could not be parsed/);
    assert.equal(source.lastSuccessfulRun.counts.unchanged, 4);
    assert.equal(source.lastSuccessfulRun.counts.still_not_seen, 1);
    const detail = await staff.get(`/api/external-sync/runs/${source.lastSuccessfulRun.id}`);
    assert.equal(detail.data.items.length, 5);
    // Ordinary users only get plain-language freshness, never the run log.
    const pub = (await anon.get(`/api/external-opportunities/${ids["MX-1001"]}`)).data.opportunity;
    assert.ok(!("recentRuns" in pub) && !("failureReason" in pub.freshness));
  });

  test("R4-13: a successful sync makes the data current again", async () => {
    await run("v2");
    const o = (await anon.get("/api/external-opportunities")).data.opportunities[0];
    assert.equal(o.freshness.stale, false);
    assert.ok(o.freshness.lastSuccessfulSyncAt);
  });

  test("R4-20: interest survives MX-1003 disappearing and reappearing", async () => {
    const res = await run("v1");
    assert.deepEqual(classes(res, "reappeared"), ["MX-1003"]);
    const o = (await anon.get(`/api/external-opportunities/${ids["MX-1003"]}`)).data.opportunity;
    assert.equal(o.sourceState.value, "listed");
    assert.deepEqual(o.interestedFaculty.map((f) => f.displayName), ["Dr. Interested"]);
    assert.deepEqual(
      o.sourceHistory.map((e) => e.kind),
      ["reappeared", "not_seen"],
    );
  });

  test("R4-10: a record the source withdraws is distinguishable from one that disappeared", async () => {
    const { SOURCES } = require("../src/external/sources");
    const { runSync } = require("../src/external/sync");
    const v1 = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "r4_fixtures", "external_source_feed_v1.json"), "utf8"));
    v1.records[0].status = "withdrawn";
    const source = { ...SOURCES[SOURCE], fetchFeed: async () => v1 };
    const result = await runSync(t.db, source, "v1");
    assert.deepEqual(result.items.filter((i) => i.classification === "withdrawn").map((i) => i.externalId), ["MX-1001"]);
    const o = (await anon.get(`/api/external-opportunities/${ids["MX-1001"]}`)).data.opportunity;
    assert.equal(o.sourceState.value, "withdrawn");
    assert.match(o.sourceState.label, /Withdrawn by Mitacs/);
  });

  test("evaluation reset is staff-only and needs confirmation", async () => {
    assert.equal((await student.post("/api/external-sync/reset", { sourceId: SOURCE, confirm: true })).status, 403);
    assert.equal((await staff.post("/api/external-sync/reset", { sourceId: SOURCE })).status, 400);
    assert.equal((await staff.post("/api/external-sync/reset", { sourceId: SOURCE, confirm: true })).status, 200);
    assert.equal((await snapshot()).length, 0);
  });
});

describe("bundled demonstration feeds", () => {
  test("are byte-for-byte the supplied R4 fixture feeds", () => {
    for (const name of ["external_source_feed_v1.json", "external_source_feed_v2.json"]) {
      const bundled = fs.readFileSync(path.join(__dirname, "..", "src", "external", "demo-feeds", name), "utf8");
      const supplied = fs.readFileSync(path.join(__dirname, "..", "..", "r4_fixtures", name), "utf8");
      assert.equal(bundled, supplied, name);
    }
  });
});

describe("evaluation reset outside test mode", () => {
  test("is refused", async () => {
    const t = await startTestApp({ config: { testMode: false } });
    try {
      const { client } = await signIn(t, uniqueEmail("staff"), { staff: true });
      assert.equal((await client.post("/api/external-sync/reset", { sourceId: SOURCE, confirm: true })).status, 403);
    } finally {
      await t.close();
    }
  });
});
