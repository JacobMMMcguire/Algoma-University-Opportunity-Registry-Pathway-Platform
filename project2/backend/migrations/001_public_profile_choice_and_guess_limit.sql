-- 001: public-profile choice lives on users (R1-05/06/07); cap wrong guesses per sign-in code (R1-01).
-- Safe to run while the previous code is deployed: it only adds columns, and drops two
-- faculty_profiles columns that no code has ever used.

-- NULL = the faculty member has not chosen yet (treated as not public).
ALTER TABLE users ADD COLUMN IF NOT EXISTS public_profile_choice BOOLEAN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS public_profile_choice_at TIMESTAMPTZ;

ALTER TABLE faculty_profiles DROP COLUMN IF EXISTS public_profile;
ALTER TABLE faculty_profiles DROP COLUMN IF EXISTS consent_shown_at;

ALTER TABLE sign_in_challenges ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0;

-- Record applied migrations so the team can check the live database with
-- SELECT * FROM schema_migrations. Every later migration ends with its own INSERT.
CREATE TABLE IF NOT EXISTS schema_migrations (
    id          TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
INSERT INTO schema_migrations (id) VALUES ('000_initial_schema') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (id) VALUES ('001_public_profile_choice_and_guess_limit') ON CONFLICT DO NOTHING;
