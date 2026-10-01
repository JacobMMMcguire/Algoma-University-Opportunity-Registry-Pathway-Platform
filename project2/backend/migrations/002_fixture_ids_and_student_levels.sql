-- 002: track records loaded from r1_fixture.json, and fix student levels to three values (R1-11, R1-20).
-- Run before deploying the code that needs it. While the previous code is still deployed, saving
-- a project with a free-text student level fails until the new code is live.

-- Set only on records created by `npm run seed:fixture`, so reseeding updates them in place.
ALTER TABLE users ADD COLUMN IF NOT EXISTS fixture_id TEXT UNIQUE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS fixture_id TEXT UNIQUE;

-- Map earlier free-text levels onto the fixed list; anything unrecognisable becomes "not set".
UPDATE projects SET student_level = CASE
    WHEN student_level IS NULL THEN NULL
    WHEN lower(student_level) IN ('undergraduate or graduate', 'any level') THEN 'Undergraduate or Graduate'
    WHEN lower(student_level) LIKE '%undergraduate%' THEN 'Undergraduate'
    WHEN lower(student_level) LIKE '%graduate%' THEN 'Graduate'
    ELSE NULL
END
WHERE student_level IS NOT NULL
  AND student_level NOT IN ('Undergraduate', 'Graduate', 'Undergraduate or Graduate');

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_student_level_check;
ALTER TABLE projects ADD CONSTRAINT projects_student_level_check
    CHECK (student_level IS NULL OR student_level IN ('Undergraduate', 'Graduate', 'Undergraduate or Graduate'));

INSERT INTO schema_migrations (id) VALUES ('002_fixture_ids_and_student_levels') ON CONFLICT DO NOTHING;
