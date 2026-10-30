# Release 3 plan: matching, term lifecycle and outcomes

Status: **approved 2026-10-29** (D7 revised to a separate table). Due 2026-11-11. Branch `r3-development`, merged into
`r1-development` (which Render deploys) only when ready to go live.

Acceptance criteria: `r3_fixtures/expected_lifecycle_results.json`, evaluated as of the
fixture's `evaluation_date`, 2026-11-06.

## Decisions

**D1. One lifecycle for both kinds of opportunity.**
- A new `opportunity_runs` table holds a run's term, deadline, Centre deadline and lifecycle
  state, for a faculty project or an industry opportunity.
- Each opportunity keeps its existing id. Renewal (R3-12) adds a new run to the same
  opportunity, so earlier runs keep their own matches and outcomes. Matches and outcomes attach
  to a run.

**D2. Only some states are stored.**
- Stored, because someone sets them: `open`, `withdrawn`, `completed`, `archived`.
- Worked out when a page loads, from the clock and the matches:
  - **Matched:** open, with a fully confirmed match.
  - **Expired:** open, with no fully confirmed match and the effective deadline before the
    clock date.

  Nothing is ever deleted. Undoing a mistake (R3-13) means setting the run back to `open` (by
  its owner or staff), with a later deadline if needed.
- The R1 project status `closed` is migrated to `withdrawn`. Drafts stay drafts until published.
  The R2 "awaiting supervisor" gate still applies before any industry run is discoverable.

**D3. An adjustable clock.**
- A `CLOCK_DATE` setting (YYYY-MM-DD) means "today" for lifecycle decisions. Unset means the
  real date.
- Render gets `CLOCK_DATE=2026-11-06` for evaluation. The date may still change: the team has
  asked the instructor whether it should be 2026-11-11 (the R3 due date) instead. Changing it
  is a Render setting only, with no code change. Tests read the fixture's `evaluation_date`
  rather than hard-coding a date. No fixture deadline falls between 6 and 11 November, so
  either date gives the same expected results.
- Pages show "Dates evaluated as of 6 November 2026 (simulated)" whenever it's set. This
  gets recorded in the release notes.

**D4. Deadlines.**
- Faculty set a run's deadline.
- Staff can set a Centre deadline, which overrides it (R3-08). The effective deadline is the
  Centre deadline if there is one, otherwise the faculty deadline.

**D5. Students are identified accounts with profiles.**
- Faculty propose a match by naming students' `@algomau.ca` addresses. A student who hasn't
  signed in yet sees the proposal on first sign-in.
- New `student_profiles` table: display name plus a public-display choice, mirroring faculty
  consent (R1-05). It's needed for R3-17, R3-18 and R3-20.

**D6. Matches.**
- A `matches` table (`run_id`, `proposed_by`, `withdrawn_at`) and a `match_students` table (each
  student's response: pending, confirmed or declined).
- The match state is worked out from these:

  | State | When |
  |---|---|
  | Withdrawn | the faculty member withdrew it |
  | Declined | any student declined |
  | Confirmed | every student confirmed |
  | Partly confirmed | some, but not all, confirmed |
  | Proposed | nobody has responded yet |

- Only the invited students and faculty on that opportunity can see a match (R3-05, R3-22).

**D7. Partner agreement (R3-07)** gets its own table, `partner_agreements`, with records per run.
- Each record says who recorded it and when. Records are never overwritten: recording again, or
  retracting, adds a row, so the history is kept. A renewed run starts with no agreement, and
  the earlier term's agreement stays with the earlier run.
- It is shown as "Partner agreed in principle, recorded by <faculty> on <date>". The page makes
  clear this is a faculty member's statement, not partner activity in the system.
- R2's engagement option "Partner confirmed" is relabelled "Partner agreed in principle".
  Only the label changes; the stored value and R2 behaviour stay the same.

**D8. Outcomes and showcase.**
- An `outcomes` table (`run_id`, summary, completion date, links, confirmation) and an
  `outcome_participants` table (faculty and students, plus each student's "show on my profile"
  choice).
- An outcome is publicly showcased only when:
  1. a participating verified faculty member has confirmed it (R3-15); and
  2. every participating faculty member is publicly visible (R3-16, which is why R-503 stays
     private).
- Students are named publicly only if their own profile is public. The R3-18 choice only
  affects the student's own profile.
- Partner contact details never appear in an outcome.

**D9. Loading the fixture.**
- Industry O-301, O-302, O-304 and O-306 are matched to R2 submissions S-201, S-202, S-205 and
  S-206 by title, with their owner recorded as a willing supervisor.
- Faculty O-303, O-305 and O-307 become new faculty projects.
- Terms are translated: `2026F` becomes Fall 2026, `2027W` Winter 2027, and `2026S` Summer 2026.
  That last one is an assumption: the deadline is May 30 and the work completed in August.
- Students S01 to S17 become accounts `fixture-s01@algomau.ca` and so on, each with a student
  profile.
- Tests check every entry in `expected_lifecycle_results.json`.

**D10. Discovery (R3-19).**
- Only open runs that aren't expired or matched appear in student discovery.
- Opening a removed opportunity by its link shows why it's gone, e.g. "Expired: deadline 20
  October 2026 passed without a confirmed match", rather than "not found". The record's
  visibility rules still apply.

## Build order

1. **Done 2026-10-29.** Clock, runs and lifecycle states, the discovery filter, and the reasons shown on opportunity
   pages. Migration 005. (R3-08 to R3-13, R3-19)
2. **Done 2026-10-30.** Student profiles and matches. Migration 006. (R3-01 to R3-07, R3-22)
3. **Done 2026-10-30.** Outcomes, the showcase, and outcomes on faculty and student profiles.
   Migration 007. (R3-14 to R3-18, R3-20)
4. **Done 2026-10-30.** Fixture seed and expected-results tests, then the R1 and R2 regression
   pass. (R3-23)
5. Release notes, adapter, the `R3-submission` tag. (R3-24)

Every step enforces authorization on the server (R3-21) and has tests named after its
requirements.

## Step 1 design notes

- **Runs.** Every faculty project and partner submission always has at least one run. Migration
  005 creates run 1 for existing records, and database triggers create it for new ones, so the
  old code still running during deployment can't leave a record without a run. The current
  run is the one with the highest `run_number`.
- **Who changes a run.** The project's owner for a faculty project; any willing supervisor for
  an industry opportunity; staff for either. The Centre deadline is staff only.
- **The term** lives on the run. `projects.target_term` is kept equal to the current run's term,
  so R1 filters and older code keep working.
- **Legacy `closed`.** Migration 005 gives closed projects a withdrawn run but leaves
  `projects.status` as `closed`, so the R1 code still live during deployment keeps hiding them.
  The new code treats `projects.status` as publication only (draft or not) and reads
  withdrawal from the run. Close still answers `status: "closed"` for R1 compatibility.
- **"Today"** is `CLOCK_DATE` if set, otherwise the date in Toronto. A deadline passes at the
  end of its day: an opportunity with deadline 20 October is still open on 20 October.
- **Industry runs** start with no term or deadline, so they never expire until a supervisor
  sets a deadline.

## Step 2 design notes

- **Who proposes and withdraws.** A verified faculty member who manages the opportunity as
  faculty: the project's owner, or any willing supervisor of an industry opportunity. Staff
  manage the lifecycle but don't take part in matches and can't see them (D6).
- **Only open opportunities take proposals.** Not drafts, and not expired, matched, withdrawn,
  completed or archived ones. A student can be on only one live match per run.
- **Students** are named by `@algomau.ca` email, up to 10 per match, and can't be the proposer,
  a verified faculty account or a staff account.
- **Confirming needs the run to be current and open (or matched).** A late confirmation would
  undo an expiry that has already happened, so it is refused with the reason. Reopening the
  opportunity with a new deadline allows it again. Declining is never blocked.
- **Declining after confirming** is allowed until everyone has confirmed (R3-04 says "before
  confirmation"). After that a match can't be declined or withdrawn; the opportunity is
  completed instead.
- **Partner agreement** is recorded on the current run through
  `POST /api/matches/partner-agreements/:id`, by supervisors only. The students on a match on
  that run see it.
- **Student profiles** (migration 006) hold a display name and a public-display choice (NULL
  means not chosen, which counts as not public). Step 3 uses the choice for the showcase.

## Step 3 design notes

- **An outcome belongs to a fully confirmed match** (and so to that match's run). One match can
  have several outcomes: R-501 and R-503 are both on M-404.
- **Who records one.** A student on the match, or a verified faculty member who manages the
  opportunity. The recorder is always a participant. Students named must be from the match.
  Faculty are chosen from the opportunity's faculty, or named by email (any verified faculty
  member with a profile, as F-MEI is on R-503). At least one of each, at most 5 faculty.
- **Participants** are kept by email in `outcome_participants`, like `match_students`. Any
  participant can edit the summary, date and links. Editing clears the confirmation, so what is
  public is always what a faculty member confirmed. Nothing is deleted.
- **Confirming.** A faculty participant who is currently verified confirms it, or takes the
  confirmation back. A new outcome is always unconfirmed, whatever the request says.
- **Showcased** when all of these hold, worked out on every request (`SHOWCASE_SQL`):
  1. a faculty participant who is still verified confirmed it;
  2. every faculty participant is verified, allows public display and has a profile;
  3. for a faculty project, its owner allows public display.

  The third rule stops an outcome revealing a non-public faculty member's project when they
  aren't named on it. The showcase is the same for visitors and signed-in users; only the
  students named differ.
- **Students named.** Visitors see a student's name only if the student has a profile and chose
  public display; signed-in users see every student with a profile (as for faculty, R1-10).
  Anyone not named is counted ("1 student who hasn't chosen public display"). No emails appear.
- **Profiles (R3-17, R3-18).** A faculty profile lists the showcased outcomes they're on. A
  student profile (`student.html`, visible to signed-in users, and to visitors if public) lists
  those the student hasn't hidden. Hiding affects only the student's own profile.
- **Industry outcomes** show the organisation's name, as discovery does, and never its contact
  details.

## Step 4 notes

- **One seed.** `buildAllFixtureSql()` is what `npm run seed:fixture`, `dev:local` and
  `test/regression.test.js` all load, so the tests check exactly what evaluators get.
- **Reseeding restores the expected results.** On the R3 fixture opportunities, a reseed
  deletes matches, partner agreements and run history added since the last seed (outcomes go
  with their matches). Without this, an evaluator's practice match on O-303 would leave it
  Matched after a reseed. Everything else is left alone, as in R1 and R2.
- **Every expected result has a check.** The regression test has one check per key of
  `expected_lifecycle_results.json` and fails if the file has a key without one.
- **R1 and R2 still hold** with R3 loaded and the clock set. The one intended change: the four
  R2 submissions reused by the R3 fixture leave student discovery, because R3 makes them
  matched, expired or completed.
- **Browser pass.** Every page, as every kind of user, at 390px with axe-core. Fixed: repeated
  form names on `lifecycle.html` and `outcomes.html`, and no heading on `submissions.html` when
  access is refused.
