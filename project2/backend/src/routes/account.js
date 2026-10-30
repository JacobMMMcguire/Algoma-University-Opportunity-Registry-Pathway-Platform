const express = require("express");
const { toPublicUser } = require("../auth");
const { cleanText } = require("../validation");

const STUDENT_NAME_LIMIT = 100;

function toStudentProfile(row) {
  return { displayName: row.display_name, publicProfileChoice: row.public_profile_choice, updatedAt: row.updated_at };
}

// R1-05 and R1-07: a verified faculty member explicitly chooses, and can later change, whether
// their profile and published projects may be shown publicly. Takes effect immediately.
// R3_PLAN.md D5: students keep a display name, shown on their matches, and the same kind of
// choice about public display (used by the outcome showcase, R3-17, R3-18, R3-20).
function createAccountRouter({ db, auth }) {
  const router = express.Router();

  router.put("/public-profile", auth.requireVerifiedFaculty, async (req, res, next) => {
    try {
      const { allowPublicProfile } = req.body;
      if (typeof allowPublicProfile !== "boolean") {
        return res.status(400).json({ error: "Choose whether to allow public display." });
      }
      const result = await db.query(
        `UPDATE users SET public_profile_choice = $1, public_profile_choice_at = now()
         WHERE id = $2 RETURNING *`,
        [allowPublicProfile, req.user.id],
      );
      res.json({ user: toPublicUser(result.rows[0]) });
    } catch (error) {
      next(error);
    }
  });

  // Faculty have a faculty profile instead; a student profile is for everyone else.
  function studentsOnly(req, res, next) {
    if (req.user.is_verified_faculty) {
      return res.status(403).json({ error: "Verified faculty use their faculty profile instead." });
    }
    next();
  }

  router.get("/student-profile", auth.requireAuth, studentsOnly, async (req, res, next) => {
    try {
      const result = await db.query("SELECT * FROM student_profiles WHERE user_id = $1", [req.user.id]);
      res.json({ profile: result.rows[0] ? toStudentProfile(result.rows[0]) : null, limits: { displayName: STUDENT_NAME_LIMIT } });
    } catch (error) {
      next(error);
    }
  });

  // Creates or replaces the signed-in student's own profile. There is no route by id.
  router.put("/student-profile", auth.requireAuth, studentsOnly, async (req, res, next) => {
    try {
      const displayName = cleanText(req.body?.displayName);
      if (!displayName) return res.status(400).json({ error: "Enter the name you'd like faculty to see.", field: "displayName" });
      if (displayName.length > STUDENT_NAME_LIMIT) {
        return res.status(400).json({ error: `Your name must be ${STUDENT_NAME_LIMIT} characters or fewer.`, field: "displayName" });
      }
      const choice = req.body.allowPublicProfile;
      if (typeof choice !== "boolean") {
        return res.status(400).json({ error: "Choose whether your name may be shown publicly.", field: "allowPublicProfile" });
      }
      const result = await db.query(
        `INSERT INTO student_profiles (user_id, display_name, public_profile_choice, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name,
           public_profile_choice = EXCLUDED.public_profile_choice, updated_at = now()
         RETURNING *`,
        [req.user.id, displayName, choice],
      );
      res.json({ profile: toStudentProfile(result.rows[0]) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createAccountRouter };
