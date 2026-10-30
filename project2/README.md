# Project 2 — Opportunity Registry and Pathway Platform

Release 1: faculty and project discovery with first contact by email.
Release 2: accountless partner intake, faculty-supervised industry opportunities, and faculty
notification subscriptions.
Release 3 (in progress, branch `r3-development`): matching, term lifecycle and outcomes.

- **Live:** https://algoma-opportunity-registry-r1-backend.onrender.com (auto-deploys the
  `r1-development` branch). Assessed releases are the tags `R1-submission` and
  `R2-submission`.
- **Developers and coding agents:** read [AGENTS.md](AGENTS.md) first, for the rules,
  code layout, testing, and how to add features.
- **Evaluators:** see [release_submission.md](release_submission.md) and
  [evaluation_adapter.json](evaluation_adapter.json).

## Infrastructure

Kept completely separate from the graded Phase 0 warm-up, which lives on `master` with its own
Render services and Supabase project:

- **Render:** one Web Service, root directory `project2/backend`, branch `r1-development`,
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
- The assessed version is tagged `R2-submission` on the deployed commit (R2-26). R2 was merged
  into `r1-development`, the branch Render deploys; `r2-development` is moved to the same commit.
- The R2 fixtures (`r2_fixtures/`) are loaded by the same `npm run seed:fixture`, after
  applying migrations `003` and `004`. Automated tests check the app against
  `expected_intake_outcomes.json`, including which faculty each submission notifies.

## Release 3 notes input: term lifecycle (R3-08 to R3-13, R3-19)

- **Clock (fixture deadlines):** the server treats `CLOCK_DATE` as today for every deadline.
  Render has `CLOCK_DATE=2026-11-06`, the R3 fixture's `evaluation_date`, and every page shows
  "Deadlines are evaluated as of 6 November 2026 (a simulated date, set for evaluation)". With
  it unset, the real date in Toronto is used. A deadline passes at the end of its day.
- Each opportunity has a target term and an optional faculty deadline. Centre staff can set a
  Centre deadline, which overrides it (R3-08).
- Lifecycle states:
  - **Open.**
  - **Matched:** a fully confirmed match exists; it doesn't expire.
  - **Expired:** the deadline passed without a confirmed match.
  - **Withdrawn**, **Completed** and **Archived**.

  Only withdrawn, completed and archived are stored. Matched and expired are worked out from
  the matches and the date, so they can't go stale. Nothing is ever deleted.
- Faculty manage their own projects and the industry opportunities they supervise, and staff
  manage all of them, at `/lifecycle.html` ("Terms and deadlines"). There they can withdraw,
  complete, archive, reopen (with a new deadline if it has passed), or renew an expired or
  completed opportunity for a later term. Renewal keeps the same record and id and adds a new
  run, so earlier terms keep their matches and history.
- Student discovery lists only open opportunities. Opening a removed one by its link says why,
  for example "Expired: the deadline, 20 October 2026, passed without a confirmed match."
- R2's engagement option "Partner confirmed" is now labelled "Partner agreed in principle".

## Release 3 notes input: matches (R3-01 to R3-07, R3-22)

- A verified faculty member proposes a match on an open opportunity they manage, naming one or
  more students by their Algoma email at `/matches.html` (R3-01). Students who haven't signed in
  yet see it when they first do; the home page tells a student when a proposal is waiting.
- Each student confirms or declines for themselves. A match is **confirmed** only when every
  student named has confirmed; until then it is **proposed** or **partly confirmed** (R3-02).
  Nobody can answer for anyone else, and students can only answer matches proposed to them
  (R3-03).
- Students can decline, even after confirming, until everyone has confirmed. Faculty can
  withdraw a proposal until then. Declined and withdrawn matches are kept and shown as such
  (R3-04). Every participant sees the state and each student's answer (R3-05).
- A match on an opportunity whose deadline has passed can't be confirmed afterwards: the
  expiry stands, and the faculty member can reopen the opportunity with a new deadline. This is
  why M-402 (S11 never confirmed) leaves O-302 expired.
- Every match shows: "It is not course registration, and it doesn't mean eligibility, academic
  credit or any official approval has been checked or granted." (R3-06)
- For industry opportunities, a supervising faculty member can record "Partner agreed in
  principle, recorded by (name) on (date)", or retract it. Records are kept per term and never
  overwritten, and the page says it is the faculty member's own statement (R3-07).
- Matches are visible only to their students and the faculty who manage the opportunity: not
  publicly, not to other students and not to staff (R3-22).
- Students can add a display name and a public-display choice at `/student-profile.html`.
  Fixture students S01, S02, S05, S08, S11 and S17 are accounts `fixture-s01@algomau.ca` and so
  on, named "Student S01" and with no public-display choice (so not public).

## Release 3 notes input: outcomes and showcase (R3-14 to R3-18, R3-20)

- A student on a confirmed match, or a faculty member on its opportunity, records an outcome at
  `/outcomes.html` ("Your outcomes"): summary, completion date, the students and faculty who
  took part, and optional demo, repository, poster, video and image links (R3-14).
- Until a faculty member on it confirms it, only its participants can see it (R3-15). Editing a
  confirmed outcome takes it out of public view until it is confirmed again.
- A confirmed outcome appears in **Completed work** (`/showcase.html`) and on profiles only if
  every faculty member on it allows public display (R3-16). That is why R-503 (F-MEI) stays
  private while R-501 is public. Partner contact details never appear; only the organisation's
  name.
- Faculty profiles list their public outcomes. Students have a profile page too, shown to
  visitors only if they chose public display (R3-17, R3-20). Each student chooses whether an
  outcome appears on their own profile, which doesn't remove it from the faculty profile or
  Completed work (R3-18).
- Students are named to visitors only if their own profile is public; otherwise they are
  counted, not named.
- `/outcomes.html` explains who decides whether a result appears publicly.

## Release 3 notes input: regression (R3-23)

- The R1, R2 and R3 fixtures load together with one `npm run seed:fixture`. Rerunning it
  resets the fixture records, including any matches, partner agreements and outcomes added on
  the R3 fixture opportunities, so evaluators can repeat a walkthrough from the same start.
- With all three loaded and the clock at 6 November 2026, the tests check every R3 expected
  result and that the R1 and R2 expected results still hold (`test/regression.test.js`).
- One R2 behaviour changes on purpose: the R2 partner submissions that the R3 fixture reuses
  (S-201, S-202, S-205, S-206) are matched, expired or completed in R3, so they leave student
  discovery (R3-19).
- Every page was checked as each kind of user at phone width with an accessibility checker.
  Three small issues were fixed: repeated form names on two pages, and a missing page heading
  on the industry opportunities page when access is refused.
