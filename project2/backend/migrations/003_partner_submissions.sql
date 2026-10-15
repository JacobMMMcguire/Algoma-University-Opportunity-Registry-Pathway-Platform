-- 003: accountless partner intake (R2-01 to R2-06).
-- Safe to run while the previous code is deployed: it only adds a table.

-- A partner's proposed project. Partners have no account, so nothing here references users.
-- Every submission arrives as 'pending' (R2-02): visible to verified faculty and staff only.
-- Later releases widen the status CHECK as submissions gain supervisors (R2-07).
CREATE TABLE IF NOT EXISTS partner_submissions (
    id              SERIAL PRIMARY KEY,
    organisation    TEXT        NOT NULL CHECK (organisation <> ''),
    contact_name    TEXT        NOT NULL,
    contact_email   TEXT        NOT NULL CHECK (contact_email <> ''),
    title           TEXT        NOT NULL CHECK (title <> ''),
    description     TEXT        NOT NULL,
    research_areas  TEXT[]      NOT NULL DEFAULT '{}',
    capacity        TEXT        NOT NULL
                    CHECK (capacity IN ('one-team-only', 'multiple-teams', 'not-sure')),
    status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending')),
    -- Set only on records loaded from r2_fixtures/intake_submissions.json.
    fixture_id      TEXT        UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_submissions_status_idx ON partner_submissions (status);

ALTER TABLE partner_submissions ENABLE ROW LEVEL SECURITY;

INSERT INTO schema_migrations (id) VALUES ('003_partner_submissions') ON CONFLICT DO NOTHING;
