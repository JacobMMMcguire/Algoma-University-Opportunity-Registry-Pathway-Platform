// /api/operations: what an operator needs to see that supporting processes are working
// (F-14, F-23, F-24; FINAL_PLAN.md D5, D8). Staff only. Lists are paged, so a long queue never
// has to be loaded whole (F-19). Nothing here returns partner contact details, codes or tokens.
const express = require("express");
const { recordAudit } = require("../audit");
const { deliverNotifications, SIMULATE_FAILURE_KEY } = require("../notify");
const { parseId } = require("../validation");

const PAGE = { default: 20, max: 50 };

// `?limit=` and `?before=<id>` (the `next` value from the previous page).
function pageParams(query) {
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || PAGE.default, 1), PAGE.max);
  const before = query.before === undefined ? null : parseId(query.before);
  return { limit, before };
}

function createOperationsRouter({ db, config, auth }) {
  const router = express.Router();
  router.use(auth.requireStaff);

  // F-14: notification deliveries, failed ones first unless ?status= says otherwise.
  router.get("/notifications", async (req, res, next) => {
    try {
      const status = ["failed", "delivered"].includes(req.query.status) ? req.query.status : "failed";
      const { limit, before } = pageParams(req.query);
      const rows = await db.query(
        `SELECT d.*, s.title FROM notification_deliveries d JOIN partner_submissions s ON s.id = d.submission_id
         WHERE d.status = $1 AND ($2::int IS NULL OR d.submission_id < $2)
         ORDER BY d.submission_id DESC LIMIT $3`,
        [status, before, limit + 1],
      );
      const page = rows.rows.slice(0, limit);
      const counts = await db.query("SELECT status, count(*)::int AS n FROM notification_deliveries GROUP BY status");
      res.json({
        status,
        counts: { failed: 0, delivered: 0, ...Object.fromEntries(counts.rows.map((r) => [r.status, r.n])) },
        deliveries: page.map((d) => ({
          submissionId: d.submission_id,
          title: d.title,
          status: d.status,
          attempts: d.attempts,
          notifiedCount: d.notified_count,
          lastError: d.last_error,
          lastAttemptAt: new Date(d.last_attempt_at).toISOString(),
        })),
        next: rows.rows.length > limit ? page[page.length - 1].submission_id : null,
        simulatingFailure: await simulating(),
        simulationAvailable: config.testMode,
      });
    } catch (error) {
      next(error);
    }
  });

  // F-14, F-16: try again. Safe to repeat: nobody is notified twice.
  router.post("/notifications/:submissionId/retry", async (req, res, next) => {
    try {
      const id = parseId(req.params.submissionId);
      if (id === null) return res.status(400).json({ error: "Invalid submission id." });
      const exists = await db.query("SELECT 1 FROM partner_submissions WHERE id = $1", [id]);
      if (!exists.rows[0]) return res.status(404).json({ error: "Submission not found." });
      const outcome = await deliverNotifications(db, config, id);
      await recordAudit(db, {
        actorId: req.user.id,
        action: "notification.retry",
        subjectType: "partner_submission",
        subjectId: id,
        detail: { delivered: outcome.delivered },
      });
      res.json(outcome);
    } catch (error) {
      next(error);
    }
  });

  // Evaluation only (test mode): makes every notification delivery fail until switched off, to
  // show F-14. Recorded like any other operator change.
  router.put("/settings/simulate-notification-failure", async (req, res, next) => {
    try {
      if (!config.testMode) return res.status(403).json({ error: "Simulated failures are only available in test mode." });
      if (typeof req.body?.enabled !== "boolean") return res.status(400).json({ error: "Say whether to turn it on or off." });
      await db.query(
        `INSERT INTO operational_settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [SIMULATE_FAILURE_KEY, JSON.stringify(req.body.enabled), req.user.id],
      );
      await recordAudit(db, {
        actorId: req.user.id,
        action: "setting.simulate_notification_failure",
        subjectType: "setting",
        subjectId: 0,
        detail: { enabled: req.body.enabled },
      });
      res.json({ simulatingFailure: req.body.enabled });
    } catch (error) {
      next(error);
    }
  });

  // F-08 (D1): who changed what and when, newest first, optionally for one record
  // (`?subjectType=match&subjectId=12`). Evidence for disputes, not an editing tool: nothing here
  // changes or deletes a record.
  router.get("/history", async (req, res, next) => {
    try {
      const { limit, before } = pageParams(req.query);
      const subjectType = typeof req.query.subjectType === "string" && /^[a-z_]{1,40}$/.test(req.query.subjectType) ? req.query.subjectType : null;
      const subjectId = req.query.subjectId === undefined ? null : parseId(req.query.subjectId);
      if (req.query.subjectId !== undefined && subjectId === null) return res.status(400).json({ error: "Invalid record id." });
      const rows = await db.query(
        `SELECT a.id, a.action, a.subject_type, a.subject_id, a.detail, a.created_at,
           coalesce(fp.display_name, u.email) AS actor_name
         FROM audit_events a
         LEFT JOIN users u ON u.id = a.actor_id
         LEFT JOIN faculty_profiles fp ON fp.user_id = u.id
         WHERE ($1::text IS NULL OR a.subject_type = $1) AND ($2::int IS NULL OR a.subject_id = $2)
           AND ($3::int IS NULL OR a.id < $3)
         ORDER BY a.id DESC LIMIT $4`,
        [subjectType, subjectId, before, limit + 1],
      );
      const page = rows.rows.slice(0, limit);
      res.json({
        events: page.map((e) => ({
          id: e.id,
          action: e.action,
          subject: { type: e.subject_type, id: e.subject_id },
          detail: e.detail,
          by: e.actor_name,
          at: new Date(e.created_at).toISOString(),
        })),
        next: rows.rows.length > limit ? page[page.length - 1].id : null,
      });
    } catch (error) {
      next(error);
    }
  });

  async function simulating() {
    const row = await db.query("SELECT value FROM operational_settings WHERE key = $1", [SIMULATE_FAILURE_KEY]);
    return config.testMode && row.rows[0]?.value === true;
  }

  return router;
}

module.exports = { createOperationsRouter, pageParams, PAGE };
