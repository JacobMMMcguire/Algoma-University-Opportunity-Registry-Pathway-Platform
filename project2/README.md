# Project 2 — Opportunity Registry and Pathway Platform

Release 1: faculty and project discovery with first contact by email.

- **Live:** https://algoma-opportunity-registry-r1-backend.onrender.com (auto-deploys the
  `r1-development` branch)
- **Developers and coding agents:** read [AGENTS.md](AGENTS.md) first, for the rules,
  code layout, testing, and how to add features.

## Infrastructure

Kept completely separate from Phase 0 (which lives on `master` with its own Render services
and Supabase project, and must not be touched while it is assessed):

- **Render:** one Web Service, root directory `project2/backend`, branch `r1-development`,
  build `npm install`, start `npm start`, health check `/api/health`. It serves the API and
  the frontend.
- **Supabase:** a dedicated project. Its Session pooler connection string is `DATABASE_URL`
  on the Render service. RLS is on for every table with no policies, so only the backend
  can read the data.
- **Render environment variables:** `DATABASE_URL`, `BREVO_API_KEY`, `EMAIL_FROM` (a
  Brevo-verified sender), `SIGN_IN_TEST_MODE=true`. See `backend/.env.example`.

## Release notes input: identity and consent (R1-01 to R1-07)

For `release_submission.md`:

- **Email transport:** sign-in codes are emailed through Brevo from a verified Gmail sender
  (the team owns no domain, so there is no DKIM or DMARC alignment and codes may land in
  junk). Test mode is also on: unused codes are listed at `/operator.html` so evaluators
  can sign in as accounts with no real inbox. Codes are 6 digits, expire in 10 minutes,
  are single-use, allow 5 wrong guesses, and are only issued to `@algomau.ca` addresses.
- **First admin:** created out of band by signing in once, then running
  `UPDATE users SET is_staff = true WHERE email = '...';` in the Supabase SQL Editor.
  Signing in never grants staff or faculty status.
- **Staff account for peer testers:** *to do — create one (e.g. a synthetic
  `@algomau.ca` address used via the operator console) and list it here.*
- **Known issue (test mode):** while test mode is on, anyone who can open the site can
  read pending codes on `/operator.html`, and so sign in as any `@algomau.ca` address with
  a pending code. This is the accepted cost of the test-mode substitute and goes away with
  `SIGN_IN_TEST_MODE=false`.
