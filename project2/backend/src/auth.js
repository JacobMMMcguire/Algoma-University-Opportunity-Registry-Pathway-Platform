const crypto = require("crypto");
const { isPubliclyVisibleFaculty } = require("./visibility");

const SESSION_COOKIE = "session_token";

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    isStaff: user.is_staff,
    isVerifiedFaculty: user.is_verified_faculty,
    publicProfileChoice: user.public_profile_choice,
    publiclyVisible: isPubliclyVisibleFaculty(user),
  };
}

function createAuth(db) {
  async function getSessionUser(req) {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return null;
    const result = await db.query(
      `SELECT users.* FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token = $1 AND sessions.expires_at > now()`,
      [token],
    );
    return result.rows[0] || null;
  }

  // Sets req.user to the signed-in user's `users` row (snake_case columns), read fresh from
  // the database on every request so role changes and revocations apply immediately.
  async function authenticate(req, res, next) {
    try {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ error: "Sign in required." });
      req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  }

  function staffOnly(req, res, next) {
    if (!req.user.is_staff) return res.status(403).json({ error: "Staff access required." });
    next();
  }

  function verifiedFacultyOnly(req, res, next) {
    if (!req.user.is_verified_faculty) {
      return res.status(403).json({ error: "Verified faculty access required." });
    }
    next();
  }

  // R1-05: a faculty member must have explicitly chosen public or not (either answer is fine,
  // per R1-06) before anything of theirs can be published.
  function publicProfileChosen(req, res, next) {
    if (req.user.public_profile_choice === null) {
      return res.status(409).json({
        error: "Choose whether to allow public display of your profile before publishing.",
        code: "public_profile_choice_required",
      });
    }
    next();
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

  function clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  // Each guard is a self-contained middleware list, so it can't be used in the wrong order:
  //   router.put("/x", auth.requireVerifiedFaculty, handler)
  return {
    getSessionUser,
    setSessionCookie,
    clearSessionCookie,
    sessionCookieName: SESSION_COOKIE,
    requireAuth: [authenticate],
    requireStaff: [authenticate, staffOnly],
    requireVerifiedFaculty: [authenticate, verifiedFacultyOnly],
    requirePublicProfileChoice: [authenticate, verifiedFacultyOnly, publicProfileChosen],
  };
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

module.exports = { createAuth, toPublicUser, generateSessionToken };
