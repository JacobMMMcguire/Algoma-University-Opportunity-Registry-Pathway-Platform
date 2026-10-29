// The term lifecycle (R3-08 to R3-13, R3-19; R3_PLAN.md D1 to D4, D10). Every faculty project
// and industry opportunity has runs (`opportunity_runs`), one per term it is offered for; the
// current run is the highest run_number. A run stores only the states someone chooses (open,
// withdrawn, completed, archived). Matched and Expired are derived here, from the matches and
// the clock, so they can never disagree with the facts.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const TIME_ZONE = "America/Toronto";

// "Today" for every lifecycle decision, as YYYY-MM-DD: CLOCK_DATE when set (D3), otherwise the
// date at Algoma. config.clockDate is validated at startup, so it is safe to put into SQL.
function today(config) {
  return config.clockDate || new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date());
}

// What pages need to say "Dates evaluated as of ... (simulated)" when the clock is set.
function describeClock(config) {
  return { today: today(config), simulated: Boolean(config.clockDate), label: formatDate(today(config)) };
}

// "2026-10-20" -> "20 October 2026". Works on the string, so no time zone can shift the day.
function formatDate(isoDate) {
  if (!isoDate) return null;
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

// A YYYY-MM-DD date between 2000 and 2100 that exists on the calendar, or null.
function parseDate(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match || Number(match[1]) < 2000 || Number(match[1]) > 2100) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === text ? text : null;
}

// A run has a fully confirmed match when a match on it is not withdrawn and every invited
// student has confirmed it (R3-02). `runId` is the SQL expression for the run's id.
function fullyConfirmedMatchSql(runId) {
  return `EXISTS (SELECT 1 FROM matches m WHERE m.run_id = ${runId} AND m.withdrawn_at IS NULL
    AND EXISTS (SELECT 1 FROM match_students ms WHERE ms.match_id = m.id)
    AND NOT EXISTS (SELECT 1 FROM match_students ms WHERE ms.match_id = m.id AND ms.response <> 'confirmed'))`;
}

// The run's lifecycle state, for the run `r` and the stored state expression `stored`.
// A deadline passes at the end of its day (D4: the Centre deadline wins when set).
function lifecycleStateSql(config, stored = "r.state") {
  return `CASE WHEN ${stored} <> 'open' THEN ${stored}
    WHEN ${fullyConfirmedMatchSql("r.id")} THEN 'matched'
    WHEN coalesce(r.centre_deadline, r.deadline) < DATE '${today(config)}' THEN 'expired'
    ELSE 'open' END`;
}

const KINDS = {
  project: { table: "projects", runColumn: "project_id" },
  industry: { table: "partner_submissions", runColumn: "submission_id" },
};

// Joins the current run of each record `alias` (a project or a partner submission) as `run`,
// with its lifecycle state as run.lifecycle_state. A project closed by code from before runs
// existed (R1-15) still counts as withdrawn.
function currentRunJoin(config, kind, alias) {
  const stored = kind === "project" ? `CASE WHEN ${alias}.status = 'closed' THEN 'withdrawn' ELSE r.state END` : "r.state";
  return `JOIN LATERAL (
      SELECT r.id AS run_id, r.run_number, r.target_term AS run_term,
        to_char(r.deadline, 'YYYY-MM-DD') AS run_deadline,
        to_char(r.centre_deadline, 'YYYY-MM-DD') AS run_centre_deadline,
        r.state_changed_at AS run_state_changed_at,
        ${lifecycleStateSql(config, stored)} AS lifecycle_state
      FROM opportunity_runs r WHERE r.${KINDS[kind].runColumn} = ${alias}.id
      ORDER BY r.run_number DESC LIMIT 1
    ) run ON true`;
}

const LIFECYCLE_LABELS = {
  open: "Open",
  matched: "Matched",
  expired: "Expired",
  withdrawn: "Withdrawn",
  completed: "Completed",
  archived: "Archived",
};

// R3-19: a plain-language sentence a student can read to see whether an opportunity is still
// open and, if not, why it is no longer listed.
function lifecycleReason(state, { term, effectiveDeadline }) {
  const deadline = formatDate(effectiveDeadline);
  switch (state) {
    case "open":
      return deadline ? `Open. The deadline is ${deadline}.` : "Open. No deadline has been set.";
    case "matched":
      return "Matched: the faculty member and the students involved have confirmed they intend to work together, so it isn't taking more students.";
    case "expired":
      return `Expired: the deadline, ${deadline}, passed without a confirmed match. The faculty member may renew it for a later term.`;
    case "withdrawn":
      return "Withdrawn: it is no longer being offered.";
    case "completed":
      return term ? `Completed: the work for ${term} is finished.` : "Completed: the work is finished.";
    case "archived":
      return "Archived: kept for the record and no longer offered.";
    default:
      return "";
  }
}

// The lifecycle part of an API response, from a row with the `run` columns of currentRunJoin.
function describeLifecycle(row) {
  const state = row.lifecycle_state;
  const effectiveDeadline = row.run_centre_deadline || row.run_deadline || null;
  return {
    state,
    label: LIFECYCLE_LABELS[state],
    available: state === "open",
    reason: lifecycleReason(state, { term: row.run_term, effectiveDeadline }),
    runNumber: row.run_number,
    term: row.run_term,
    deadline: row.run_deadline,
    centreDeadline: row.run_centre_deadline,
    effectiveDeadline,
  };
}

// Adds a line to a run's history (run_changes). Every stored lifecycle change calls this.
function logRunChange(db, runId, change, detail, userId) {
  return db.query("INSERT INTO run_changes (run_id, change, detail, user_id) VALUES ($1, $2, $3, $4)", [
    runId,
    change,
    detail,
    userId,
  ]);
}

module.exports = {
  KINDS,
  logRunChange,
  LIFECYCLE_LABELS,
  currentRunJoin,
  describeClock,
  describeLifecycle,
  formatDate,
  fullyConfirmedMatchSql,
  lifecycleReason,
  lifecycleStateSql,
  parseDate,
  today,
};
