# Decisions and open questions

Running notes for the Final Release (frozen Friday 27 November 2026, 11:59 p.m. Toronto time).
Design decisions are in [FINAL_PLAN.md](FINAL_PLAN.md); this file holds what we noticed, what we
chose to accept, and what we want to confirm with the instructor.

## To confirm with the instructor

1. **Which clock date to evaluate against.** Live runs with `CLOCK_DATE=2026-11-06`, the R3
   fixture's evaluation date, so the R3 expected results hold. If the Final fixture names its own
   evaluation date, can we switch to it, or should R3's results still hold as of 6 November?
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

- **A failed notification currently fails the partner submission.** The submission and its
  notifications are saved in one statement, so they succeed or fail together. F-14 needs the
  opposite: the submission must be saved even when notifying fails.
- **Discovery and staff lists return every record.** No list endpoint pages its results, which
  F-18 and F-19 rule out at scale.
- **Several changes overwrite instead of keeping history.** Faculty verification, R2 engagement
  state, project publication and the public-display choice keep only their latest value, so
  "who changed it and when" (F-08) can't be answered for earlier changes.
