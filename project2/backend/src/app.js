const cookieParser = require("cookie-parser");
const express = require("express");
const path = require("path");
const { createAuth } = require("./auth");
const { createAccountRouter } = require("./routes/account");
const { createAdminRouter } = require("./routes/admin");
const { createAuthRouter } = require("./routes/auth");
const { createFacultyRouter } = require("./routes/faculty");
const { createProjectsRouter } = require("./routes/projects");

// `db` needs query(text, params) returning { rows }. `sendSignInEmail` is optional.
function createApp({ db, config, sendSignInEmail = null }) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(cookieParser());
  app.use(express.static(path.join(__dirname, "..", "public")));

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

  app.use("/api/auth", createAuthRouter({ ...deps, sendSignInEmail }));
  app.use("/api/admin", createAdminRouter(deps));
  app.use("/api/account", createAccountRouter(deps));
  app.use("/api/faculty", createFacultyRouter(deps));
  app.use("/api/projects", createProjectsRouter(deps));
  // Mount new feature routers here, e.g. app.use("/api/things", createThingsRouter(deps));

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

module.exports = { createApp };
