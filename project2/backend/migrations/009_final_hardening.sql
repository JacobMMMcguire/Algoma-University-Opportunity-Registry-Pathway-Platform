-- 009: Final Release hardening (FINAL_PLAN.md D1, D5).
-- Safe to run while the previous code is deployed: it only adds tables.

-- D1, F-08: who changed what and when, for the changes run_changes doesn't already cover
-- (privilege grants, publication, engagement, match answers, reassignment, departure). Written in
-- the same transaction as the change. `detail` holds before and after values only: never a
-- sign-in code, session token or partner contact detail (F-24).
CREATE TABLE IF NOT EXISTS audit_events (
    id            SERIAL      PRIMARY KEY,
    actor_id      INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    action        TEXT        NOT NULL,
    subject_type  TEXT        NOT NULL,
    subject_id    INTEGER     NOT NULL,
    detail        JSONB       NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_subject ON audit_events (subject_type, subject_id, id);

-- D5, F-14: notifying subscribers about a submission is a separate step from saving it, so a
-- failure is recorded here instead of losing the submission. One row per submission; staff can
-- retry a failed one. Submissions from before this migration have no row.
CREATE TABLE IF NOT EXISTS notification_deliveries (
    submission_id    INTEGER     PRIMARY KEY REFERENCES partner_submissions(id) ON DELETE CASCADE,
    status           TEXT        NOT NULL CHECK (status IN ('delivered', 'failed')),
    attempts         INTEGER     NOT NULL DEFAULT 1,
    notified_count   INTEGER     NOT NULL DEFAULT 0,
    last_error       TEXT,
    last_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_deliveries_failed ON notification_deliveries (status, last_attempt_at);

-- Operator switches, such as simulating a notification failure for evaluation (test mode only).
CREATE TABLE IF NOT EXISTS operational_settings (
    key         TEXT        PRIMARY KEY,
    value       JSONB       NOT NULL,
    updated_by  INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE audit_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_settings    ENABLE ROW LEVEL SECURITY;

INSERT INTO schema_migrations (id) VALUES ('009_final_hardening') ON CONFLICT DO NOTHING;
