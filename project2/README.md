# Project 2 — Opportunity Registry and Pathway Platform

Release 1: faculty and project discovery with first contact by email.

- **Live:** https://algoma-opportunity-registry-r1-backend.onrender.com (auto-deploys the
  `r1-development` branch)
- **Developers and coding agents:** read [AGENTS.md](AGENTS.md) first, for the rules,
  code layout, testing, and how to add features.
- **Evaluators:** see [release_submission.md](release_submission.md) and
  [evaluation_adapter.json](evaluation_adapter.json).

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
- **Staff account for peer testers:** `fixture-test-staff@algomau.ca`, created by the
  fixture seed and signed in through the operator console (see `release_submission.md`).
- **Known issue (test mode):** while test mode is on, anyone who can open the site can
  read pending codes on `/operator.html`, and so sign in as any `@algomau.ca` address with
  a pending code. This is the accepted cost of the test-mode substitute and goes away with
  `SIGN_IN_TEST_MODE=false`.

## Release notes input: faculty profiles (R1-08 to R1-10)

- Verified faculty edit their profile at `/profile.html`: display name, short description,
  research areas, inquiry preference, optional links. Saving needs the public-display
  choice to have been made first (R1-05); either answer works.
- Students see the inquiry preference as plain text, for example "Inquiries about listed
  projects only" with a one-line explanation, never the stored code.
- `/faculty.html` lists profiles and `/faculty.html?id=N` shows one. Logged-out visitors see
  only faculty who allowed public display; a direct link to any other profile shows "not
  found". Signed-in users also see signed-in-only profiles, labelled as such.

## Release notes input: faculty projects (R1-11 to R1-16)

- Verified faculty manage projects at `/my-projects.html` and create or edit one at
  `/project-edit.html`: title, short description, research areas, optional student level,
  target term, and an optional background or prerequisite note.
- Saving always creates a **draft** that only its owner can see. A project becomes visible
  only when the owner presses **Publish**, which needs the public-display choice to have
  been made first (R1-05; either answer works) and a saved faculty profile, so every
  visible project names its faculty member and links to their profile.
- Published projects follow the owner's public-display choice: public faculty's projects
  are visible to everyone, the rest only to signed-in users. `/projects.html` lists them,
  `/projects.html?id=N` shows one, and each faculty profile lists that person's projects.
  Drafts, closed projects and hidden projects all show "not found" to other users.
- **Close** withdraws a project from students; nothing is deleted, and the owner can edit
  and reopen it later. Projects of faculty whose verification is revoked disappear for
  everyone and come back if they are re-verified.
- Ownership is enforced in the database query for every write: editing, publishing or
  closing another faculty member's project by changing the id, URL or request body gets
  "not found" and changes nothing.
- Research areas come from a fixed list of about 60 areas grouped by discipline, student
  level from three fixed values (or unset), and the target term from a season and year
  picker, so the same thing is always spelled the same way for filtering.

## Release notes input: discovery and contact (R1-17 to R1-26)

- `/faculty.html` and `/projects.html` filter by research area plus search text; projects
  also by student level, term and faculty member, faculty also by inquiry preference.
  Every chosen filter must match; each choice shows how many results it has; filters stay
  in the URL, so results survive a refresh and can be shared.
- A faculty member with no current project still appears in faculty discovery (R1-18).
- **Contact faculty** (R1-22) drafts an editable subject and message, prefilled with the
  project or research context, then opens it in the student's own Gmail or mail app (or
  copies it). The site never sends the email itself. Contact appears where the faculty
  member invites it: on the profile of faculty open to general inquiries, and on the
  projects of faculty who take project inquiries; not at all for faculty not accepting.
- Every main-journey page was checked at 390px wide (no sideways scrolling) and with an
  automated accessibility audit (axe-core, WCAG 2.1 AA: no violations).

## Release notes input: fixture

- The provided `r1_fixture.json` is loaded with `npm run seed:fixture` (or its SQL pasted
  into Supabase via `npm run seed:fixture:sql`). It is rerunnable, never runs automatically,
  and has no controls in the app. Automated tests check the app against the fixture's own
  expected-visibility flags.
