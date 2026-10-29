-- 005: term runs and lifecycle (R3-08 to R3-13), matches (R3-01 to R3-05) and partner agreement
-- records (R3-07). See project2/R3_PLAN.md, D1, D2, D6, D7.
-- Safe to run while the previous code is deployed: it only adds tables and triggers, and leaves
-- every existing column as it is.

-- One run per term an opportunity is offered for. A faculty project or an industry opportunity
-- (partner submission) has one or more; the current run is the highest run_number. Renewal adds
-- a run, so earlier runs keep their own matches, agreements and outcomes (R3-12).
-- Only states someone chooses are stored. Matched and Expired are derived from the matches and
-- the clock (src/lifecycle.js), so they can't drift from the facts.
CREATE TABLE IF NOT EXISTS opportunity_runs (
    id                SERIAL      PRIMARY KEY,
    project_id        INTEGER     REFERENCES projects(id) ON DELETE CASCADE,
    submission_id     INTEGER     REFERENCES partner_submissions(id) ON DELETE CASCADE,
    run_number        INTEGER     NOT NULL DEFAULT 1 CHECK (run_number >= 1),
    target_term       TEXT,
    deadline          DATE,
    -- R3-08: set by Centre staff; overrides the faculty deadline when present.
    centre_deadline   DATE,
    state             TEXT        NOT NULL DEFAULT 'open'
                      CHECK (state IN ('open', 'withdrawn', 'completed', 'archived')),
    state_changed_by  INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    state_changed_at  TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((project_id IS NULL) <> (submission_id IS NULL)),
    UNIQUE (project_id, run_number),
    UNIQUE (submission_id, run_number)
);

-- The history of every stored change to a run, so lifecycle changes leave a record (R3-04,
-- R3-12, R3-13). `change` is 'created', 'renewed', 'state', 'schedule' or 'centre_deadline'.
CREATE TABLE IF NOT EXISTS run_changes (
    id          SERIAL      PRIMARY KEY,
    run_id      INTEGER     NOT NULL REFERENCES opportunity_runs(id) ON DELETE CASCADE,
    change      TEXT        NOT NULL,
    detail      TEXT        NOT NULL DEFAULT '',
    user_id     INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS run_changes_run_idx ON run_changes (run_id);

-- Every existing record gets run 1. Closed projects were withdrawn from students (R1-15).
INSERT INTO opportunity_runs (project_id, target_term, state)
SELECT p.id, p.target_term, CASE WHEN p.status = 'closed' THEN 'withdrawn' ELSE 'open' END
FROM projects p
WHERE NOT EXISTS (SELECT 1 FROM opportunity_runs r WHERE r.project_id = p.id);

INSERT INTO opportunity_runs (submission_id)
SELECT ps.id FROM partner_submissions ps
WHERE NOT EXISTS (SELECT 1 FROM opportunity_runs r WHERE r.submission_id = ps.id);

-- New records get run 1 automatically, including ones created by code that predates runs.
CREATE OR REPLACE FUNCTION create_first_project_run() RETURNS trigger AS $$
BEGIN
  INSERT INTO opportunity_runs (project_id, target_term) VALUES (NEW.id, NEW.target_term);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION create_first_submission_run() RETURNS trigger AS $$
BEGIN
  INSERT INTO opportunity_runs (submission_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS projects_first_run ON projects;
CREATE TRIGGER projects_first_run AFTER INSERT ON projects
    FOR EACH ROW EXECUTE FUNCTION create_first_project_run();

DROP TRIGGER IF EXISTS partner_submissions_first_run ON partner_submissions;
CREATE TRIGGER partner_submissions_first_run AFTER INSERT ON partner_submissions
    FOR EACH ROW EXECUTE FUNCTION create_first_submission_run();

-- R3-01 to R3-05: a faculty member proposes a match on a run to one or more students, named by
-- their university email (they may not have signed in yet). Withdrawing keeps the row (R3-04).
CREATE TABLE IF NOT EXISTS matches (
    id            SERIAL      PRIMARY KEY,
    run_id        INTEGER     NOT NULL REFERENCES opportunity_runs(id) ON DELETE CASCADE,
    proposed_by   INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    withdrawn_at  TIMESTAMPTZ,
    withdrawn_by  INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    fixture_id    TEXT        UNIQUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS matches_run_idx ON matches (run_id);

-- Each invited student's own answer. The match is fully confirmed only when every one has
-- confirmed (R3-02).
CREATE TABLE IF NOT EXISTS match_students (
    match_id       INTEGER     NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    student_email  TEXT        NOT NULL,
    response       TEXT        NOT NULL DEFAULT 'pending' CHECK (response IN ('pending', 'confirmed', 'declined')),
    responded_at   TIMESTAMPTZ,
    PRIMARY KEY (match_id, student_email)
);
CREATE INDEX IF NOT EXISTS match_students_email_idx ON match_students (student_email);

-- R3-07: a faculty member's record that the partner agreed in principle, for one run. Rows are
-- only added, never changed: the latest row for a run is its current answer.
CREATE TABLE IF NOT EXISTS partner_agreements (
    id           SERIAL      PRIMARY KEY,
    run_id       INTEGER     NOT NULL REFERENCES opportunity_runs(id) ON DELETE CASCADE,
    agreed       BOOLEAN     NOT NULL,
    note         TEXT        NOT NULL DEFAULT '',
    recorded_by  INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_agreements_run_idx ON partner_agreements (run_id);

ALTER TABLE opportunity_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_changes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches            ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_students     ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_agreements ENABLE ROW LEVEL SECURITY;

INSERT INTO schema_migrations (id) VALUES ('005_runs_lifecycle_matches') ON CONFLICT DO NOTHING;
