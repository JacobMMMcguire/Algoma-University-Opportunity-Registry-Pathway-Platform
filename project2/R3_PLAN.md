# Release 3 plan: matching, term lifecycle and outcomes

Status: **proposed, awaiting team approval.** Due 2026-11-11. Branch `r3-development`, merged into
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
- Render gets `CLOCK_DATE=2026-11-06` for evaluation.
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

**D7. Partner agreement (R3-07)** reuses R2's engagement state "Partner confirmed". It will be
shown as "Partner agreed in principle, recorded by <faculty>", and the page will make clear it
is a faculty member's record, not partner activity in the system.

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

1. Clock, runs and lifecycle states, the discovery filter, and the reasons shown on opportunity
   pages. Migration 005. (R3-08 to R3-13, R3-19)
2. Student profiles and matches. (R3-01 to R3-07, R3-22)
3. Outcomes, the showcase, and outcomes on faculty and student profiles. (R3-14 to R3-18,
   R3-20) A good self-contained piece to hand to a teammate once steps 1 and 2 are merged.
4. Fixture seed and expected-results tests, then the R1 and R2 regression pass. (R3-23)
5. Release notes, adapter, the `R3-submission` tag. (R3-24)

Every step enforces authorization on the server (R3-21) and has tests named after its
requirements.
