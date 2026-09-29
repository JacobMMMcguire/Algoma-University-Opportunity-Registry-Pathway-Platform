# Project 2 — Opportunity Registry and Pathway Platform

Release 1: faculty/project discovery and first contact. See the Release 1 brief and
requirements (R1-01 through R1-26) for the full spec.

## Isolation from Phase 0

This code lives on the `r1-development` branch, separate from `backend/`/`frontend/` at
the repo root (which stay frozen as the submitted Phase 0 warm-up).

- **Deployment**: needs its own Render services (Web Service for `project2/backend`,
  Static Site for `project2/frontend`), connected to this repo but watching
  `r1-development` (or whatever branch replaces it later) — not `master`. The existing
  Phase 0 Render services stay untouched.
- **Database**: needs its own Supabase project — do not point this backend at the
  Phase 0 Supabase project. Set the new project's connection string as `DATABASE_URL`
  on the new Render backend service only.

## Local development

1. Create the new Supabase project and run this project's schema against it (not yet
   written — see "Open decisions" below).
2. `cd project2/backend && copy .env.example .env` and set `DATABASE_URL`.
3. `npm install` then `npm start` (defaults to port 3001, so it can run alongside the
   Phase 0 backend on 3000 if needed).
4. Set `window.API_BASE_URL` in `project2/frontend/config.js`.
5. Serve `project2/frontend/` with any static server.

## Status

Scaffolding only — health-check backend and a placeholder frontend page, enough to
prove the deploy pipeline once the new Render/Supabase resources exist. No data model,
auth, or feature routes yet.

## Open decisions

- **Auth approach for R1-01/02/03** (passwordless algomau.ca-only sign-in): custom
  Express-based challenge surfaced to an authorized operator (test mode) vs. Supabase
  Auth's built-in magic link/OTP. Affects the schema (a `sign_in_challenges` table vs.
  none) and the `users` table shape.
- **New Supabase project**: not yet created.
- **New Render services**: not yet created.
