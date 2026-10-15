# Project 2 — Opportunity Registry and Pathway Platform

Release 1: faculty and project discovery with first contact by email.
Release 2 (in progress): accountless partner intake, faculty-supervised industry
opportunities, and faculty notification subscriptions.

- **Live:** https://algoma-opportunity-registry-r1-backend.onrender.com (auto-deploys the
  `r2-development` branch; work on feature branches off it). Release 1 as assessed is
  `r1-development`, tag `R1-submission`.
- **Developers and coding agents:** read [AGENTS.md](AGENTS.md) first, for the rules,
  code layout, testing, and how to add features.
- **Evaluators:** see [release_submission.md](release_submission.md) and
  [evaluation_adapter.json](evaluation_adapter.json).

## Infrastructure

Kept completely separate from Phase 0 (which lives on `master` with its own Render services
and Supabase project, and must not be touched while it is assessed):

- **Render:** one Web Service, root directory `project2/backend`, branch `r2-development`,
  build `npm install`, start `npm start`, health check `/api/health`. It serves the API and
  the frontend.
- **Supabase:** a dedicated project. Its Session pooler connection string is `DATABASE_URL`
  on the Render service. RLS is on for every table with no policies, so only the backend
  can read the data.
- **Render environment variables:** `DATABASE_URL`, `BREVO_API_KEY`, `EMAIL_FROM` (a
  Brevo-verified sender), `SIGN_IN_TEST_MODE=true`, `OPERATOR_SECRET` (private, at least 24
  characters; shared with authorised testers only through a private channel). See
  `backend/.env.example`.

## Release notes input: identity and consent (R1-01 to R1-07)

For `release_submission.md`:

- **Email transport:** sign-in codes are emailed through Brevo from a verified Gmail sender
  (the team owns no domain, so there is no DKIM or DMARC alignment and codes may land in
  junk). Test mode is also on: unused codes for the fixture test accounts are shown at
  `/operator.html` to authorised operators, so evaluators can sign in as accounts with no
  real inbox. Codes are 6 digits, expire in 10 minutes,
  are single-use, allow 5 wrong guesses, and are only issued to `@algomau.ca` addresses.
- **First admin:** created out of band by signing in once, then running
  `UPDATE users SET is_staff = true WHERE email = '...';` in the Supabase SQL Editor.
  Signing in never grants staff or faculty status.
- **Staff account for peer testers:** `fixture-test-staff@algomau.ca`, created by the
  fixture seed and signed in through the operator console (see `release_submission.md`).
- **Fixed after the R1 freeze (instructor finding, 2026-10-07):** in the frozen release, anyone
  who could open the site could read pending codes on `/operator.html` and sign in as any
  `@algomau.ca` address with a pending code. The console now requires an authorised operator
  (signed-in staff, or the private `OPERATOR_SECRET`), and lists codes for the fixture test
  accounts only. Real users' codes are never shown; they arrive by email.

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

## Release 2 notes input: partner intake (R2-01 to R2-06)

- Organisations propose a project at `/partner.html` ("Propose a project" in the menu) with
  no account or sign-in: organisation, contact name and email, title, description, optional
  areas, and how many student teams they could take (one team only, multiple teams
  possible, not sure).
- An incomplete submission is refused with a list of what to fix, and nothing is saved.
- A new submission is never shown to students. It waits as "Awaiting faculty supervisor",
  visible to verified faculty and staff at `/submissions.html`.
- Partner text is treated as data: it is shown exactly as typed and never runs as code or
  changes any record (fixture S-203 is stored and shown as ordinary text).
- Partner contact name and email are shown to verified faculty and staff only, never on any
  student or public page.

## Release 2 notes input: faculty publication gate and coordination (R2-07 to R2-15)

- An industry opportunity appears in student discovery as soon as one verified faculty
  member presses **I'm willing to supervise this**. There is no staff publication step.
- Any number of faculty can say they're willing; nobody gets exclusive rights. Withdrawing
  removes only yourself: if nobody is left, the opportunity goes back to "Awaiting faculty
  supervisor" and leaves student discovery; otherwise it stays visible.
- Saying you're willing needs the same as publishing a project: the public-display choice
  made (either answer) and a faculty profile, because students see the supervisor's name.
- Faculty see how many verified faculty are willing, and who, on every opportunity.
- Faculty can record the partner engagement state (Not contacted, Discussion underway,
  Partner confirmed, No longer pursuing). Other faculty see it with the name of whoever
  recorded it. It is coordination only: it blocks nobody from volunteering or contacting
  the partner, and it is never shown to students or visitors.

## Release 2 notes input: notifications (R2-16 to R2-20)

- **Delivery: an in-product notification list** at `/notifications.html` ("Notifications"
  in the menu for verified faculty). No email is sent.
- Faculty choose "nothing", "every new industry opportunity" or chosen areas in a private
  section of `/profile.html`. The choice never appears on any public or student page.
- A faculty member is notified when a submission arrives that matches their settings at
  that moment, so changes apply to later submissions. Notifications only help: every
  opportunity can always be browsed at `/submissions.html`, notified or not.

## Release 2 notes input: discovery and regression (R2-21 to R2-26)

- `/projects.html` lists faculty projects and supervised industry projects together. Each
  card is labelled "Faculty project" or "Industry project · proposed by (organisation)",
  and a Type filter shows one kind. All the R1 filters apply to both (industry projects have
  no student level or term, so those filters leave them out).
- An industry project's page, `/opportunity.html?id=N`, names each supervising faculty
  member and links to their profile. Logged-out visitors see an industry project only
  through supervisors who allowed public display. Contact drafts an email to a supervising
  faculty member, never to the partner.
- Only verified faculty can record willingness or engagement; students and staff get
  "access denied" whatever the request says, and naming another faculty member in a request
  only ever affects the person signed in. Staff can read partner submissions (R2-05).
- The Release 1 API and pages keep working as before; all R1 test suites still pass.
- The assessed version will be tagged `R2-submission` on `r2-development` (R2-26).
- The R2 fixtures (`r2_fixtures/`) are loaded by the same `npm run seed:fixture`, after
  applying migrations `003` and `004`. Automated tests check the app against
  `expected_intake_outcomes.json`, including which faculty each submission notifies.
