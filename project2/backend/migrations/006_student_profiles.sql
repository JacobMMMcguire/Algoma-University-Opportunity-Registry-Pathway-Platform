-- 006: student profiles (R3-01, R3-05, R3-17, R3-18, R3-20). See project2/R3_PLAN.md, D5.
-- Safe to run while the previous code is deployed: it only adds a table.

-- A student's name as faculty and fellow students see it on a match, and their choice about
-- public display, mirroring the faculty choice on `users` (R1-05). NULL means not chosen yet,
-- which counts as not public. Students without a profile are shown by their email address to
-- the people on their matches, and never publicly.
CREATE TABLE IF NOT EXISTS student_profiles (
    user_id                INTEGER     PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name           TEXT        NOT NULL,
    public_profile_choice  BOOLEAN,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE student_profiles ENABLE ROW LEVEL SECURITY;

INSERT INTO schema_migrations (id) VALUES ('006_student_profiles') ON CONFLICT DO NOTHING;
