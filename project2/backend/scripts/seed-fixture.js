// Loads project2/r1_fixture.json into the database. Safe to rerun: it resets the fixture
// records to the fixture's values and leaves every other record alone.
//
//   npm run seed:fixture        apply to DATABASE_URL (from .env)
//   npm run seed:fixture:sql    print the SQL instead, to paste into the Supabase SQL Editor
require("dotenv").config();
const { createPool } = require("../src/db");
const { buildFixtureSql, loadFixture } = require("../src/fixture");

const sql = buildFixtureSql(loadFixture());

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
      console.log("R1 fixture loaded.");
    } finally {
      await db.end();
    }
  })().catch((error) => {
    console.error("Seeding failed:", error.message);
    process.exit(1);
  });
}
