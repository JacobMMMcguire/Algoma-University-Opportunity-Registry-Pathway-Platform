# Release Submission

Release: FINAL
Team: Jacob McGuire, Sineru Mahamillage, Paris Lad
Project Option: Project 2 (Opportunity Registry and Pathway Platform)
Deployment: https://algoma-opportunity-registry-r1-backend.onrender.com
Repository: https://github.com/JacobMMMcguire/Algoma-University-Opportunity-Registry-Pathway-Platform
Release tag: FINAL-submission
Commit: the commit the tag points to (`git rev-parse FINAL-submission`), recorded in the docs
commit after tagging.
Adapter: project2/evaluation_adapter.json (`release: "FINAL"`: one check per F-requirement, plus
`recovery_actions`, `staff_reassignment`, `operator_observability` and `discovery`; the R1 to R4
maps are kept under `earlier_releases`)

Known issues: see "Launch readiness" below.

Test notes:
- One Render web service serves the pages and the API.
- The clock is simulated at 6 November 2026 (`CLOCK_DATE`), as for R3.
- To sign in as a test account, enter its address at `/signin.html`, then read the code at
  `/operator.html` with the operator access code.
- The free instance can take about a minute to wake.
- Releases 1 to 4 are at tags `R1-submission` to `R4-submission`.

## Test accounts

All accounts are synthetic, created by the fixture seed, with no inbox. **The address for each role
and the operator access code are in Moodle under Reviewer test access**, never in this file.

| Role | Fixture person | Use it to check |
|---|---|---|
| Visitor | (signed out) | Discovery, consent-driven visibility, Completed work, departed and graduated profiles |
| Student | S01 | Discovery to contact, matches, outcomes, external handoff |
| Graduated student | S02 | Alumni profile; RC-03 (undo their own confirmation of M-404) |
| Verified faculty (control) | F-JORDAN | Intake to match, RC-03 (undo S02's confirmation), RC-04, RC-05 |
| Verified faculty, not accepting inquiries | F-PRIYA | RC-02 (reopen O-305); stays listed without contact |
| Departed faculty | F-ALEX | Signs in but can no longer act as faculty (403); profile says "No longer at Algoma University" |
| Staff / operator | test staff | `/operations.html`, `/lifecycle.html` (RC-01, reassignment), `/admin.html`, `/sync.html` |

## Release-specific evidence

- **Launch candidate:** https://algoma-opportunity-registry-r1-backend.onrender.com. Render
  deploys `r1-development`, which is the same commit as `final-development`.
- **Immutable identifier:** tag `FINAL-submission`.
- **Evaluator setup:**
  1. Migration `009_final_hardening.sql` is applied.
  2. `npm run seed:fixture` (pasted into the Supabase SQL Editor) loads R1 to R3 and then the Final
     layer from `project2/final_fixtures/`:
     - F-ALEX has left, F-PRIYA isn't accepting inquiries, and S02 has graduated;
     - each recovery case is in its wrong starting state.

     A reseed restores those states after a walkthrough.
  3. External data: staff run "Feed v1 (last week)" at `/sync.html`.
- **Recovery cases (F-06 to F-08).** Each case is fixed through the product, keeps its id, and
  shows who changed it.

  | Case | Who fixes it | Where | Result |
  |---|---|---|---|
  | RC-01 | Staff | Terms and deadlines: set a later Centre deadline on O-303 | Open |
  | RC-02 | F-PRIYA or staff | Terms and deadlines: reopen O-305 with a new deadline | Open |
  | RC-03 | S02 or F-JORDAN | Matches: Undo my confirmation (or Undo S02's confirmation) on M-404 | Proposed |
  | RC-04 | Any verified faculty | Industry opportunities: O-302's engagement back to Not contacted | Not contacted |
  | RC-05 | F-JORDAN | Your outcomes: take R-501's confirmation back | Participants only |

  History appears on Terms and deadlines and on Operations under "Who changed what".
  `test/final-regression.test.js` checks every key of `expected_final_results.json` and does all
  five fixes, then a reseed.
- **Stale people and orphans (F-09 to F-12):**
  - F-ALEX's page stays, with his past work and no contact, and he is out of the directory.
  - R-502 and R-501 survive and stay attributed.
  - S02 shows as an alumnus.
  - O-302 (and F-ALEX's R1 projects P-101 and P-107) show "Needs a new supervisor", out of
    discovery with a plain reason. Staff reassign each one on Terms and deadlines to a faculty
    member who agreed. Nothing is deleted.
- **How the scale fixture was loaded (F-17):**
  - `src/scale.js` creates the 240 accounts the way every fixture account is made.
  - It then does everything else through the app's HTTP routes, as each person:
    - sign-in through the operator console;
    - staff verification;
    - profiles and projects;
    - partner submissions and willingness;
    - deadlines;
    - matches and confirmations, and completions;
    - faculty support and student statuses;
    - departures and graduations.
  - The 32 external records arrive through the ordinary sync.
  - Run it with `npm run scale:evidence` (in memory). It is not loaded live, where it would crowd
    the evaluation fixtures.
  - The choices the fixture leaves open (dates, students) are in `DECISIONS.md`.
- **Scale test evidence (F-17 to F-19):** `final_evidence/scale_evidence.json` and
  `test/scale.test.js`.
  - 160 opportunities, each in the fixture's state on the evaluation date.
  - The first discovery load is 20 records, about 23 KB with about 20 listed and 26 KB with the
    full set, against 84 KB for every record.
  - Staff queues (users, opportunities, industry submissions, notifications, history) are 20 at a
    time, with search.
- **How a sync failure is simulated (F-13):** as staff at `/sync.html`, choose "Simulated
  failure: source unreachable" (or "response cannot be parsed") and press Run sync now.
  - The run is recorded as failed with its reason.
  - All external data is kept, and students see "This information may be out of date".
  - The rest of the site is unaffected.
- **How a notification failure is simulated (F-14):**
  1. As staff at `/operations.html`, turn on "Evaluation: simulate a notification failure" (test
     mode only).
  2. Submit a proposal at `/partner.html`. It is saved and listed on Industry opportunities, and
     Operations shows the failure with its reason.
  3. Turn the simulation off and press Retry. Subscribers are notified once.
- **Regression checklist (F-25):** `final_evidence/regression_checklist.md`, 16 R1 to R4
  journeys, all passing.
- **Automated tests:** 375 `node:test` tests in `project2/backend`, all passing.
  - `test/authorization-sweep.test.js` tries all 76 API routes as six kinds of wrong user and
    checks nothing changes (F-01 to F-05).
- **Phone width and accessibility (F-20, F-21):** 58 page views across seven roles at 390px in
  headless Chrome with axe-core, with no overflow, violations or errors
  (`final_evidence/browser_pass.json`).
- **Live checks:** recorded in the docs commit after tagging.

### Launch readiness (F-26)

The platform can run the Centre's discovery-to-match journey for real users. These limitations,
assumptions and risks are known:

- **Sign-in:**
  - Real users get a code by email through Brevo, from a single verified Gmail sender. Messages
    may land in junk; a domain-verified sender is the upgrade path.
  - Test mode stays on so reviewers can use synthetic accounts. Only an authorised operator can
    read their codes, and real users' codes are never shown.
  - There is no university single sign-on (a non-requirement).
- **No real Mitacs connection** (a non-requirement). External data comes from a demonstration
  source that serves the supplied feeds. Its links point at `mitacs.example`.
- **External data needs a regular sync.** Syncs are started by staff; there is no schedule. Data
  is labelled "may be out of date" 8 days after the last success, measured in real time.
- **One deletion remains: the R4 evaluation reset** on `/sync.html`. It deletes the demonstration
  source's records so reviewers can rerun v1 and v2. It is staff only, test mode only, and needs a
  confirmation. Everything else is withdrawn, archived or marked, never deleted (F-12).
- **The simulated clock (6 November 2026)** keeps the R3 and Final results reproducible.
  Production would clear `CLOCK_DATE`.
- **Paging is cut on the server after filtering.** That is fine at the fixture's scale; moving it
  into SQL is the next step for much larger data.
- **The change history starts with this release.** Earlier changes have only their latest value.
  The history is evidence for disputes, not an audit interface (a non-requirement).
- **Deliberate changes to earlier behaviour:**
  - Undoing a match confirmation (relaxes R3-04).
  - Departed faculty's open work needs a new supervisor.
  - A showcase outcome needs its match to stay fully confirmed.
- **Accessibility was checked by axe-core** at 390px and with native, labelled controls. It was
  not tested with screen-reader users.
- **The partner form has no rate limit or CAPTCHA.**

## Operational note (Final Release only)

- **Deployment:**
  - One Render web service (free tier) runs `project2/backend` from branch `r1-development` and
    serves the API and pages from one origin.
  - The database is Supabase Postgres. Schema changes are numbered migrations applied in the
    Supabase SQL Editor before the code that needs them; 000 to 009 are applied.
  - Configuration is in Render environment variables: `DATABASE_URL`, `BREVO_API_KEY`,
    `EMAIL_FROM`, `SIGN_IN_TEST_MODE`, `OPERATOR_SECRET` and `CLOCK_DATE`. Secrets are never in
    the repository.
- **External dependencies:**
  - Brevo (sign-in email). If it fails, the person sees "Could not send the sign-in email. Try
    again shortly." and nothing else is affected.
  - The external feed (demonstration source). If it fails, the run is recorded as failed and the
    last data is kept.
  - Supabase. If it is down, `/api/health` returns 503 and pages show a plain error.
- **Diagnostics:**
  - `/operations.html` (staff) shows:
    - database and sync health and stale data;
    - failed notifications, with retry;
    - opportunities needing a supervisor or a deadline;
    - who changed what.
  - `/sync.html` has per-run details. `GET /api/health` reports whether the database is
    reachable.
  - Render's log stream records error messages only: never request bodies, codes, tokens or
    partner contact details.
  - Visitors get 401 and other users 403 on every diagnostic route.
- **Routine operation:**
  - Run a staff sync at least weekly.
  - Check Operations for failed notifications and orphaned opportunities.
  - Record departures and graduations on Faculty verification rather than revoking or deleting
    anyone.
