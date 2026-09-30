-- 000: initial Project 2 schema (already applied to the live Supabase project).
-- Later changes are separate numbered files in this folder; see project2/AGENTS.md.

CREATE TABLE IF NOT EXISTS users (
    id                   SERIAL PRIMARY KEY,
    email                TEXT        NOT NULL UNIQUE,
    is_staff             BOOLEAN     NOT NULL DEFAULT false,
    is_verified_faculty  BOOLEAN     NOT NULL DEFAULT false,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Passwordless sign-in challenges (R1-01/02). In test mode these are never emailed;
-- they are surfaced via GET /api/auth/pending-challenges instead. See release notes.
CREATE TABLE IF NOT EXISTS sign_in_challenges (
    id          SERIAL PRIMARY KEY,
    email       TEXT        NOT NULL,
    code        TEXT        NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sign_in_challenges_email_idx ON sign_in_challenges (email);

-- Server-side sessions (rather than a stateless JWT) so a staff revocation in R1-04
-- takes effect on the very next request instead of waiting for a token to expire.
CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS faculty_profiles (
    user_id             INTEGER     PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name        TEXT        NOT NULL,
    description          TEXT        NOT NULL DEFAULT '',
    research_areas      TEXT[]      NOT NULL DEFAULT '{}',
    inquiry_preference  TEXT        NOT NULL DEFAULT 'not_accepting'
                        CHECK (inquiry_preference IN ('open', 'projects_only', 'not_accepting')),
    external_links      TEXT[]      NOT NULL DEFAULT '{}',
    public_profile      BOOLEAN     NOT NULL DEFAULT false,
    consent_shown_at    TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
    id               SERIAL PRIMARY KEY,
    faculty_user_id  INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title            TEXT        NOT NULL,
    description      TEXT        NOT NULL,
    research_areas   TEXT[]      NOT NULL DEFAULT '{}',
    student_level    TEXT,
    target_term      TEXT        NOT NULL,
    prerequisites    TEXT,
    status           TEXT        NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'published', 'closed')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_status_idx ON projects (status);
CREATE INDEX IF NOT EXISTS projects_faculty_idx ON projects (faculty_user_id);

-- RLS on with no policies: blocks Supabase's auto-generated Data API (anon/authenticated
-- roles) from reading these tables. The backend connects as the table owner, which RLS
-- does not apply to, so all access goes through server.js.
ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sign_in_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE faculty_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects           ENABLE ROW LEVEL SECURITY;

-- The first staff/admin account is established out of band (R1-04). Run once, after
-- that person has signed in at least one time so the users row exists, or insert
-- directly:
--   INSERT INTO users (email, is_staff) VALUES ('admin@algomau.ca', true)
--   ON CONFLICT (email) DO UPDATE SET is_staff = true;
