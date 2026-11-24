// F-08 (FINAL_PLAN.md D1): records who changed what and when. Pass the transaction's `query`
// holder (db or tx) so the record is saved with the change it describes. `detail` is before and
// after values only: never a sign-in code, session token or partner contact detail (F-24).
function recordAudit(db, { actorId, action, subjectType, subjectId, detail = {} }) {
  return db.query(
    "INSERT INTO audit_events (actor_id, action, subject_type, subject_id, detail) VALUES ($1, $2, $3, $4, $5::jsonb)",
    [actorId ?? null, action, subjectType, subjectId, JSON.stringify(detail)],
  );
}

module.exports = { recordAudit };
