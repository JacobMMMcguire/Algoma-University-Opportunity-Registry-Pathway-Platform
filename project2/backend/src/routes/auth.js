const crypto = require("crypto");
const express = require("express");
const { generateSessionToken, toPublicUser } = require("../auth");

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

// R1-02: the domain is whatever follows the final "@", compared exactly.
function emailDomain(email) {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1);
}

function isWellFormedEmail(email) {
  return email.length > 0 && !/\s/.test(email) && email.lastIndexOf("@") > 0 && emailDomain(email).includes(".");
}

function generateChallengeCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

// R1-01 through R1-03: passwordless sign-in with short-lived, single-use, domain-restricted codes.
function createAuthRouter({ db, config, auth, sendSignInEmail }) {
  const router = express.Router();

  router.post("/request-challenge", async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body.email);
      if (!isWellFormedEmail(email)) {
        return res.status(400).json({ error: "Enter a valid email address." });
      }
      if (emailDomain(email) !== config.allowedEmailDomain) {
        return res.status(422).json({ error: `Only @${config.allowedEmailDomain} addresses can sign in.` });
      }

      const recent = await db.query(
        `SELECT count(*)::int AS n FROM sign_in_challenges
         WHERE email = $1 AND created_at > now() - make_interval(mins => $2)`,
        [email, config.challengeTtlMinutes],
      );
      if (recent.rows[0].n >= config.maxChallengesPerWindow) {
        return res.status(429).json({
          error: "Too many sign-in codes requested for this address. Try again in a few minutes.",
        });
      }

      // Fixture accounts (npm run seed:fixture) have no inbox: never email them, which would only
      // bounce. They sign in through the test-mode operator console.
      const fixture = await db.query("SELECT 1 FROM users WHERE email = $1 AND fixture_id IS NOT NULL", [email]);
      const isFixtureAccount = fixture.rows.length > 0;
      if (isFixtureAccount && !config.testMode) {
        return res.status(403).json({ error: "This is a test account. It can only sign in while test mode is on." });
      }

      const code = generateChallengeCode();
      const expiresAt = new Date(Date.now() + config.challengeTtlMinutes * 60 * 1000);
      await db.query(
        "INSERT INTO sign_in_challenges (email, code, expires_at) VALUES ($1, $2, $3)",
        [email, code, expiresAt],
      );

      let emailSent = false;
      if (sendSignInEmail && !isFixtureAccount) {
        try {
          await sendSignInEmail(email, code);
          emailSent = true;
        } catch (error) {
          console.error("Sign-in email failed:", error.message);
          if (!config.testMode) {
            return res.status(502).json({ error: "Could not send the sign-in email. Try again shortly." });
          }
        }
      }

      res.status(201).json({ ok: true, expiresAt, emailSent, testMode: config.testMode });
    } catch (error) {
      next(error);
    }
  });

  // Test-mode stand-in for the recipient's inbox (the brief's instructor-approved substitute).
  router.get("/pending-challenges", async (_req, res, next) => {
    if (!config.testMode) return res.status(404).json({ error: "Sign-in test mode is disabled." });
    try {
      const result = await db.query(
        `SELECT email, code, expires_at AS "expiresAt"
         FROM sign_in_challenges
         WHERE used_at IS NULL AND expires_at > now() AND failed_attempts < $1
         ORDER BY created_at DESC`,
        [config.maxFailedAttemptsPerChallenge],
      );
      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  });

  router.post("/verify", async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body.email);
      const code = typeof req.body.code === "string" ? req.body.code.trim() : "";
      if (!email || !code) {
        return res.status(400).json({ error: "Email and code are required." });
      }

      // One statement, so two simultaneous attempts with the same code can't both succeed.
      const consumed = await db.query(
        `UPDATE sign_in_challenges SET used_at = now()
         WHERE used_at IS NULL AND id = (
           SELECT id FROM sign_in_challenges
           WHERE email = $1 AND code = $2 AND used_at IS NULL AND expires_at > now()
             AND failed_attempts < $3
           ORDER BY created_at DESC
           LIMIT 1
         )
         RETURNING id`,
        [email, code, config.maxFailedAttemptsPerChallenge],
      );
      if (consumed.rows.length === 0) {
        // Every wrong guess counts against this address's pending codes, so a 6-digit code
        // can't be brute-forced within its lifetime.
        await db.query(
          `UPDATE sign_in_challenges SET failed_attempts = failed_attempts + 1
           WHERE email = $1 AND used_at IS NULL AND expires_at > now()`,
          [email],
        );
        return res.status(400).json({ error: "That code is invalid or has expired. Request a new one." });
      }

      // R1-03: a new account never gets staff or faculty capability, whatever the client sends.
      const userResult = await db.query(
        `INSERT INTO users (email) VALUES ($1)
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING *`,
        [email],
      );
      const user = userResult.rows[0];

      const token = generateSessionToken();
      const sessionExpiresAt = new Date(Date.now() + config.sessionTtlDays * 24 * 60 * 60 * 1000);
      await db.query(
        "INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)",
        [token, user.id, sessionExpiresAt],
      );
      auth.setSessionCookie(req, res, token, sessionExpiresAt);

      res.json({ ok: true, user: toPublicUser(user) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/me", async (req, res, next) => {
    try {
      const user = await auth.getSessionUser(req);
      res.json(
        user
          ? { authenticated: true, testMode: config.testMode, user: toPublicUser(user) }
          : { authenticated: false, testMode: config.testMode },
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", async (req, res, next) => {
    try {
      const token = req.cookies?.[auth.sessionCookieName];
      if (token) await db.query("DELETE FROM sessions WHERE token = $1", [token]);
      auth.clearSessionCookie(res);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createAuthRouter };
