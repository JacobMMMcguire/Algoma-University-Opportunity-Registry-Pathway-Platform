// Runs the whole app against an in-memory Postgres loaded with the R1 to R3 and Final fixtures: no .env, no
// Supabase, no email. Data resets on every restart. Sign in as a fixture account and read its
// code at /operator.html with the operator secret printed below. Dates are evaluated as of the
// R3 fixture's evaluation_date unless CLOCK_DATE says otherwise (CLOCK_DATE= uses the real date).
// With --scale it also loads the Final scale fixture (240 people, 160 opportunities, src/scale.js).
const { createApp } = require("../src/app");
const { loadConfig } = require("../src/config");
const { createLocalDb } = require("../src/db");
const { SOURCES } = require("../src/external/sources");
const { runSync } = require("../src/external/sync");
const { buildAllFixtureSql, fixtureEmail, loadLifecycleFixture } = require("../src/fixture");

// No email locally, so only the fixture test accounts can sign in.

(async () => {
  const db = await createLocalDb();
  await db.exec(buildAllFixtureSql());
  // R4: start from "last week's" successful sync (feed v1); run v2 from /sync.html as staff.
  if (process.env.SKIP_V1_SYNC !== "true") await runSync(db, SOURCES["mitacs-demo"], "v1");

  if (process.argv.includes("--scale")) {
    const { loadScale } = require("../src/scale");
    console.log("Loading the scale fixture through the app's routes...");
    await loadScale(db, loadConfig({ SIGN_IN_TEST_MODE: "true" }), { evaluationDate: loadLifecycleFixture().evaluation_date });
  }

  // A fixed, local-only operator secret; production uses its own private OPERATOR_SECRET.
  const operatorSecret = process.env.OPERATOR_SECRET || "local-dev-operator-secret-not-for-production";
  const clockDate = process.env.CLOCK_DATE ?? loadLifecycleFixture().evaluation_date;
  const config = loadConfig({ SIGN_IN_TEST_MODE: "true", OPERATOR_SECRET: operatorSecret, CLOCK_DATE: clockDate });
  // The guided tour may switch roles (src/routes/demo.js). Set here, never from the environment, so
  // only this in-memory build can have it. DEMO_TOUR=false turns it off for a plain local run.
  config.demoTour = process.env.DEMO_TOUR !== "false";
  const app = createApp({ db, config });
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    console.log(`Local app (in-memory database with the R1 to R3 and Final fixtures) at http://localhost:${port}`);
    console.log(`Today is ${config.clockDate ? `${config.clockDate} (simulated, CLOCK_DATE)` : "the real date"}.`);
    console.log(`Staff: ${fixtureEmail("TEST-STAFF")}. Verified faculty: ${fixtureEmail("F-JORDAN")} (F-ALEX has left Algoma in the Final fixture).`);
    if (config.demoTour) console.log("Guided tour: open the site and choose \"Take the tour\" (it switches roles for you).");
    console.log(`Sign-in codes for test accounts: http://localhost:${port}/operator.html (operator secret: ${operatorSecret})`);
  });
})();
