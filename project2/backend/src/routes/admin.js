const express = require("express");
const { recordAudit } = require("../audit");
const { toPublicUser } = require("../auth");
const { parseId } = require("../validation");

// R1-04: staff grant or revoke verified-faculty capability. Revoking only clears the flag; the
// account, profile and projects stay (hidden from the public by the visibility rule).
function createAdminRouter({ db, auth }) {
  const router = express.Router();

  router.get("/users", auth.requireStaff, async (_req, res, next) => {
    try {
      const result = await db.query("SELECT * FROM users ORDER BY created_at DESC");
      res.json(result.rows.map((user) => ({ ...toPublicUser(user), createdAt: user.created_at, departedAt: user.departed_at })));
    } catch (error) {
      next(error);
    }
  });

  async function setVerifiedFaculty(req, res, next, value) {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: "Invalid user id." });
      // F-02, F-08: the grant or revocation and its record are saved together.
      const user = await db.transaction(async (tx) => {
        const before = await tx.query("SELECT is_verified_faculty FROM users WHERE id = $1 FOR UPDATE", [id]);
        if (!before.rows[0]) return null;
        const result = await tx.query("UPDATE users SET is_verified_faculty = $1 WHERE id = $2 RETURNING *", [value, id]);
        await recordAudit(tx, {
          actorId: req.user.id,
          action: value ? "faculty.verify" : "faculty.revoke",
          subjectType: "user",
          subjectId: id,
          detail: { from: before.rows[0].is_verified_faculty, to: value },
        });
        return result.rows[0];
      });
      if (!user) return res.status(404).json({ error: "User not found." });
      res.json({ user: toPublicUser(user) });
    } catch (error) {
      next(error);
    }
  }

  // F-09, F-10 (FINAL_PLAN.md D2): staff record that a faculty member has left Algoma or a
  // student has graduated, or take that back (`departure: null`). Nothing is deleted or revoked:
  // their past work stays, and they stop being offered as someone to approach.
  router.post("/users/:id/departure", auth.requireStaff, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: "Invalid user id." });
      const departure = req.body?.departure ?? null;
      if (![null, "left", "graduated"].includes(departure)) {
        return res.status(400).json({ error: "Choose left, graduated, or null to undo." });
      }
      const outcome = await db.transaction(async (tx) => {
        const before = await tx.query("SELECT * FROM users WHERE id = $1 FOR UPDATE", [id]);
        const user = before.rows[0];
        if (!user) return { status: 404, error: "User not found." };
        if (user.id === req.user.id) return { status: 409, error: "You can't record your own departure." };
        if (departure === "left" && !user.is_verified_faculty) {
          return { status: 409, error: "Only a verified faculty member can be recorded as having left. Students graduate." };
        }
        if (departure === "graduated" && (user.is_verified_faculty || user.is_staff)) {
          return { status: 409, error: "Only a student can be recorded as graduated." };
        }
        const result = await tx.query(
          `UPDATE users SET departure = $2, departed_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END,
             departure_recorded_by = $3 WHERE id = $1 RETURNING *`,
          [id, departure, req.user.id],
        );
        await recordAudit(tx, {
          actorId: req.user.id,
          action: departure ? `person.${departure}` : "person.returned",
          subjectType: "user",
          subjectId: id,
          detail: { from: user.departure, to: departure },
        });
        return { user: result.rows[0] };
      });
      if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
      res.json({ user: toPublicUser(outcome.user) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/users/:id/verify-faculty", auth.requireStaff, (req, res, next) =>
    setVerifiedFaculty(req, res, next, true),
  );
  router.post("/users/:id/revoke-faculty", auth.requireStaff, (req, res, next) =>
    setVerifiedFaculty(req, res, next, false),
  );

  return router;
}

module.exports = { createAdminRouter };
