# Release Submission

Release: R2
Team: Jacob McGuire, Sineru Mahamillage, Paris Lad
Deployment: https://algoma-opportunity-registry-r1-backend.onrender.com
Repository: https://github.com/JacobMMMcguire/Algoma-University-Opportunity-Registry-Pathway-Platform
Release tag: R2-submission
Commit: <!-- TODO at freeze: full SHA of the commit the R2-submission tag points to -->
Adapter: project2/evaluation_adapter.json (we couldn't find `evaluation_adapter_template.json` on
the course site, so this extends our R1 adapter with the intake surface, the willingness and
engagement actions, the subscription settings and student discovery)
Known issues:
- **Test mode is on, and limited to authorised operators.** Sign-in codes for the synthetic test
  accounts are readable at `/operator.html` only by signed-in staff or with a private operator
  access code. Real users get their codes by email only.
- **The partner form has no rate limit or CAPTCHA.** Anyone can submit repeatedly. Submissions
  are never public (they go to faculty and staff only), but repeated ones would add noise and
  notifications.
- **Notifications are in-product only.** No email is sent for new opportunities.
- **Industry opportunities have no student level or target term**, so filtering projects by
  either of those leaves industry opportunities out. The project list doesn't explain this
  on the page.
- **Sign-in emails may land in junk.** They come from a verified Gmail sender through Brevo,
  with no team-owned domain.
- **First load can take about a minute.** The free Render instance sleeps when idle.
- **Fixture projects from R1 have no description**, because the fixture provides none.

Test notes: One Render web service serves the pages and the API from the deployment URL above.
Partners need no account: use `/partner.html` ("Propose a project" in the menu) while signed out.
To sign in as a test account: on the home page enter its address and press "Send sign-in code".
Then open `/operator.html`, enter the operator access code (shared privately through the course
channel, never in this repository), copy the code, and enter it. Each address can request 3 codes
per 10 minutes. The Release 1 version is preserved at tag `R1-submission`.

## Test accounts

All are synthetic, created by the fixture seed, and have no inbox.

| Account | Role | Use it to check |
|---|---|---|
| *(none: signed out)* | Partner | R2-01 to R2-06: submit at `/partner.html` with no account |
| `fixture-test-student@algomau.ca` | Student | R2-21 to R2-23: industry and faculty projects together at `/projects.html` |
| `fixture-test-staff@algomau.ca` | Staff | R2-02, R2-05: sees every submission and partner contact at `/submissions.html`; R1-04 verification |
| `fixture-f-alex@algomau.ca` | Verified faculty; subscribed to AI and Data Science | R2-07 to R2-14: willingness, engagement; R2-18 area notifications |
| `fixture-f-priya@algomau.ca` | Verified faculty; subscribed to Human-Computer Interaction | R2-09, R2-13: a second faculty member on the same opportunity |
| `fixture-f-jordan@algomau.ca` | Verified faculty; subscribed to everything | R2-18: notified about every submission |
| `fixture-f-mei@algomau.ca` | Verified faculty; subscribed to nothing; signed-in-only profile | R2-19: never notified, still browses every opportunity |
| `fixture-u-pending@algomau.ca` | Signed in, not verified | R2-24: no willingness, engagement or partner contact details |

## Release-specific evidence

- **Deployed assessed URL:** https://algoma-opportunity-registry-r1-backend.onrender.com
  (Render deploys branch `r1-development`; `r2-development` points at the same commit).
- **Immutable release identifier:** tag `R2-submission`, commit above.
- **How the R2 fixture was loaded:**
  1. Run migrations `project2/backend/migrations/003_partner_submissions.sql` and
     `004_supervision_engagement_subscriptions.sql` in the Supabase SQL Editor.
  2. Run `npm run seed:fixture:sql` from `project2/backend` and paste its output into the same
     editor. Equivalently, run `npm run seed:fixture` with `DATABASE_URL` set. This loads the R1
     fixture and then the R2 fixtures.

  `expected_intake_outcomes.json` was treated as acceptance criteria, not imported:
  - Each submission in `intake_submissions.json` goes through the same validation as the public
    form, so S-204 (empty organisation and title) is rejected and never stored.
  - The accepted five arrive with no supervisor, so they read "Awaiting faculty supervisor" and
    are not student-visible.
  - Notifications are generated from `faculty_subscriptions.json` exactly as the form would
    generate them.
  - `project2/backend/test/partner-intake.test.js`, `notifications.test.js` and
    `publication-gate.test.js` check the app against every entry in
    `expected_intake_outcomes.json`.
- **Evaluator setup:** the accounts above, through the operator console. The partner role needs
  no setup.
- **How notifications are delivered:** an in-product notification list at `/notifications.html`
  ("Notifications" in the menu, verified faculty only). No email. **To observe one:**
  1. While signed out, submit a project at `/partner.html` with the area *Human-Computer
     Interaction*.
  2. Sign in as `fixture-f-priya@algomau.ca` and open Notifications. The new submission is at the
     top.
  3. Signed in as `fixture-f-mei@algomau.ca` (subscribed to nothing), it is not in her
     notifications, but it is listed for her at `/submissions.html` (R2-19).
- **Public versus private, checked logged out on the live deployment** on 2026-10-16, after
  seeding:
  - `/api/opportunities` returns no industry opportunities, since none has a supervisor yet.
  - Searching the public list for S-203's injected text finds nothing.
  - `/api/partner-submissions` and `/api/notifications` return 401.
  - The four public R1 projects are unchanged.
  - Signed in as `fixture-test-staff@algomau.ca`, `/submissions.html` lists exactly the five
    accepted submissions (no S-204). S-203's injected instructions and `<script>` tag display
    as plain text with no script run, and it remains "Awaiting faculty supervisor".
- **Automated tests:** 186 `node:test` tests (`npm test` in `project2/backend`) cover R1 and
  R2-01 to R2-25, including cross-user and non-faculty attempts (R2-24) and the R1 regression
  suites (R2-25).
- **Post-R1 change carried into R2:** the instructor's R1 security finding was fixed in tag
  `R1-fix-1`. The operator console requires authorisation and only shows test-account codes.
