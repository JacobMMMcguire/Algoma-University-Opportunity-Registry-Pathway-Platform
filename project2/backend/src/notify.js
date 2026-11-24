// F-14 (FINAL_PLAN.md D5): notifying subscribers about a new partner submission is its own step,
// run after the submission is saved. A failure here never undoes or blocks the submission: it is
// recorded in notification_deliveries for operators, who can retry it, and the submission is in
// /submissions.html either way (R2-19).

// R2-18: a subscriber matches if they are verified faculty and want everything or share an area.
// `s` is the submission, `fs` the subscription, joined to `users`.
const SUBSCRIBER_MATCH_SQL = `users.is_verified_faculty
  AND (fs.mode = 'all' OR (fs.mode = 'areas' AND fs.research_areas && s.research_areas))`;

const SIMULATE_FAILURE_KEY = "simulate_notification_failure";

async function simulatingFailure(db, config) {
  if (!config.testMode) return false;
  const row = await db.query("SELECT value FROM operational_settings WHERE key = $1", [SIMULATE_FAILURE_KEY]);
  return row.rows[0]?.value === true;
}

// Creates the notifications for one submission. Never throws: returns { delivered, notified } or
// { delivered: false, error } after recording the outcome. Rerunning it is safe, because
// (user_id, submission_id) is unique, so a retry notifies only those not yet notified.
async function deliverNotifications(db, config, submissionId) {
  let outcome;
  try {
    if (await simulatingFailure(db, config)) {
      throw new Error("Simulated failure: the notification service is unavailable.");
    }
    const result = await db.query(
      `INSERT INTO notifications (user_id, submission_id)
       SELECT fs.user_id, s.id FROM partner_submissions s
       JOIN faculty_subscriptions fs ON true
       JOIN users ON users.id = fs.user_id
       WHERE s.id = $1 AND ${SUBSCRIBER_MATCH_SQL}
       ON CONFLICT DO NOTHING`,
      [submissionId],
    );
    outcome = { delivered: true, notified: result.rowCount ?? result.affectedRows ?? 0 };
  } catch (error) {
    // Only the message: never the submission's contents or the partner's contact details (F-24).
    outcome = { delivered: false, error: String(error.message || "Unknown error").slice(0, 300) };
  }
  try {
    await db.query(
      `INSERT INTO notification_deliveries (submission_id, status, notified_count, last_error)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (submission_id) DO UPDATE SET status = EXCLUDED.status, attempts = notification_deliveries.attempts + 1,
         notified_count = notification_deliveries.notified_count + EXCLUDED.notified_count,
         last_error = EXCLUDED.last_error, last_attempt_at = now()`,
      [submissionId, outcome.delivered ? "delivered" : "failed", outcome.notified || 0, outcome.error || null],
    );
  } catch (error) {
    console.error("Could not record a notification delivery:", error.message);
  }
  return outcome;
}

module.exports = { deliverNotifications, SIMULATE_FAILURE_KEY, SUBSCRIBER_MATCH_SQL };
