// Runs the whole app against an in-memory Postgres loaded with the R1 fixture: no .env, no
// Supabase, no email. Data resets on every restart. Sign in with any @algomau.ca address
// (or a fixture account) and read the code at /operator.html.
const { createApp } = require("../src/app");
const { loadConfig } = require("../src/config");
const { createLocalDb } = require("../src/db");
const { buildFixtureSql, fixtureEmail, loadFixture } = require("../src/fixture");

const STAFF_EMAIL = (process.env.LOCAL_STAFF_EMAIL || "staff@algomau.ca").toLowerCase();

(async () => {
  const db = await createLocalDb();
  await db.exec(buildFixtureSql(loadFixture()));
  await db.query("INSERT INTO users (email, is_staff) VALUES ($1, true) ON CONFLICT (email) DO NOTHING", [STAFF_EMAIL]);

  const config = loadConfig({ SIGN_IN_TEST_MODE: "true" });
  const app = createApp({ db, config });
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    console.log(`Local app (in-memory database with the R1 fixture) at http://localhost:${port}`);
    console.log(`Staff: ${STAFF_EMAIL} or ${fixtureEmail("TEST-STAFF")}. Verified faculty: ${fixtureEmail("F-ALEX")}.`);
    console.log(`Sign-in codes: http://localhost:${port}/operator.html`);
  });
})();
