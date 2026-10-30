// Loads project2/r1_fixture.json, the R2 partner submissions (project2/r2_fixtures/) and the R3
// lifecycle fixture (project2/r3_fixtures/) into the database. Needs migrations up to 007 applied
// first. Safe to rerun: it resets the fixture records to the fixture's values, including the
// matches, partner agreements and outcomes on the R3 fixture opportunities, and leaves every
// other record alone.
//
//   npm run seed:fixture        apply to DATABASE_URL (from .env)
//   npm run seed:fixture:sql    print the SQL instead, to paste into the Supabase SQL Editor
require("dotenv").config();
const { createPool } = require("../src/db");
const { buildAllFixtureSql } = require("../src/fixture");

const sql = buildAllFixtureSql();

if (process.argv.includes("--sql")) {
  process.stdout.write(sql);
} else {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required (or use `npm run seed:fixture:sql` and paste the output).");
    process.exit(1);
  }
  (async () => {
    const db = createPool(process.env.DATABASE_URL);
    try {
      await db.exec(sql);
      console.log("R1, R2 and R3 fixtures loaded. Set CLOCK_DATE to evaluate R3 deadlines as of the fixture date.");
    } finally {
      await db.end();
    }
  })().catch((error) => {
    console.error("Seeding failed:", error.message);
    process.exit(1);
  });
}
