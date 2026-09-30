// Runs the whole app against an in-memory Postgres: no .env, no Supabase, no email.
// Data resets on every restart. Sign in with any @algomau.ca address and read the code at
// /operator.html. The staff address below is pre-promoted so you can test staff features.
const { createApp } = require("../src/app");
const { loadConfig } = require("../src/config");
const { createLocalDb } = require("../src/db");

const STAFF_EMAIL = (process.env.LOCAL_STAFF_EMAIL || "staff@algomau.ca").toLowerCase();

(async () => {
  const db = await createLocalDb();
  await db.query("INSERT INTO users (email, is_staff) VALUES ($1, true)", [STAFF_EMAIL]);

  const config = loadConfig({ SIGN_IN_TEST_MODE: "true" });
  const app = createApp({ db, config });
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    console.log(`Local app (in-memory database) at http://localhost:${port}`);
    console.log(`Staff account: ${STAFF_EMAIL}. Codes: http://localhost:${port}/operator.html`);
  });
})();
