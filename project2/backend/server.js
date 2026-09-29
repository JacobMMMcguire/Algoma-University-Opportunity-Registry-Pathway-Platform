require("dotenv").config();

const cors = require("cors");
const express = require("express");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Copy project2/backend/.env.example to .env and set it.");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

const isLocalDatabase = process.env.DATABASE_URL.includes("localhost");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDatabase ? false : { rejectUnauthorized: false },
});

app.get("/api/health", async (_request, response) => {
  try {
    await pool.query("SELECT 1");
    response.json({ ok: true, database: "reachable" });
  } catch (error) {
    console.error("Health check could not reach PostgreSQL:", error.message);
    response.status(503).json({ ok: false, error: "database unavailable" });
  }
});

app.use((error, _request, response, _next) => {
  console.error("Unexpected API error:", error.message);
  response.status(500).json({ error: "unexpected server error" });
});

const port = process.env.PORT || 3001;
app.listen(port, "0.0.0.0", () => {
  console.log(`Project 2 API listening on port ${port}`);
});
