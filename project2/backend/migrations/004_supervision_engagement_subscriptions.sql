-- 004: faculty publication gate, coordination and notification subscriptions (R2-07 to R2-20).
-- Run before deploying the code that needs it. The code from 003 (intake only) was never
-- deployed, so dropping its `status` column breaks nothing that is live.

-- R2-07 to R2-10: one row per verified faculty member willing to supervise an opportunity.
-- No row is special: the first has no exclusivity, and withdrawing deletes only that row.
-- An opportunity's state is derived from these rows, never stored, so it can't drift.
CREATE TABLE IF NOT EXISTS opportunity_supervisors (
    submission_id    INTEGER     NOT NULL REFERENCES partner_submissions(id) ON DELETE CASCADE,
    faculty_user_id  INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (submission_id, faculty_user_id)
);
CREATE INDEX IF NOT EXISTS opportunity_supervisors_faculty_idx ON opportunity_supervisors (faculty_user_id);

ALTER TABLE partner_submissions DROP COLUMN IF EXISTS status;

-- R2-12, R2-13: the partner engagement state, and who recorded it (coordination, not a lock).
ALTER TABLE partner_submissions ADD COLUMN IF NOT EXISTS engagement_state TEXT NOT NULL DEFAULT 'not_contacted'
    CHECK (engagement_state IN ('not_contacted', 'discussion_underway', 'partner_confirmed', 'no_longer_pursuing'));
ALTER TABLE partner_submissions ADD COLUMN IF NOT EXISTS engagement_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE partner_submissions ADD COLUMN IF NOT EXISTS engagement_updated_at TIMESTAMPTZ;

-- R2-16, R2-17, R2-20: private notification settings. No row means "none".
CREATE TABLE IF NOT EXISTS faculty_subscriptions (
    user_id         INTEGER     PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    mode            TEXT        NOT NULL CHECK (mode IN ('none', 'all', 'areas')),
    research_areas  TEXT[]      NOT NULL DEFAULT '{}',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- R2-18: the in-product notification list, filled when a submission arrives.
CREATE TABLE IF NOT EXISTS notifications (
    id             SERIAL      PRIMARY KEY,
    user_id        INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    submission_id  INTEGER     NOT NULL REFERENCES partner_submissions(id) ON DELETE CASCADE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, submission_id)
);

ALTER TABLE opportunity_supervisors ENABLE ROW LEVEL SECURITY;
ALTER TABLE faculty_subscriptions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications           ENABLE ROW LEVEL SECURITY;

INSERT INTO schema_migrations (id) VALUES ('004_supervision_engagement_subscriptions') ON CONFLICT DO NOTHING;
