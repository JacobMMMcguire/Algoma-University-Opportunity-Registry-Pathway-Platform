# Release Submission

Release: R3
Team: Jacob McGuire, Sineru Mahamillage, Paris Lad
Deployment: https://algoma-opportunity-registry-r1-backend.onrender.com
Repository: https://github.com/JacobMMMcguire/Algoma-University-Opportunity-Registry-Pathway-Platform
Release tag: R3-submission
Commit: 6be0d40cf16958d9ec1f088128cec35853b05e5b
Adapter: project2/evaluation_adapter.json (extends our R2 adapter with the clock, lifecycle
states and actions, match routes, and the outcome and showcase surfaces)
Known issues:
- **Faculty propose a match by typing students' `@algomau.ca` addresses.** There is no student
  directory to pick from, which keeps students private but means the faculty member must know
  the address.
- **Students hear about a proposed match in the product only.** The home page and Matches page
  show it the next time they sign in. No email is sent.
- **The fixture students haven't made a public-display choice**, because the fixture gives none.
  Visitors therefore see R-501's student as "1 student who hasn't chosen public display";
  signed-in users see the name. A student who sets their profile to public is named.
- **`2026S` is read as Summer 2026.** The fixture doesn't define it; its May 30 deadline and
  August completion fit a summer term.
- **Outcomes can't be deleted.** They can be edited, which takes them out of public view until a
  faculty member confirms them again, or have their confirmation taken back.
- **Industry opportunities have no student level**, so filtering by level leaves them out. They
  now have a term and deadline per run; R2 submissions not in the R3 fixture have neither until
  a supervisor sets them, and never expire until then.
- **Test mode is on, and limited to authorised operators.** Sign-in codes for the synthetic test
  accounts are readable at `/operator.html` only by signed-in staff or with a private operator
  access code. Real users get their codes by email only.
- **The partner form has no rate limit or CAPTCHA**, as in R2.
- **Sign-in emails may land in junk.** They come from a verified Gmail sender through Brevo,
  with no team-owned domain.
- **First load can take about a minute.** The free Render instance sleeps when idle.
- **Fixture projects have no description or research areas**, because the fixtures provide none.

Test notes: One Render web service serves the pages and the API from the deployment URL above.
To sign in as a test account: on the home page enter its address and press "Send sign-in code".
Then open `/operator.html`, enter the operator access code (shared privately through the course
channel, never in this repository), copy the code, and enter it. Each address can request 3 codes
per 10 minutes. Releases 1 and 2 are preserved at tags `R1-submission` and `R2-submission`.

## Test accounts

All are synthetic, created by the fixture seed, and have no inbox. Students are
`fixture-s01@algomau.ca` and so on, for every student the R3 fixture names (S01, S02, S05, S08,
S11, S17).

| Account | Role | Use it to check |
|---|---|---|
| *(none: signed out)* | Visitor | R3-19: only open opportunities; R3-20: Completed work at `/showcase.html` |
| `fixture-f-priya@algomau.ca` | Verified faculty, owner of O-303, O-305, O-307 | R3-01: propose the two-student match below; R3-08 to R3-13 at `/lifecycle.html` |
| `fixture-s08@algomau.ca`, `fixture-s11@algomau.ca` | Students | R3-02, R3-03: each confirms for themselves at `/matches.html` |
| `fixture-f-alex@algomau.ca` | Verified faculty, supervises O-301, O-302 | R3-07: partner agreement; R3-15: confirm R-502 at `/outcomes.html` |
| `fixture-f-jordan@algomau.ca` | Verified faculty, supervises O-304, O-306 | R3-17: R-501 on their public profile |
| `fixture-f-mei@algomau.ca` | Verified faculty, signed-in-only profile | R3-16: R-503 is confirmed by F-MEI but stays private |
| `fixture-s02@algomau.ca` | Student on M-404 | R3-17, R3-18: R-501 on their profile, and hiding it |
| `fixture-s17@algomau.ca` | Student who declined M-403 | R3-22: can't open anyone else's match |
| `fixture-test-staff@algomau.ca` | Staff | R3-08: Centre deadline; R3-13: reopen; every state at `/lifecycle.html` |
| `fixture-test-student@algomau.ca` | Student on no match | R3-21, R3-22: no access to matches or private outcomes |

## Release-specific evidence

- **Deployed assessed URL:** https://algoma-opportunity-registry-r1-backend.onrender.com
  (Render deploys branch `r1-development`; `r3-development` points at the same commit).
- **Immutable release identifier:** tag `R3-submission`, commit above.
- **How the R3 fixture was loaded:**
  1. Run migrations `005_runs_lifecycle_matches.sql`, `006_student_profiles.sql` and
     `007_outcomes.sql` from `project2/backend/migrations/` in the Supabase SQL Editor.
  2. Run `npm run seed:fixture:sql` from `project2/backend` and paste its output into the same
     editor (or run `npm run seed:fixture` with `DATABASE_URL` set). One seed loads the R1, R2
     and R3 fixtures, in that order.

  How the fixture is translated (`project2/R3_PLAN.md`, D9):
  - Industry O-301, O-302, O-304 and O-306 are the R2 submissions with the same titles, with the
    fixture owner as a willing supervisor.
  - Faculty O-303, O-305 and O-307 become faculty projects.
  - Students become the accounts above, each with a student profile.
  - Terms `2026F`, `2027W` and `2026S` become Fall 2026, Winter 2027 and Summer 2026.

  The seed is rerunnable. It resets the fixture records, including matches, partner agreements
  and outcomes added on the R3 fixture opportunities. Reseeding after a walkthrough therefore
  restores the expected results. `expected_lifecycle_results.json` was treated as acceptance
  criteria, not imported.
- **How deadlines are evaluated (the clock):** Render has `CLOCK_DATE=2026-11-06`, the fixture's
  `evaluation_date`. Every lifecycle decision uses that date as "today", and every page says
  "Deadlines are evaluated as of 6 November 2026 (a simulated date, set for evaluation)".
  `GET /api/auth/me` returns it as `clock`. A deadline passes at the end of its day. Removing
  `CLOCK_DATE` makes the app use the real date in Toronto, with no code change.
- **One opportunity in each lifecycle state**, at `/lifecycle.html` as staff or the owner:

  | State | Opportunity | Why |
  |---|---|---|
  | Open | O-303 Accessible museum guide | Deadline 15 December 2026 |
  | Matched | O-301 Warehouse pick-path visualisation | M-401 fully confirmed, though its deadline passed |
  | Expired | O-302 Anomaly review dashboard | Deadline 20 October passed; M-402 only partly confirmed (S11) |
  | Expired | O-304 Sensor calibration record keeper | Deadline 30 September passed; M-403 declined |
  | Withdrawn | O-305 Campus wayfinding study | Withdrawn by its owner |
  | Completed | O-306 Shift handover notes | Completed |
  | Archived | O-307 Archived library navigation pilot | Archived |

  Signed out, discovery (`/projects.html`) lists only O-303 of these (R3-19). Opening one of
  the others by its link says why it is gone, e.g. "Expired: the deadline, 20 October 2026,
  passed without a confirmed match".
- **Evaluator setup: faculty, two students on one match, and staff.**
  1. Sign in as `fixture-f-priya@algomau.ca`, open Matches, and under O-303 propose a match to
     `fixture-s08@algomau.ca` and `fixture-s11@algomau.ca`. It reads "Proposed".
  2. Sign in as `fixture-s08@algomau.ca` and confirm at Matches. The match reads "Partly
     confirmed" and O-303 is still open. Priya can't confirm for a student (R3-03).
  3. Sign in as `fixture-s11@algomau.ca` and confirm. The match reads "Confirmed" and O-303
     becomes Matched, leaving discovery (R3-02, R3-10).
  4. As `fixture-test-staff@algomau.ca`, at Terms and deadlines, O-303 shows Matched. Staff can
     set a Centre deadline or reopen an opportunity, but can't see matches (R3-22).
  5. Run the seed again to return to the fixture's state.
- **Outcomes: one public and one awaiting confirmation.**
  - **R-501** (O-306, F-JORDAN, S02) is confirmed and public: it is in Completed work at
    `/showcase.html` and on Dr. Jordan Lee's profile, with its repository link.
  - **R-502** (O-301, F-ALEX, S01 and S05) awaits faculty confirmation. Signed out or as an
    unrelated user it returns 404. Its participants see "Awaiting faculty confirmation" at
    `/outcomes.html`. Confirming it as `fixture-f-alex@algomau.ca` makes it public.
  - **R-503** (O-306, F-MEI, S02) is confirmed but stays private, because F-MEI doesn't allow
    public display. Its participants are told why at `/outcomes.html`.
- **Checked logged out on the live deployment** on 2026-10-30, after seeding: the clock reads
  6 November 2026; of the R3 opportunities, discovery lists only O-303; O-305 and O-307 open by
  link as withdrawn and archived with their reasons; Completed work shows only R-501, with its
  repository link, Dr. Jordan Lee named and its student counted; R-501 is on Dr. Jordan Lee's
  profile; no other outcome opens by id; no email address or F-MEI appears; the four public R1
  projects and the public faculty directory are unchanged; `/api/matches` and
  `/api/partner-submissions` return 401.
- **Public versus private (R3-16, R3-22):** no public response names a match's students, and
  no outcome shows partner contact details or an email address. Students are named to visitors
  only if they made their own profile public.
- **Automated tests:** 270 `node:test` tests (`npm test` in `project2/backend`).
  - `lifecycle.test.js`, `matches.test.js` and `outcomes.test.js` cover R3-01 to R3-22.
  - `regression.test.js` (R3-23) loads all three fixtures exactly as the seed does, with the
    clock at 6 November. It checks every entry in `expected_lifecycle_results.json` and the
    R1 and R2 expected results. Then it performs the walkthrough above, reseeds, and checks
    everything again.
  - The R1 and R2 suites still pass unchanged.
- **R1 and R2 regression (R3-23).** One R2 behaviour changes on purpose. The four R2
  submissions that the R3 fixture reuses are matched, expired or completed, so they left
  student discovery (R3-19). Every page was also checked at phone width (390px) with axe-core,
  as each kind of user, with no violations.
