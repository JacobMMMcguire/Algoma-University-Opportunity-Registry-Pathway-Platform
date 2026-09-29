require("dotenv").config();

const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const express = require("express");
const path = require("path");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Copy project2/backend/.env.example to .env and set it.");
  process.exit(1);
}

const ALLOWED_EMAIL_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || "algomau.ca").toLowerCase();
const CHALLENGE_TTL_MINUTES = 10;
const MAX_CHALLENGES_PER_WINDOW = 3;
const SESSION_TTL_DAYS = 7;
const SESSION_COOKIE = "session_token";

const BREVO_API_KEY = process.env.BREVO_API_KEY || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "";
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || "Opportunity Registry";
const EMAIL_ENABLED = Boolean(BREVO_API_KEY && EMAIL_FROM);
// Defaults on only when email isn't configured, so there is always some way to sign in.
const TEST_MODE = process.env.SIGN_IN_TEST_MODE
  ? process.env.SIGN_IN_TEST_MODE === "true"
  : !EMAIL_ENABLED;

if (!EMAIL_ENABLED && !TEST_MODE) {
  console.warn("Neither email delivery nor sign-in test mode is enabled: nobody can sign in.");
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const isLocalDatabase = process.env.DATABASE_URL.includes("localhost");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDatabase ? false : { rejectUnauthorized: false },
});

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function emailDomain(email) {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1);
}

function isWellFormedEmail(email) {
  return email.length > 0 && email.includes("@") && emailDomain(email).includes(".");
}

function generateChallengeCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function sendSignInEmail(email, code) {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: EMAIL_FROM_NAME, email: EMAIL_FROM },
      to: [{ email }],
      subject: "Your Opportunity Registry sign-in code",
      textContent:
        `Your sign-in code is ${code}. It expires in ${CHALLENGE_TTL_MINUTES} minutes and can only be used once.\n\n` +
        "If you did not request this, you can ignore this email.",
      htmlContent:
        `<p>Your sign-in code is <strong style="font-size:1.25em">${code}</strong>.</p>` +
        `<p>It expires in ${CHALLENGE_TTL_MINUTES} minutes and can only be used once.</p>` +
        "<p>If you did not request this, you can ignore this email.</p>",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Brevo responded ${response.status}: ${await response.text()}`);
  }
}

function setSessionCookie(req, res, token, expiresAt) {
  const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

function toPublicUser(user) {
  return {
    email: user.email,
    isStaff: user.is_staff,
    isVerifiedFaculty: user.is_verified_faculty,
  };
}

async function getSessionUser(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const result = await pool.query(
    `SELECT users.* FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = $1 AND sessions.expires_at > now()`,
    [token],
  );
  return result.rows[0] || null;
}

function requireAuth() {
  return async (req, res, next) => {
    try {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ error: "sign-in required" });
      req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

function requireStaff() {
  return (req, res, next) => {
    if (!req.user.is_staff) return res.status(403).json({ error: "staff access required" });
    next();
  };
}

app.get("/api/health", async (_request, response) => {
  try {
    await pool.query("SELECT 1");
    response.json({ ok: true, database: "reachable" });
  } catch (error) {
    console.error("Health check could not reach PostgreSQL:", error.message);
    response.status(503).json({ ok: false, error: "database unavailable" });
  }
});

// R1-01/R1-02: request a short-lived, single-use, domain-restricted sign-in challenge.
// The code is emailed via Brevo when configured; in test mode it is also readable at
// GET /api/auth/pending-challenges (the instructor-approved substitute for email).
app.post("/api/auth/request-challenge", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!isWellFormedEmail(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    if (emailDomain(email) !== ALLOWED_EMAIL_DOMAIN) {
      return res.status(422).json({ error: `Only @${ALLOWED_EMAIL_DOMAIN} addresses can sign in.` });
    }

    const recent = await pool.query(
      `SELECT count(*)::int AS n FROM sign_in_challenges
       WHERE email = $1 AND created_at > now() - make_interval(mins => $2)`,
      [email, CHALLENGE_TTL_MINUTES],
    );
    if (recent.rows[0].n >= MAX_CHALLENGES_PER_WINDOW) {
      return res.status(429).json({
        error: "Too many sign-in codes requested for this address. Try again in a few minutes.",
      });
    }

    const code = generateChallengeCode();
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MINUTES * 60 * 1000);
    await pool.query(
      "INSERT INTO sign_in_challenges (email, code, expires_at) VALUES ($1, $2, $3)",
      [email, code, expiresAt],
    );

    let emailSent = false;
    if (EMAIL_ENABLED) {
      try {
        await sendSignInEmail(email, code);
        emailSent = true;
      } catch (error) {
        console.error("Sign-in email failed:", error.message);
        if (!TEST_MODE) {
          return res.status(502).json({ error: "Could not send the sign-in email. Try again shortly." });
        }
      }
    }

    res.status(201).json({ ok: true, expiresAt, emailSent, testMode: TEST_MODE });
  } catch (error) {
    next(error);
  }
});

// Test-mode stand-in for the recipient's email inbox, disabled when SIGN_IN_TEST_MODE is off.
app.get("/api/auth/pending-challenges", async (_request, res, next) => {
  if (!TEST_MODE) return res.status(404).json({ error: "sign-in test mode is disabled" });
  try {
    const result = await pool.query(
      `SELECT email, code, expires_at AS "expiresAt"
       FROM sign_in_challenges
       WHERE used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC`,
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/verify", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const code = typeof req.body.code === "string" ? req.body.code.trim() : "";
    if (!email || !code) {
      return res.status(400).json({ error: "Email and code are required." });
    }

    const challengeResult = await pool.query(
      `SELECT id FROM sign_in_challenges
       WHERE email = $1 AND code = $2 AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC
       LIMIT 1`,
      [email, code],
    );
    const challenge = challengeResult.rows[0];
    if (!challenge) {
      return res.status(400).json({ error: "That code is invalid or has expired." });
    }
    await pool.query("UPDATE sign_in_challenges SET used_at = now() WHERE id = $1", [challenge.id]);

    const userResult = await pool.query(
      `INSERT INTO users (email) VALUES ($1)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING *`,
      [email],
    );
    const user = userResult.rows[0];

    const token = generateSessionToken();
    const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await pool.query(
      "INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)",
      [token, user.id, sessionExpiresAt],
    );
    setSessionCookie(req, res, token, sessionExpiresAt);

    res.json({ ok: true, user: toPublicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", async (req, res, next) => {
  try {
    const user = await getSessionUser(req);
    res.json(
      user
        ? { authenticated: true, testMode: TEST_MODE, user: toPublicUser(user) }
        : { authenticated: false, testMode: TEST_MODE },
    );
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", async (req, res, next) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// R1-04: an authorized staff/admin user can grant or revoke verified-faculty capability.
// Revocation only flips a flag — it never deletes the user's account.
app.get("/api/admin/users", requireAuth(), requireStaff(), async (_request, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, email, is_staff, is_verified_faculty, created_at FROM users ORDER BY created_at DESC",
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/users/:id/verify-faculty", requireAuth(), requireStaff(), async (req, res, next) => {
  try {
    const result = await pool.query(
      "UPDATE users SET is_verified_faculty = true WHERE id = $1 RETURNING id, email, is_staff, is_verified_faculty",
      [req.params.id],
    );
    if (!result.rows[0]) return res.status(404).json({ error: "user not found" });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/users/:id/revoke-faculty", requireAuth(), requireStaff(), async (req, res, next) => {
  try {
    const result = await pool.query(
      "UPDATE users SET is_verified_faculty = false WHERE id = $1 RETURNING id, email, is_staff, is_verified_faculty",
      [req.params.id],
    );
    if (!result.rows[0]) return res.status(404).json({ error: "user not found" });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
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
