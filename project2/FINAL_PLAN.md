# Final Release plan: production reality and recovery

Status: **approved 2026-11-25** (decisions as written). Freezes Friday 27 November 2026, 11:59 p.m.
Toronto time. Branch `final-development` (from `r4-development`), merged into `r1-development`
(which Render deploys) only when ready to go live. Tag `FINAL-submission`.

Acceptance criteria: the Final fixtures' `expected_final_results.json` (F-01 to F-12), plus
every Release 1 to 4 requirement, which stays active. Open questions and accepted risks are in
[DECISIONS.md](DECISIONS.md).

The Final fixtures are in `project2/final_fixtures/` (received 2026-11-25). What they changed in
D3 and D4 is recorded in [DECISIONS.md](DECISIONS.md). The submission templates are in
`templates/`: `release_submission.md` follows `release_submission_template.md` (including the
Final-only "Operational note") and `evaluation_adapter.json` follows
`evaluation_adapter_template.json` with `release: "FINAL"`.

## Where we stand

| Area | Requirements | Today | Gap |
|---|---|---|---|
| Authorization | F-01 to F-03 | Ownership in SQL on every write; guards re-read the user each request; private shapes are separate (R1-16, R2-24, R3-21, R4) | No single sweep proves it across every write route |
| Consent withdrawal | F-04 | Visibility is worked out on every request (`PUBLIC_FACULTY_SQL`, `SHOWCASE_SQL`, `visibleSupervisorSql`), so withdrawal already applies at once | Tests only, across profile, projects, industry, showcase and external support |
| Untrusted content | F-05 | Text rendered with `textContent`; links checked; nothing reads content as instructions | One test per entry point (intake, external feed, profile, outcome, links) |
| Recovery | F-06, F-07 | Lifecycle reopen and renew keep history (`run_changes`); outcome confirmation can be taken back; engagement can be set again | A fully confirmed match can't be undone; no unpublish back to draft; engagement and publication keep no history |
| Attribution | F-08 | Lifecycle changes record who and when | Privilege grants, publication changes, engagement and match answers keep only the latest value |
| Stale people | F-09 to F-12 | Nothing deletes users; revoking faculty hides them and drops their outcomes from the showcase | No "left" or "graduated" status; departure would hide past work; no orphan handling or reassignment |
| External failure | F-13 | Done in R4 (failed runs touch nothing; malformed records are skipped) | Tests already exist; reference them |
| Notification failure | F-14 | Notifications are saved in the same statement as the submission | A notification failure fails the submission. Must be separated |
| Optional integrations | F-15, F-16 | Sign-in email is the only outside service besides the external feed; it already fails with a clear message | Check every failure path shows a readable message and a way forward |
| Scale | F-17 to F-19 | Every list returns every record | Paging, a scale import through ordinary code paths, paged staff queues |
| Accessibility, mobile, wording | F-20 to F-22 | axe-clean at 390px through R3 and R4 | A wording pass for internal terms; recheck after the new pages |
| Observability | F-23, F-24 | Sync health page (staff) | One operator page covering sync, notifications, stale data and lifecycle problems; check logs hold no secrets |
| Acceptance | F-25 to F-27 | Regression suite for R1 to R3, R4 suites | Extend to R4 and the Final; launch-readiness note; tag |

## Decisions (proposed)

**D1. One attribution log.** A new `audit_events` table: who (user id), what (`action`), which
record (`subject_type`, `subject_id`), when, and a small JSON `detail` with the before and after
values. Written in the same transaction as the change it records, for:
- privilege grants and revocations (F-02, F-08);
- publication changes: publish, unpublish, withdraw, consent given or withdrawn;
- R2 engagement changes, match answers and their reversal;
- reassignment and departure (D2, D3).

Lifecycle changes keep `run_changes`, which already does this. Staff read the log, filtered by
record, on the operator page (D8). It is evidence for disputes, not an audit UI (F-08, and an
explicit non-requirement). It never stores a sign-in code, session token or partner contact
detail (F-24).

**D2. Departure is a status, not a deletion or a revocation.**
- Staff mark a faculty member "Left Algoma" or a student "Graduated", with the date. Nothing is
  deleted and no row cascades (F-09, F-12).
- A departed faculty member stops being offered to students: out of the faculty directory and
  contact, not counted as a willing supervisor, and can't sign in to act as faculty (F-10).
- Their past work stays: confirmed outcomes they took part in remain in the showcase if their
  consent at departure allowed it, and their profile page says "No longer at Algoma
  University" with that work and no contact route (F-09).
- "No longer accepting inquiries" is the existing R1 `not_accepting` preference; such faculty
  stay listed but are never shown as someone to approach (F-10).

  Today revocation also removes past outcomes from the showcase. Revocation stays for
  "shouldn't have been faculty"; departure is the normal way to leave.

**D3. Orphaned opportunities get a derived state and a staff fix.**
- An open opportunity whose every managing faculty member has departed is shown as "Needs a new
  supervisor", worked out like Expired (never stored). It leaves discovery, and its link explains
  why in plain words (F-11).
- Staff reassign it at the lifecycle page: a faculty project gets a new owner; an industry
  opportunity gets a new willing supervisor added on their behalf, with their agreement noted.
  Both are recorded in `audit_events` and keep the record's identity (F-07).

**D4. Recovery actions (F-06), each recorded (F-07, F-08).**

| Mistake | Who fixes it | How |
|---|---|---|
| Wrong lifecycle state | Owner, supervisor or staff | Existing reopen, withdraw, archive (R3-13) |
| Accidental expiry | Owner, supervisor or staff | Existing reopen with a later deadline, or a staff Centre deadline |
| Mistaken engagement | Any verified faculty member | Set the right state again; the earlier value is kept in the log |
| Mistaken match confirmation | The student (their own answer) or the managing faculty member | "Undo confirmation": the student's answer returns to pending and the match to partly confirmed. Only before any outcome is recorded on it |
| Publication-visibility error | Owner or staff | Unpublish a project back to draft; staff hide an industry opportunity; faculty change their public-display choice; outcome confirmation taken back (exists) |

R3-04 said a fully confirmed match can't be declined or withdrawn. "Undo confirmation" is the
recovery path F-06 asks for, so this deliberately changes R3-04 for mistakes.

**D5. Notifications are saved after the submission, separately (F-14).** The submission is
saved first. Notifications are then created in their own step; if that fails, the submission
still succeeds, the failure is recorded for operators, and staff can retry it. Browsing
`/submissions.html` always shows the submission either way (R2-19). Staff can turn on a
simulated failure in test mode to demonstrate it.

**D6. Paged discovery (F-18) and paged staff queues (F-19).**
- Every list endpoint takes `limit` (default 20, maximum 50) and returns a `next` cursor. Filter
  counts are computed with SQL `GROUP BY`, not by loading every record.
- `/projects.html` currently merges three lists in the browser. A new `GET /api/discovery`
  returns one page of faculty projects, industry and external opportunities together, sorted
  by title, with the same filters. The three old endpoints stay (paged) for the adapters.
- The staff lists (faculty verification, partner submissions, notifications, sync runs, the
  operator page) are paged the same way, with search where a queue can grow.

**D7. The scale fixture goes through the app's own routes (F-17).** An import script signs in
as staff and each fixture account (test mode), then creates profiles, projects and submissions
through the same HTTP routes a person uses. No SQL shortcut. Evidence: record counts and the
first discovery load's size with 20 records and with the full set (F-18).

**D8. One operator page (F-23, F-24).** `/operations.html`, staff only:
- external sync health (summary, with a link to `/sync.html`) and how many records are stale;
- notification delivery: failures and their retry;
- lifecycle problems: orphaned opportunities (D3), open runs with no deadline, failed
  transitions;
- recent attribution events (D1), filterable by record.

Errors are logged with their message only, never a request body, code, token or contact detail.

**D9. Wording (F-22).** One pass over every page for internal names: state codes, role codes,
table names and sync terms such as "run", "classification" or "not_seen". Student and faculty
pages use plain words; the staff sync page may keep "sync", explained once.

## Build order

1. Attribution log, recovery actions and notification containment (D1, D4, D5). Migration 009.
   (F-06 to F-08, F-14) **Done 2026-11-25** (`test/notification-failure.test.js`,
   `test/recovery-attribution.test.js`). Staff hiding an industry opportunity is the existing
   lifecycle Withdraw (R3-13), so no new route was needed.
2. Departure, orphans and reassignment, checked against the fixture (D2, D3). (F-09 to F-12)
   **Done 2026-11-25** (`test/final-regression.test.js`: every key of
   `expected_final_results.json`, all five recovery cases fixed through the product, reseed).
3. Authorization and content sweep: one test file walking every write and private read as the
   wrong user. (F-01 to F-05, F-13, F-15, F-16)
4. Paging, the discovery endpoint and the scale import (D6, D7). (F-17 to F-19)
5. Operator page, wording and accessibility pass at 390px (D8, D9). (F-20 to F-24)
6. Full regression, launch-readiness note, release files, deploy, tag `FINAL-submission`.
   (F-25 to F-27)

Every step keeps `npm test` green and adds tests named after its requirements.
