const express = require("express");
const { generateSessionToken, toPublicUser } = require("../auth");

// The guided tour's role switch, for presenting on a local build (`npm run dev:local`) only.
//
// It signs the browser in as one of the tour's fixture accounts without a code, so a presenter can
// walk through every role in one tour. That is only acceptable on a throwaway in-memory database,
// so it is off unless BOTH:
// - `config.demoTour` is true, which nothing reads from the environment: only scripts/dev-local.js
//   sets it, after loadConfig(), so no Render variable can turn it on; and
// - sign-in test mode is on.
// Otherwise every route here answers 404, exactly as if it didn't exist
// (test/authorization-sweep.test.js checks that for every kind of caller).
const TOUR_ACCOUNTS = {
  student: "S01",
  faculty: "F-JORDAN",
  staff: "TEST-STAFF",
};

function createDemoRouter({ db, config, auth }) {
  const router = express.Router();
  const enabled = () => config.demoTour === true && config.testMode === true;

  router.post("/sign-in-as", async (req, res, next) => {
    if (!enabled()) return res.status(404).json({ error: "Not found." });
    try {
      const role = typeof req.body?.role === "string" ? req.body.role : "";
      const token = req.cookies?.[auth.sessionCookieName];
      if (token) await db.query("DELETE FROM sessions WHERE token = $1", [token]);

      if (role === "visitor") {
        auth.clearSessionCookie(res);
        return res.json({ ok: true, user: null });
      }
      const fixtureId = Object.hasOwn(TOUR_ACCOUNTS, role) ? TOUR_ACCOUNTS[role] : null;
      if (!fixtureId) return res.status(400).json({ error: "Unknown tour role." });

      const user = (await db.query("SELECT * FROM users WHERE fixture_id = $1", [fixtureId])).rows[0];
      if (!user) return res.status(409).json({ error: "The fixtures aren't loaded, so the tour can't switch roles." });

      const newToken = generateSessionToken();
      const expiresAt = new Date(Date.now() + config.sessionTtlDays * 24 * 60 * 60 * 1000);
      await db.query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)", [newToken, user.id, expiresAt]);
      auth.setSessionCookie(req, res, newToken, expiresAt);
      res.json({ ok: true, user: toPublicUser(user) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createDemoRouter, TOUR_ACCOUNTS };
