// F-17 to F-19: the scale fixture (240 people, 160 opportunities) loaded through the app's own
// routes (src/scale.js), then discovery and the staff queues checked at that size.
const assert = require("node:assert/strict");
const { after, before, describe, test } = require("node:test");
const { loadConfig } = require("../src/config");
const { createLocalDb } = require("../src/db");
const { currentRunJoin } = require("../src/lifecycle");
const { loadScale, measureDiscovery } = require("../src/scale");

const EVALUATION_DATE = "2026-11-06";

describe("F-17 to F-19: the scale fixture through ordinary code paths", { timeout: 600000 }, () => {
  let db;
  let config;
  let loaded;
  let evidence;

  before(async () => {
    db = await createLocalDb();
    config = loadConfig({ SIGN_IN_TEST_MODE: "true" });
    loaded = await loadScale(db, config, { evaluationDate: EVALUATION_DATE });
    evidence = await measureDiscovery(db, config, EVALUATION_DATE);
  });
  after(() => db.end());

  const count = async (sql) => (await db.query(sql)).rows[0].n;

  test("F-17: every person and opportunity arrived (at least 200 people and 150 opportunities)", async () => {
    const { fixture } = loaded;
    assert.equal(await count("SELECT count(*)::int AS n FROM users WHERE fixture_id LIKE 'SF-%'"), fixture.faculty.length);
    assert.equal(await count("SELECT count(*)::int AS n FROM users WHERE fixture_id LIKE 'SS-%'"), fixture.students.length);
    assert.equal(await count("SELECT count(*)::int AS n FROM faculty_profiles"), fixture.faculty.length);
    assert.equal(await count("SELECT count(*)::int AS n FROM student_profiles"), fixture.students.length);
    assert.equal(loaded.created.length, fixture.opportunities.length);
    assert.ok(fixture.faculty.length + fixture.students.length >= 200);
    assert.ok(fixture.opportunities.length >= 150);
    assert.equal(loaded.sync.status, "succeeded");
    // Departures and graduations were recorded by staff, not deleted.
    assert.equal(await count("SELECT count(*)::int AS n FROM users WHERE departure = 'left'"), fixture.faculty.filter((f) => f.active === false).length);
    assert.equal(await count("SELECT count(*)::int AS n FROM users WHERE departure = 'graduated'"), fixture.students.filter((s) => s.status === "alumni").length);
    // It went through the routes: each change left its ordinary record.
    assert.ok((await count("SELECT count(*)::int AS n FROM audit_events WHERE action = 'project.publish'")) > 0);
    assert.ok((await count("SELECT count(*)::int AS n FROM audit_events WHERE action = 'match.confirm'")) > 0);
  });

  test("F-17: each local opportunity is in the fixture's state at the evaluation date", async () => {
    const cfg = { ...config, clockDate: EVALUATION_DATE };
    const states = new Map();
    for (const [kind, table, alias] of [
      ["project", "projects", "p"],
      ["industry", "partner_submissions", "ps"],
    ]) {
      const rows = await db.query(`SELECT ${alias}.id, run.lifecycle_state FROM ${table} ${alias} ${currentRunJoin(cfg, kind, alias)}`);
      for (const r of rows.rows) states.set(`${kind}:${r.id}`, r.lifecycle_state);
    }
    const departed = new Set(loaded.fixture.faculty.filter((f) => f.active === false).map((f) => f.fixture_id));
    const wrong = [];
    for (const item of loaded.created.filter((c) => c.kind !== "external")) {
      // An open or expired one whose owner has left needs a new supervisor (F-11).
      const expected = departed.has(item.owner) && ["open", "expired"].includes(item.state) ? "needs_supervisor" : item.state;
      const actual = states.get(`${item.kind}:${item.id}`);
      if (actual !== expected) wrong.push(`${item.fixtureId}: ${actual}, expected ${expected}`);
    }
    assert.deepEqual(wrong, []);
  });

  test("F-18: discovery sends one page, not every record", () => {
    const { discoveryFirstPage: page, unpagedLists: all } = evidence;
    assert.equal(page.items, 20);
    assert.ok(page.total > 20, `total ${page.total}`);
    assert.ok(page.bytes * 3 < all.bytes, `first page ${page.bytes} bytes vs every record ${all.bytes} bytes`);
    assert.equal(evidence.facultyFirstPage.items, 20);
  });
});
