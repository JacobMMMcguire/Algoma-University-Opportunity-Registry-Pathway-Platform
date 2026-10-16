const express = require("express");
const { RESEARCH_AREAS, SUBSCRIPTION_MODES } = require("../catalog");
const { cleanAreas } = require("../validation");

function toSubscription(row) {
  return { mode: row?.mode || "none", researchAreas: row?.research_areas || [], updatedAt: row?.updated_at || null };
}

// R2-16 to R2-20: a verified faculty member's private notification settings and their
// in-product notification list. Everything here is keyed by req.user; there is no route that
// reads or writes anyone else's (R2-17).
function createNotificationsRouter({ db, auth }) {
  const router = express.Router();

  // R2-18: newest first. R2-19: this only points at opportunities; browsing shows them all.
  router.get("/", auth.requireVerifiedFaculty, async (req, res, next) => {
    try {
      const result = await db.query(
        `SELECT n.id, n.created_at, ps.id AS submission_id, ps.title, ps.organisation, ps.research_areas
         FROM notifications n
         JOIN partner_submissions ps ON ps.id = n.submission_id
         WHERE n.user_id = $1
         ORDER BY n.created_at DESC, n.id DESC`,
        [req.user.id],
      );
      res.json({
        notifications: result.rows.map((row) => ({
          id: row.id,
          createdAt: row.created_at,
          opportunity: { id: row.submission_id, title: row.title, organisation: row.organisation, researchAreas: row.research_areas },
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/subscriptions", auth.requireVerifiedFaculty, async (req, res, next) => {
    try {
      const result = await db.query("SELECT * FROM faculty_subscriptions WHERE user_id = $1", [req.user.id]);
      res.json({ subscription: toSubscription(result.rows[0]), modes: SUBSCRIPTION_MODES });
    } catch (error) {
      next(error);
    }
  });

  // R2-16, R2-20: replace your own settings; they apply to opportunities submitted from now on.
  // Unlike the profile, this needs no public-display choice: it is never shown to anyone (R1-06).
  router.put("/subscriptions", auth.requireVerifiedFaculty, async (req, res, next) => {
    try {
      const body = req.body || {};
      const mode = SUBSCRIPTION_MODES.find((o) => o.value === body.mode)?.value;
      if (!mode) return res.status(400).json({ error: "Choose what you want to be notified about.", field: "mode" });
      let researchAreas = [];
      if (mode === "areas") {
        const cleaned = cleanAreas(body.researchAreas, { max: RESEARCH_AREAS.length });
        if (cleaned.error) return res.status(400).json({ error: cleaned.error, field: "researchAreas" });
        researchAreas = cleaned.areas;
      }
      const result = await db.query(
        `INSERT INTO faculty_subscriptions (user_id, mode, research_areas, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id) DO UPDATE SET mode = EXCLUDED.mode, research_areas = EXCLUDED.research_areas, updated_at = now()
         RETURNING *`,
        [req.user.id, mode, researchAreas],
      );
      res.json({ subscription: toSubscription(result.rows[0]) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createNotificationsRouter };
