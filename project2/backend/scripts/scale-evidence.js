// F-17, F-18 evidence: loads the R1 to Final fixtures and then the scale fixture
// (final_fixtures/scale_fixture.json) into an in-memory database through the app's own routes
// (src/scale.js), measures discovery at that size, and writes final_evidence/scale_evidence.json.
// Run: npm run scale:evidence. Nothing touches the live database.
const fs = require("fs");
const path = require("path");
const { loadConfig } = require("../src/config");
const { createLocalDb } = require("../src/db");
const { SOURCES } = require("../src/external/sources");
const { runSync } = require("../src/external/sync");
const { buildAllFixtureSql, loadLifecycleFixture } = require("../src/fixture");
const { EXPIRED_DEADLINE, LOAD_CLOCK, OPEN_DEADLINE, loadScale, measureDiscovery } = require("../src/scale");

(async () => {
  const evaluationDate = loadLifecycleFixture().evaluation_date;
  const db = await createLocalDb();
  await db.exec(buildAllFixtureSql());
  await runSync(db, SOURCES["mitacs-demo"], "v1");
  const config = loadConfig({ SIGN_IN_TEST_MODE: "true" });
  const loaded = await loadScale(db, config, { evaluationDate, log: (m) => console.log(`- ${m}`) });
  const discovery = await measureDiscovery(db, config, evaluationDate);
  const n = async (sql) => (await db.query(sql)).rows[0].n;
  const evidence = {
    generatedAt: new Date().toISOString(),
    fixture: { version: loaded.fixture.fixture_version, faculty: loaded.fixture.faculty.length, students: loaded.fixture.students.length, opportunities: loaded.fixture.opportunities.length },
    method:
      "Accounts created as fixture accounts; every profile, project, submission, willingness, deadline, match, confirmation, completion, " +
      "external support, student status, departure and graduation made through the app's HTTP routes as that person (src/scale.js). " +
      "External records arrived through the ordinary sync (runSync).",
    dates: { loadedWithClock: LOAD_CLOCK, openDeadline: OPEN_DEADLINE, expiredDeadline: EXPIRED_DEADLINE, evaluatedAt: evaluationDate },
    loadSeconds: loaded.loadSeconds,
    databaseTotals: {
      people: await n("SELECT count(*)::int AS n FROM users"),
      facultyProjects: await n("SELECT count(*)::int AS n FROM projects"),
      industryOpportunities: await n("SELECT count(*)::int AS n FROM partner_submissions"),
      externalOpportunities: await n("SELECT count(*)::int AS n FROM external_opportunities"),
      matches: await n("SELECT count(*)::int AS n FROM matches"),
      historyEvents: await n("SELECT count(*)::int AS n FROM audit_events"),
    },
    discovery,
  };
  const out = path.join(__dirname, "..", "..", "final_evidence", "scale_evidence.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
  console.log(`Written to ${path.relative(process.cwd(), out)}`);
  await db.end();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
