# Project 2 — Opportunity Registry and Pathway Platform

Release 1: faculty/project discovery and first contact. See the Release 1 brief and
requirements (R1-01 through R1-26) for the full spec.

## Isolation from Phase 0

This code lives on the `r1-development` branch, separate from `backend/`/`frontend/` at
the repo root (which stay frozen as the submitted Phase 0 warm-up).

- **Deployment**: one dedicated Render Web Service (root `project2/backend`) watching
  `r1-development`. Express serves both the API and the frontend (`project2/backend/public`)
  from the same origin, so the session cookie is first-party — a separate static site
  would make it a third-party cookie, which Safari/iOS blocks. The existing Phase 0 Render
  services are untouched.
- **Database**: a dedicated Supabase project, separate from Phase 0's. Its connection
  string is set as `DATABASE_URL` on the Project 2 Render backend service only.

## Auth approach (R1-01 through R1-07)

Passwordless sign-in is custom-built (not Supabase Auth), with an **instructor-approved
test mode**: sign-in codes are never emailed. Instead they are readable at
`GET /api/auth/pending-challenges`, and the frontend's `operator.html` page renders that
as a stand-in for the recipient's inbox. This was chosen because real email delivery
from a fresh deployment is explicitly the least reliable part of this release per the
brief, and the requirement itself (short-lived, single-use, `algomau.ca`-only) is
unaffected by the transport.

- `ALLOWED_EMAIL_DOMAIN` (default `algomau.ca`) is enforced server-side in
  `project2/backend/server.js`, matched against the domain after the final `@`.
- Codes expire after 10 minutes and are single-use (`used_at` is set on verification).
- Sessions are server-side rows (`sessions` table) behind an httpOnly cookie, not a
  stateless JWT — so a staff revocation (`is_verified_faculty = false`) takes effect on
  the very next request rather than waiting for a token to expire.
- New users always start with `is_staff = false` and `is_verified_faculty = false`
  regardless of anything the client sends (R1-03). Only an existing staff user can
  promote/revoke verified-faculty via `POST /api/admin/users/:id/verify-faculty` and
  `.../revoke-faculty` (R1-04).

**Known trade-off**: because the challenge code is world-readable at
`/api/auth/pending-challenges` rather than delivered to a private inbox, anyone who can
reach the deployed site can sign in as any `@algomau.ca` address for which a challenge is
currently pending. This is the accepted cost of the test-mode substitution and should be
stated plainly in `release_submission.md`'s known-issues section.

## First staff/admin account

Not self-service by design (R1-03). After someone has signed in at least once (so their
`users` row exists), promote them directly in Supabase's SQL Editor:

```sql
UPDATE users SET is_staff = true WHERE email = 'admin@algomau.ca';
```

## Local development

1. Copy `project2/backend/.env.example` to `.env` and set `DATABASE_URL` to the Project 2
   Supabase pooler string.
2. `cd project2/backend && npm install && npm start` (defaults to port 3001).
3. Open http://localhost:3001 — the backend serves the frontend too. Open
   `/operator.html` in a second tab to read sign-in codes while testing.

## Status

- Done: schema (`users`, `sign_in_challenges`, `sessions`, `faculty_profiles`,
  `projects`), passwordless auth (request/verify/me/logout), staff verify/revoke
  endpoints, minimal sign-in UI + operator console.
- Not started: faculty profile CRUD (R1-08–R1-10), project CRUD (R1-11–R1-16), student
  discovery/filtering (R1-17–R1-22), mobile/accessibility pass (R1-25–R1-26).
