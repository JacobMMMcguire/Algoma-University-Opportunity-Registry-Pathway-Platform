# Decisions and open questions

Running notes for the Final Release (frozen Friday 27 November 2026, 11:59 p.m. Toronto time).
Design decisions are in [FINAL_PLAN.md](FINAL_PLAN.md); this file holds what we noticed, what we
chose to accept, and what we want to confirm with the instructor.

## To confirm with the instructor

1. **Which clock date to evaluate against.** Live runs with `CLOCK_DATE=2026-11-06`, the R3
   fixture's evaluation date. The Final fixtures (final-v1) name no date of their own, so we keep
   6 November, and the Final seed sets O-303's deadline relative to it (see below). Please confirm
   that is what reviewers will expect.
2. **The evaluation reset on `/sync.html`.** It deletes the demonstration source's copies and the
   local data on them, so a reviewer can rerun feed v1 then v2. F-12 asks for historical integrity
   over deletion. Is an evaluation-only reset, limited to staff in test mode, acceptable in the
   launch candidate, or should we remove it?
3. **Test mode in the launch candidate.** Reviewers sign in to synthetic accounts through the
   operator console, which needs a signed-in staff session or the private operator access code. Is
   that acceptable for "Reviewer test access" in the Final, given F-24 (no verification tokens in
   diagnostics)?
4. **Submission templates.** The Final asks for `evaluation_adapter_template.json` and the
   release-submission template from the Team Project Bootcamp section. We need the current copies.

## Carried from the R4 review (2026-11-24)

- **Live external data will show as out of date from about 28 November.** Freshness uses the
  real time, not `CLOCK_DATE`, and data counts as stale 8 days after the last successful sync.
  The last live sync was on 20 November. Before evaluation, staff must run a fresh sync on
  `/sync.html` (feed v1, or v1 then v2 as the release notes describe), or the external
  opportunities will carry "This information may be out of date". This is the correct behaviour
  (R4-13); it only needs the sync to be fresh when reviewers look.
- **The evaluation reset deletes live data** (see question 2). It is staff only, works only in
  test mode, needs an explicit confirmation, and is documented as a known issue.
- **Readiness guidance is one shared note per external opportunity.** If two faculty members set
  it, the later one replaces the earlier one. Accepted as a design choice; it is labelled as a
  suggestion and never gates anything.

## Found while planning the Final (2026-11-24)

- **Fixed (F-14, 2026-11-24). A failed notification currently fails the partner submission.** The submission and its
  notifications are saved in one statement, so they succeed or fail together. F-14 needs the
  opposite: the submission must be saved even when notifying fails.
- **Discovery and staff lists return every record.** No list endpoint pages its results, which
  F-18 and F-19 rule out at scale.
- **Fixed (F-08, 2026-11-25). Several changes overwrite instead of keeping history.** Faculty verification, R2 engagement
  state, project publication and the public-display choice keep only their latest value, so
  "who changed it and when" (F-08) can't be answered for earlier changes.

## Choices the Final fixtures required (2026-11-25)

The fixtures are in `project2/final_fixtures/` (renamed from the course zip's "Final Release
Fixtures" folder; the files are unchanged).

- **The seed puts each recovery case in its wrong state.** `recovery_cases.json` describes records
  that "reached their current state by mistake", so `npm run seed:fixture` now loads R1 to R3 and
  then the Final states, and reviewers fix each case through the product. A reseed puts them back.
- **RC-01 (O-303 accidentally expired).** In R3, O-303 is open (deadline 15 December). The fixture
  gives no wrong deadline, so the Final seed sets its faculty deadline to the day before the
  evaluation date (5 November), which makes it Expired. The fix is the one the case describes:
  staff set a later Centre deadline on `/lifecycle.html`.
- **RC-03 (undo M-404's confirmation) needed a wider undo than we planned.** M-404 already has
  outcomes (R-501, R-503) and its opportunity, O-306, is completed. So undoing a confirmation is
  allowed whenever the match isn't withdrawn. The outcomes are kept, but an outcome is shown
  publicly only while its match is fully confirmed, so they leave the showcase until everyone
  confirms again. The opportunity keeps its stored state.
- **"Needs a new supervisor" includes expired opportunities.** The fixture calls O-302 orphaned
  although it is expired. The derived state applies when everyone managing the run has left, and
  the run isn't withdrawn, completed, archived or matched. It takes precedence over Expired. F-ALEX's
  other opportunity, O-301, is matched (a confirmed team), so it isn't an orphan, as the fixture
  expects.
- **The Final layer changes some R3 results on purpose**, as R3 did to R2: O-302 needs a new
  supervisor instead of being expired, O-303 is expired until RC-01 is fixed, F-PRIYA no longer
  offers contact, F-ALEX leaves the faculty directory, and S02 is an alumnus.
  `test/regression.test.js` checks R1 to R3 as seeded before the Final layer, and
  `test/final-regression.test.js` checks the Final expected results.
- **Someone who has left can still sign in.** A departed faculty member sees their own records but
  no longer acts as faculty. A graduated student can still answer their matches but can't be
  proposed a new one. Staff record either on `/admin.html`, and can take it back.
