-- 007: outcomes and the showcase (R3-14 to R3-18, R3-20). See project2/R3_PLAN.md, D8.
-- Safe to run while the previous code is deployed: it only adds tables.

-- The result of a confirmed match (R3-14). An outcome is shown publicly only while a
-- participating verified faculty member has confirmed it (R3-15) and consent allows it (R3-16);
-- that rule is in src/routes/outcomes.js, never stored. Editing clears the confirmation.
CREATE TABLE IF NOT EXISTS outcomes (
    id            SERIAL      PRIMARY KEY,
    match_id      INTEGER     NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    summary       TEXT        NOT NULL,
    completed_on  DATE        NOT NULL,
    -- Optional links by kind: demo, repo, poster, video, image (each an http(s) URL).
    links         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by    INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    confirmed_by  INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    confirmed_at  TIMESTAMPTZ,
    fixture_id    TEXT        UNIQUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outcomes_match_idx ON outcomes (match_id);

-- Who took part, by university email like match_students. Each student chooses whether the
-- outcome appears on their own profile (R3-18); that choice never affects the faculty profile
-- or the showcase.
CREATE TABLE IF NOT EXISTS outcome_participants (
    outcome_id       INTEGER     NOT NULL REFERENCES outcomes(id) ON DELETE CASCADE,
    email            TEXT        NOT NULL,
    role             TEXT        NOT NULL CHECK (role IN ('faculty', 'student')),
    show_on_profile  BOOLEAN     NOT NULL DEFAULT true,
    PRIMARY KEY (outcome_id, email)
);
CREATE INDEX IF NOT EXISTS outcome_participants_email_idx ON outcome_participants (email);

ALTER TABLE outcomes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE outcome_participants ENABLE ROW LEVEL SECURITY;

INSERT INTO schema_migrations (id) VALUES ('007_outcomes') ON CONFLICT DO NOTHING;
