// Runs the whole app against an in-memory Postgres loaded with the R1 to R3 fixtures: no .env, no
// Supabase, no email. Data resets on every restart. Sign in as a fixture account and read its
// code at /operator.html with the operator secret printed below. Dates are evaluated as of the
// R3 fixture's evaluation_date unless CLOCK_DATE says otherwise (CLOCK_DATE= uses the real date).
const { createApp } = require("../src/app");
const { loadConfig } = require("../src/config");
const { createLocalDb } = require("../src/db");
const { buildAllFixtureSql, fixtureEmail, loadLifecycleFixture } = require("../src/fixture");

// No email locally, so only the fixture test accounts can sign in.

(async () => {
  const db = await createLocalDb();
  await db.exec(buildAllFixtureSql());

  // A fixed, local-only operator secret; production uses its own private OPERATOR_SECRET.
  const operatorSecret = process.env.OPERATOR_SECRET || "local-dev-operator-secret-not-for-production";
  const clockDate = process.env.CLOCK_DATE ?? loadLifecycleFixture().evaluation_date;
  const config = loadConfig({ SIGN_IN_TEST_MODE: "true", OPERATOR_SECRET: operatorSecret, CLOCK_DATE: clockDate });
  const app = createApp({ db, config });
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    console.log(`Local app (in-memory database with the R1 to R3 fixtures) at http://localhost:${port}`);
    console.log(`Today is ${config.clockDate ? `${config.clockDate} (simulated, CLOCK_DATE)` : "the real date"}.`);
    console.log(`Staff: ${fixtureEmail("TEST-STAFF")}. Verified faculty: ${fixtureEmail("F-ALEX")}.`);
    console.log(`Sign-in codes for test accounts: http://localhost:${port}/operator.html (operator secret: ${operatorSecret})`);
  });
})();
