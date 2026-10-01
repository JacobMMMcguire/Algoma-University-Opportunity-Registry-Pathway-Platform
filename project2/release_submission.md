# Release Submission

Release: R1
Team: team-XX <!-- TODO before submitting: the team number -->
Deployment: https://algoma-opportunity-registry-r1-backend.onrender.com
Repository: https://github.com/JacobMMMcguire/Algoma-University-Opportunity-Registry-Pathway-Platform
Release tag: R1-submission (on branch `r1-development`)
Commit: <!-- TODO at freeze: full SHA of the commit the R1-submission tag points to -->
Adapter: project2/evaluation_adapter.json
Known issues:
- **Test mode is on.** Unused sign-in codes are listed at `/operator.html` so testers can use
  accounts with no inbox. While it is on, anyone who can open the site can read a pending
  code and sign in as that `@algomau.ca` address. This is the accepted cost of the
  instructor-approved test mode.
- **Email may land in junk.** Codes are emailed through Brevo from a verified Gmail sender.
  With no team-owned domain, there is no DKIM or DMARC alignment, so university filters may
  treat them as junk.
- **First load can take about a minute.** The free Render instance sleeps when idle.
- **Fixture projects have no description**, because the fixture provides none, so their pages
  show no "About the project" section. A faculty member must add one before saving edits to
  such a project.
- **Contact needs a mail account.** "Open in Gmail" needs the student signed in to Google
  with their Algoma account, and "Open in email app" needs a mail app configured. The copy
  buttons work everywhere.

Test notes: The app is a single Render web service that serves the API and the pages from one
address. All pages and API paths are under the deployment URL above. To sign in: on the home
page, enter a test account address, press "Send sign-in code", open `/operator.html` (linked in
the menu), copy the code, and enter it. Each address can request 3 codes per 10 minutes.

## Test accounts

All accounts are synthetic and created by the fixture seed. None has an inbox: sign in with the
operator-console steps above.

| Account | Role | Use it to check |
|---|---|---|
| `fixture-test-staff@algomau.ca` | Staff | R1-04: grant or revoke verified faculty at `/admin.html` |
| `fixture-test-student@algomau.ca` | Student (signed in) | Signed-in discovery, which includes Dr. Mei Chen and her project |
| `fixture-f-alex@algomau.ca` | Verified faculty, public, open to inquiries | R1-05 to R1-08 and R1-11 to R1-16: profile, projects, publish, close, public choice |
| `fixture-f-priya@algomau.ca` | Verified faculty, public, listed projects only | R1-09, R1-22: contact through projects only |
| `fixture-f-jordan@algomau.ca` | Verified faculty, public, no projects | R1-18 |
| `fixture-f-mei@algomau.ca` | Verified faculty, declined public display | R1-06, R1-10, R1-14: signed-in only |
| `fixture-u-pending@algomau.ca` | Signed in, not verified | R1-03: no faculty features until staff verify |

Any other `@algomau.ca` address also works as a new student account. A real address gets the
code by email as well as on the operator console.

## Release-specific evidence

- **Email transport (R1-01):** real email through Brevo's HTTPS API, plus the instructor-approved
  test mode, because fixture accounts have no inbox and university delivery is not guaranteed.
  Either way, codes are short-lived (10 minutes), single-use (enforced in one SQL statement),
  limited to 5 wrong guesses, and only issued to addresses whose domain after the final `@` is
  exactly `algomau.ca` (server-side `ALLOWED_EMAIL_DOMAIN`).
- **First admin (R1-04):** created out of band. The first staff member signed in once, then
  `UPDATE users SET is_staff = true WHERE email = '...';` was run in the Supabase SQL Editor.
  The fixture seed creates the peer-tester staff account the same way. No sign-in path
  grants staff or faculty capability.
- **How the R1 fixture was loaded:** run migration
  `project2/backend/migrations/002_fixture_ids_and_student_levels.sql`, then
  `npm run seed:fixture` from `project2/backend` (or `npm run seed:fixture:sql`, pasted into
  the Supabase SQL Editor). The seed can be rerun to reset fixture records to the fixture's
  values without touching other data. There are no fixture controls in the app.
  - Fixture terms are translated: inquiry `general` becomes "Open to general student
    inquiries", `listed-projects-only` becomes "Inquiries about listed projects only", and
    status `withdrawn` becomes Closed.
  - Each fixture account's address is `fixture-<fixture_id>@algomau.ca`.
- **Public versus signed-in behaviour, checked from a logged-out session:**
  <!-- TODO: confirm after seeding the live site -->
  - Logged out, `/projects.html` lists exactly P-101, P-103, P-104 and P-107, the fixture's
    `expected_public` projects. `/faculty.html` lists Alex Morgan, Priya Shah and Jordan
    Lee.
  - Opening P-102, P-105, P-106 or P-108 by URL shows "not found", as does
    `/faculty.html?id=` for Mei Chen or Taylor Pending.
  - Signed in as `fixture-test-student@algomau.ca`, P-105 and Dr. Mei Chen also appear.
  - Automated: `project2/backend/test/fixture.test.js` checks every fixture project and
    faculty member against the fixture's `expected_public` and `expected_authenticated`
    flags (`npm test`).
- **Phone width and accessibility (R1-25, R1-26):** sixteen views across the student, faculty
  and staff journeys were checked in headless Chrome at 390px. None scrolled sideways, and
  axe-core (WCAG 2.1 A/AA plus best practice) reported no violations. Keyboard checks:
  - Filter results move focus to the result count.
  - Contact opens with Enter and focuses the subject.
  - Form errors move focus to the field that needs fixing.
- **Automated tests:** 105 `node:test` tests in `project2/backend/test`, run against an
  in-memory Postgres with `npm test`. They cover R1-01 to R1-24, including cross-user edits
  (R1-16), filters (R1-20), contact (R1-22) and persistence across sessions (R1-23).
