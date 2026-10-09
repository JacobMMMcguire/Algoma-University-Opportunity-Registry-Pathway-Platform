// Runs the whole app against an in-memory Postgres loaded with the R1 fixture: no .env, no
// Supabase, no email. Data resets on every restart. Sign in as a fixture account and read its
// code at /operator.html with the operator secret printed below.
const { createApp } = require("../src/app");
const { loadConfig } = require("../src/config");
const { createLocalDb } = require("../src/db");
const { buildFixtureSql, fixtureEmail, loadFixture } = require("../src/fixture");

// No email locally, so only the fixture test accounts can sign in.

(async () => {
  const db = await createLocalDb();
  await db.exec(buildFixtureSql(loadFixture()));

  // A fixed, local-only operator secret; production uses its own private OPERATOR_SECRET.
  const operatorSecret = process.env.OPERATOR_SECRET || "local-dev-operator-secret-not-for-production";
  const config = loadConfig({ SIGN_IN_TEST_MODE: "true", OPERATOR_SECRET: operatorSecret });
  const app = createApp({ db, config });
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    console.log(`Local app (in-memory database with the R1 fixture) at http://localhost:${port}`);
    console.log(`Staff: ${fixtureEmail("TEST-STAFF")}. Verified faculty: ${fixtureEmail("F-ALEX")}.`);
    console.log(`Sign-in codes for test accounts: http://localhost:${port}/operator.html (operator secret: ${operatorSecret})`);
  });
})();
