Chosen challenge: R4-07 — External content is untrusted

# Release Submission

Release: R4
Team: Jacob McGuire, Sineru Mahamillage, Paris Lad
Project Option: Project 2 (Opportunity Registry and Pathway Platform)
Deployment: https://algoma-opportunity-registry-r1-backend.onrender.com
Repository: https://github.com/JacobMMMcguire/Algoma-University-Opportunity-Registry-Pathway-Platform
Release tag: R4-submission
Commit: d91f4c015631504f95d92d58ab8c847d8162af87
Adapter: project2/evaluation_adapter.json (template format: one check per R4 requirement, plus the
sync trigger, sync health, external opportunity routes and the faculty interest action; the R1 to
R3 route map is kept under `earlier_releases`)

Known issues:
- **No real Mitacs connection** (an R4 non-requirement). The "provider" is a demonstration source
  that returns the supplied feed v1 or v2, or simulates a failure, as the operator chooses. Its
  `mitacs.example` links are synthetic and don't open a real page.
- **Syncs are started by staff** at `/sync.html`. There is no automatic schedule.
- **Freshness uses the real time**, not the simulated R3 clock. Data is labelled "may be out of
  date" when the latest sync attempt failed or the last success is more than 8 days old.
- **The evaluation reset deletes data.** "Reset this demonstration source" on `/sync.html` (staff,
  test mode only) removes that source's copies, history and the local notes on them, so a reviewer
  can run v1 then v2 from the start. A normal sync never deletes anything.
- **Records that leave the feed leave browsing.** A "No longer listed by Mitacs" record is not in
  the Projects list, but its page still opens with its last-known details and the notice.
- **Imported links must be on the provider's own site** (`mitacs.example` or `mitacs.ca`).
  Otherwise the record is reported as malformed and skipped. Imported areas that aren't on our
  fixed list are dropped (none in the supplied feeds).
- **A student's progress on an external opportunity is their own private note.** It is not an
  application, and nobody else sees it.
- Carried from R3: test mode is on and limited to authorised operators; the partner form has no
  rate limit or CAPTCHA; sign-in emails may land in junk; the free Render instance can take about a
  minute to wake.

Test notes: One Render web service serves the pages and the API. To sign in as a test account,
enter its address on the home page and press "Send sign-in code". Then open `/operator.html`,
enter the operator access code (shared privately through the course channel, never in this
repository), and copy the code. Each address can request 3 codes per 10 minutes. Releases 1 to 3
are preserved at tags `R1-submission`, `R2-submission` and `R3-submission`.

## Test accounts

All are synthetic, created by the fixture seed, and have no inbox.

| Account | Role | Use it to check |
|---|---|---|
| *(none: signed out)* | Visitor | R4-02 to R4-07, R4-10, R4-13, R4-25 at `/projects.html?type=external` and each `/external.html?id=` |
| `fixture-test-staff@algomau.ca` | Staff (operator) | R4-08 to R4-14 at `/sync.html` ("Staff: external sync health" in the menu); readiness guidance |
| `fixture-f-alex@algomau.ca` | Verified faculty, public profile | R4-17 to R4-19: "I'm willing to support students pursuing this"; readiness guidance; "Your external opportunities" |
| `fixture-f-mei@algomau.ca` | Verified faculty, signed-in-only profile | R4-18: their support is shown to signed-in users only |
| `fixture-test-student@algomau.ca` | Student, no outcomes | R4-21 to R4-23: guidance without meeting it, and still able to apply; R4-15: your own record |
| `fixture-s02@algomau.ca` | Student with confirmed R3 outcomes (R-501, R-503) | R4-24: readiness lists those outcomes |
| `fixture-s01@algomau.ca` | Student whose only outcome (R-502) is unconfirmed | R4-24: not counted until F-ALEX confirms R-502 at `/outcomes.html` |

## Release-specific evidence

- **Deployed assessed URL:** https://algoma-opportunity-registry-r1-backend.onrender.com
  (Render deploys branch `r1-development`; `r4-development` points at the same commit).
- **Immutable release identifier:** tag `R4-submission`, commit `d91f4c015631504f95d92d58ab8c847d8162af87`.
- **Checked on the live deployment (2026-11-20, after deploying):**
  - Headless Chrome at 390px with axe-core, fresh sessions as visitor, staff, faculty
    (F-ALEX), a student and S01. No violations, overflow, page errors or dialogs.
  - v2 after v1 classified exactly as `expected_sync_results.json`. MX-1005's script showed as
    text, under the Mitacs badge.
  - A simulated failure labelled the data "may be out of date". MX-1003 opened as "No longer
    listed by Mitacs".
  - R1 to R3 public endpoints unchanged: 5 public projects, R-501 in Completed work, the clock
    at 6 November.
  - Matches, partner submissions, lifecycle and sync health return 401 to visitors.
  - The demonstration source was then reset and synced with v1, so reviewers start from
    "last week" (MX-1001 to MX-1004 listed).
- **Chosen Challenge: R4-07 (external content is untrusted).** MX-1005's description is shown
  exactly as text, including the literal `<script>alert('x')</script>`. No alert runs. It stays
  labelled "Owned by Mitacs, not Algoma University". Its link still points at
  `https://mitacs.example/opportunities/MX-1005`. Nobody's role, match, outcome or readiness changes.
  - Imported text has control characters removed and is rendered only with `textContent`.
  - The owner label comes from our source registry, never from the feed.
  - Links must be http(s) on the provider's own site.
  - No route lets imported text change a local record.
  - R4-20 was not chosen and isn't assessed.
- **How a sync run is triggered, and v1 then v2:**
  1. Sign in as `fixture-test-staff@algomau.ca` and open `/sync.html`.
  2. Optional, to start clean: tick the confirmation under "Evaluation only: reset this
     demonstration source" and press **Reset source**.
  3. Choose **Feed v1 (last week)** and press **Run sync now**. Expect four records, all New.
  4. Optional, for R4-15 and R4-17: record local data on MX-1002 now.
     - As F-ALEX, offer support with a note and save readiness guidance.
     - As a student, record "I applied through the provider".
  5. Choose **Feed v2 (this week)** and **Run sync now**. Run details show the expected results:
     - MX-1005 New; MX-1001 and MX-1004 Unchanged.
     - MX-1002 Changed (title, description, areas, closes).
     - MX-1003 Not seen.
     - One malformed record reported and skipped: empty external_id, empty title, empty
       authoritative_url, and an unparseable closes date.
  6. Run v2 again: no duplicates. Four records are Unchanged, and MX-1003 is "Still not seen".

  API: `POST /api/external-sync/run` with `{ "sourceId": "mitacs-demo", "feed": "v1" | "v2" }`
  (staff).
- **How to simulate a failed sync:** on `/sync.html` choose **Simulated failure: source
  unreachable** or **Simulated failure: response cannot be parsed** and press **Run sync now**.
  - The run is recorded as failed with its reason, and nothing changes.
  - Every opportunity keeps its content and state. Nothing is marked not seen.
  - Students and visitors see "This information may be out of date", with the last successful
    update time.
  - A later successful run clears the label.
- **Where sync health is observed:** `/sync.html` (`GET /api/external-sync/health`, staff only).
  It shows:
  - whether syncing is healthy;
  - the last successful run, and the last failed run with its reason;
  - counts by classification, and recent runs;
  - each run's per-record classification and malformed-record report.

  Visitors get 401, and students and faculty get 403. Ordinary users see freshness only in plain
  language on each opportunity.
- **What students see (the four usability questions):**
  - *Whose is it?* A green "External · Owned by Mitacs, not Algoma University" badge on every card
    and page.
  - *Where do I apply?* **View / apply through Mitacs**, which opens the provider's page.
    "Applications are made on the Mitacs site, not here."
  - *Is it current?* "Last successful update from Mitacs", plus the out-of-date and "No longer
    listed by Mitacs" notices.
  - *Does anyone here support it?* "Algoma faculty support", which lists the faculty willing to
    help. It is labelled local support, not provider endorsement.
- **Local versus source data (R4-15 to R4-17):**
  - A sync writes only the provider's fields.
  - These are separate local records keyed by our own id, and survive every sync, including
    MX-1002's change in v2:
    - faculty support and notes;
    - a student's own record and its history;
    - readiness guidance.
  - Readiness evidence is the student's confirmed R3 outcomes, which a sync never touches.
  - No route edits provider fields.
  - Every source change is kept under "Changes from the source", with the previous title and
    closing date. A faculty member who offered support is told "Mitacs changed this after you
    offered support", on the page and at "Your external opportunities".
- **Readiness (R4-21 to R4-24):** faculty or staff can set guidance on an opportunity, such as
  suggesting a confirmed project outcome first. It is labelled "a suggestion, not a requirement",
  says exactly what it is based on, never scores or ranks, and never hides the page or the apply
  link.
- **External timing (R4-25):** external opportunities show the provider's closing date and never
  become Expired from Algoma deadlines or the simulated clock. A passed provider date is labelled
  "Only Mitacs can say whether it is still open."
- **Fixture loading:**
  - Migration `008_external_sources.sql` adds the R4 tables.
  - The R1 to R3 fixtures load with `npm run seed:fixture`, unchanged.
  - The R4 feeds (`project2/r4_fixtures/`) are read by the demonstration provider, not imported.
  - `expected_sync_results.json` is used only as acceptance criteria, in
    `test/external-sync.test.js`.
- **Automated tests:** 303 `node:test` tests (`npm test` in `project2/backend`).
  - `external-sync.test.js` checks every classification in `expected_sync_results.json`, the
    malformed record, the repeat run, both failure modes, health, local-data survival, the change
    record, MX-1005, reappearance and withdrawal.
  - `external-opportunities.test.js` covers R4-01 to R4-07, R4-16, R4-18, R4-19 and R4-21 to
    R4-26 (authorization for every role).
  - All 270 R1 to R3 tests still pass unchanged (R4-27).
- **Browser pass (2026-11-20):** the new and changed pages, checked in headless Chrome at 390px
  wide with axe-core (WCAG 2.1 A/AA and best practice). Roles: visitor, two students, faculty and
  staff, including running v1, v2 and a failure from the page. No horizontal overflow, no
  violations, no page errors. No script dialog fired on MX-1005.
