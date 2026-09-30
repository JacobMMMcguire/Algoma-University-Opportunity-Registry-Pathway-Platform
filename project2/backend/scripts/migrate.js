// Applies any migrations not yet recorded in schema_migrations to the database in DATABASE_URL.
// Pasting the migration file into the Supabase SQL Editor does the same thing.
require("dotenv").config();
const { applyMigrations, createPool } = require("../src/db");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

(async () => {
  const db = createPool(process.env.DATABASE_URL);
  try {
    const ran = await applyMigrations(db);
    console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Already up to date.");
  } finally {
    await db.end();
  }
})().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exit(1);
});
