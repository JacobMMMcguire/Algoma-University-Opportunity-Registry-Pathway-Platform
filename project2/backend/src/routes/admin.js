const express = require("express");
const { toPublicUser } = require("../auth");
const { parseId } = require("../validation");

// R1-04: staff grant or revoke verified-faculty capability. Revoking only clears the flag; the
// account, profile and projects stay (hidden from the public by the visibility rule).
function createAdminRouter({ db, auth }) {
  const router = express.Router();

  router.get("/users", auth.requireStaff, async (_req, res, next) => {
    try {
      const result = await db.query("SELECT * FROM users ORDER BY created_at DESC");
      res.json(result.rows.map((user) => ({ ...toPublicUser(user), createdAt: user.created_at })));
    } catch (error) {
      next(error);
    }
  });

  async function setVerifiedFaculty(req, res, next, value) {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: "Invalid user id." });
      const result = await db.query(
        "UPDATE users SET is_verified_faculty = $1 WHERE id = $2 RETURNING *",
        [value, id],
      );
      if (!result.rows[0]) return res.status(404).json({ error: "User not found." });
      res.json({ user: toPublicUser(result.rows[0]) });
    } catch (error) {
      next(error);
    }
  }

  router.post("/users/:id/verify-faculty", auth.requireStaff, (req, res, next) =>
    setVerifiedFaculty(req, res, next, true),
  );
  router.post("/users/:id/revoke-faculty", auth.requireStaff, (req, res, next) =>
    setVerifiedFaculty(req, res, next, false),
  );

  return router;
}

module.exports = { createAdminRouter };
