const express = require("express");
const { toPublicUser } = require("../auth");

// R1-05 and R1-07: a verified faculty member explicitly chooses, and can later change, whether
// their profile and published projects may be shown publicly. Takes effect immediately.
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

  return router;
}

module.exports = { createAccountRouter };
