const cookieParser = require("cookie-parser");
const express = require("express");
const path = require("path");
const { createAuth } = require("./auth");
const { createAccountRouter } = require("./routes/account");
const { createAdminRouter } = require("./routes/admin");
const { createAuthRouter } = require("./routes/auth");
const { createFacultyRouter } = require("./routes/faculty");
const { createExternalRouter } = require("./routes/external");
const { createExternalSyncRouter } = require("./routes/external-sync");
const { createLifecycleRouter } = require("./routes/lifecycle");
const { createMatchesRouter } = require("./routes/matches");
const { createOperationsRouter } = require("./routes/operations");
const { createOutcomesRouter, createStudentsRouter } = require("./routes/outcomes");
const { createNotificationsRouter } = require("./routes/notifications");
const { createOpportunitiesRouter } = require("./routes/opportunities");
const { createOptionsRouter } = require("./routes/options");
const { createPartnerSubmissionsRouter } = require("./routes/partner-submissions");
const { createProjectsRouter } = require("./routes/projects");

// Every API router and where it is mounted. Add new feature routers here. The F-01 to F-03
// authorization sweep (test/authorization-sweep.test.js) lists every route from this table, so a
// route nobody has checked fails the tests.
const MOUNTS = [
  ["/api/auth", createAuthRouter],
  ["/api/admin", createAdminRouter],
  ["/api/account", createAccountRouter],
  ["/api/faculty", createFacultyRouter],
  ["/api/projects", createProjectsRouter],
  ["/api/options", createOptionsRouter],
  ["/api/partner-submissions", createPartnerSubmissionsRouter],
  ["/api/opportunities", createOpportunitiesRouter],
  ["/api/notifications", createNotificationsRouter],
  ["/api/lifecycle", createLifecycleRouter],
  ["/api/matches", createMatchesRouter],
  ["/api/outcomes", createOutcomesRouter],
  ["/api/students", createStudentsRouter],
  ["/api/external-opportunities", createExternalRouter],
  ["/api/external-sync", createExternalSyncRouter],
  ["/api/operations", createOperationsRouter],
];

// `db` needs query(text, params) returning { rows }. `sendSignInEmail` is optional.
function createApp({ db, config, sendSignInEmail = null }) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(cookieParser());
  app.use(express.static(path.join(__dirname, "..", "public")));
  app.get("/favicon.ico", (_req, res) => res.status(204).end());

  const auth = createAuth(db);
  const deps = { db, config, auth };

  app.get("/api/health", async (_req, res) => {
    try {
      await db.query("SELECT 1");
      res.json({ ok: true, database: "reachable" });
    } catch (error) {
      console.error("Health check could not reach PostgreSQL:", error.message);
      res.status(503).json({ ok: false, error: "database unavailable" });
    }
  });

  for (const [prefix, createRouter] of MOUNTS) app.use(prefix, createRouter({ ...deps, sendSignInEmail }));

  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

  app.use((error, _req, res, _next) => {
    if (error.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Request body is not valid JSON." });
    }
    console.error("Unexpected API error:", error.message);
    res.status(500).json({ error: "Unexpected server error." });
  });

  return app;
}

module.exports = { createApp, MOUNTS };
