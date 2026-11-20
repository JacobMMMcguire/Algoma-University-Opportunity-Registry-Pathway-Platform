const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

function createPool(databaseUrl) {
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false },
  });
  // Runs `fn(tx)` on one connection inside BEGIN/COMMIT; any error rolls everything back.
  async function transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn({ query: (text, params) => client.query(text, params) });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  return { query: (text, params) => pool.query(text, params), exec: (sql) => pool.query(sql), end: () => pool.end(), transaction };
}

// An in-memory Postgres (PGlite) for tests and `npm run dev:local`; no credentials needed.
async function createLocalDb() {
  const { PGlite } = require("@electric-sql/pglite");
  const pg = new PGlite();
  const db = {
    query: (text, params) => pg.query(text, params),
    exec: (sql) => pg.exec(sql),
    end: () => pg.close(),
    transaction: (fn) => pg.transaction((tx) => fn({ query: (text, params) => tx.query(text, params) })),
  };
  await applyMigrations(db);
  return db;
}

// Applies migrations/*.sql in filename order, skipping ones recorded in schema_migrations.
async function applyMigrations(db) {
  const table = await db.query("SELECT to_regclass('schema_migrations')::text AS name");
  const applied = new Set();
  if (table.rows[0].name) {
    const result = await db.query("SELECT id FROM schema_migrations");
    for (const row of result.rows) applied.add(row.id);
  }

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).sort();
  const ran = [];
  for (const file of files) {
    const id = file.replace(/\.sql$/, "");
    if (applied.has(id)) continue;
    await db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    ran.push(id);
  }
  return ran;
}

module.exports = { createPool, createLocalDb, applyMigrations };
