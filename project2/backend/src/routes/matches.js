const express = require("express");
const { KINDS, describeLifecycle, formatDate, lifecycleStateSql } = require("../lifecycle");
const { parseId } = require("../validation");
const { managedSql } = require("./lifecycle");

// R3-01 to R3-07, R3-22 (R3_PLAN.md D5 to D7). A verified faculty member who manages an open
// opportunity proposes a match to one or more students, named by university email. Each student
// confirms or declines for themselves; the match is fully confirmed only when every one has
// confirmed (R3-02), and that is what makes the run Matched (src/lifecycle.js). Nobody can
// answer for anyone else (R3-03). A match is seen only by its students and by the faculty who
// manage the opportunity: never publicly, and not by staff (R3-22).

const LIMITS = { students: 10, note: 300 };

// R3-06: shown with every match, so nobody mistakes it for registration or approval.
const MATCH_NOTICE =
  "A match records that the faculty member and the students named intend to work together on this opportunity. " +
  "It is not course registration, and it doesn't mean eligibility, academic credit or any official approval has been checked or granted.";

const MATCH_LABELS = {
  proposed: "Proposed",
  partly_confirmed: "Partly confirmed",
  confirmed: "Confirmed",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

const RESPONSE_LABELS = { pending: "Not answered yet", confirmed: "Confirmed", declined: "Declined" };

// D6: withdrawn, then declined, then confirmed, partly confirmed, proposed.
function matchState(match, students) {
  if (match.withdrawn_at) return "withdrawn";
  if (students.some((s) => s.response === "declined")) return "declined";
  if (students.length > 0 && students.every((s) => s.response === "confirmed")) return "confirmed";
  if (students.some((s) => s.response === "confirmed")) return "partly_confirmed";
  return "proposed";
}

function matchSummary(state, students) {
  const confirmed = students.filter((s) => s.response === "confirmed").length;
  switch (state) {
    case "proposed":
      return students.length === 1
        ? "Waiting for the student to confirm."
        : `Waiting for the students to confirm. None of the ${students.length} has confirmed yet.`;
    case "partly_confirmed":
      return `${confirmed} of ${students.length} students have confirmed. It is confirmed only when all of them have.`;
    case "confirmed":
      return students.length === 1 ? "The student has confirmed." : `All ${students.length} students have confirmed.`;
    case "declined":
      return "A student declined, so this match won't go ahead. The faculty member can propose a new one.";
    case "withdrawn":
      return "The faculty member withdrew this proposal before everyone had confirmed.";
    default:
      return "";
  }
}

// A timestamp as a date at Algoma, e.g. "29 October 2026".
function dateAtAlgoma(timestamp) {
  if (!timestamp) return null;
  return formatDate(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date(timestamp)));
}

// R3-07 (D7): the latest record for a run is its current answer; earlier ones are kept.
function toPartnerAgreement(row) {
  if (!row) return null;
  const by = row.recorded_by_name || "a faculty member";
  const on = dateAtAlgoma(row.created_at);
  return {
    agreed: row.agreed,
    note: row.note,
    recordedBy: row.recorded_by_name,
    recordedAt: row.created_at,
    text: row.agreed
      ? `Partner agreed in principle, recorded by ${by} on ${on}.`
      : `No partner agreement: an earlier record was retracted by ${by} on ${on}.`,
    explanation: "This is the faculty member's own record of what the partner told them. The partner organisation doesn't use this system.",
  };
}

const opportunityLink = (kind, id) => (kind === "industry" ? `opportunity.html?id=${id}` : `projects.html?id=${id}`);

// The SQL condition for "the viewer manages the run r": the owner of its project, or a willing
// supervisor of its industry opportunity. `$1` is the viewer's id.
const MANAGES_RUN_SQL = `(p.faculty_user_id = $1 OR EXISTS (SELECT 1 FROM opportunity_supervisors os
  WHERE os.submission_id = r.submission_id AND os.faculty_user_id = $1))`;

// R3-22: who may see a match. `$1` is the viewer's id and `$2` their email, both from the session.
function participantSql(viewer) {
  const invited = "EXISTS (SELECT 1 FROM match_students ms WHERE ms.match_id = m.id AND ms.student_email = $2)";
  return viewer.is_verified_faculty ? `(${invited} OR ${MANAGES_RUN_SQL})` : invited;
}

function createMatchesRouter({ db, config, auth }) {
  const router = express.Router();

  // Matches with their run, opportunity and lifecycle, for the condition `where` on `m`, `r`,
  // `p` and `ps`. The run's lifecycle columns have the names describeLifecycle expects.
  async function queryMatches(where, params) {
    const stored = "CASE WHEN p.status = 'closed' THEN 'withdrawn' ELSE r.state END";
    const result = await db.query(
      `SELECT m.id, m.run_id, m.created_at, m.withdrawn_at,
         coalesce(pfp.display_name, pu.email) AS proposed_by_name,
         coalesce(wfp.display_name, wu.email) AS withdrawn_by_name,
         CASE WHEN r.project_id IS NULL THEN 'industry' ELSE 'project' END AS kind,
         coalesce(r.project_id, r.submission_id) AS opportunity_id,
         coalesce(p.title, ps.title) AS title,
         r.run_number, r.target_term AS run_term,
         to_char(r.deadline, 'YYYY-MM-DD') AS run_deadline,
         to_char(r.centre_deadline, 'YYYY-MM-DD') AS run_centre_deadline,
         ${lifecycleStateSql(config, stored)} AS lifecycle_state,
         r.run_number = (SELECT max(r2.run_number) FROM opportunity_runs r2
           WHERE r2.project_id IS NOT DISTINCT FROM r.project_id
             AND r2.submission_id IS NOT DISTINCT FROM r.submission_id) AS current_run,
         ${MANAGES_RUN_SQL} AS viewer_manages
       FROM matches m
       JOIN opportunity_runs r ON r.id = m.run_id
       LEFT JOIN projects p ON p.id = r.project_id
       LEFT JOIN partner_submissions ps ON ps.id = r.submission_id
       LEFT JOIN users pu ON pu.id = m.proposed_by
       LEFT JOIN faculty_profiles pfp ON pfp.user_id = pu.id
       LEFT JOIN users wu ON wu.id = m.withdrawn_by
       LEFT JOIN faculty_profiles wfp ON wfp.user_id = wu.id
       WHERE ${where}
       ORDER BY m.created_at DESC, m.id DESC`,
      params,
    );
    return result.rows;
  }

  async function loadStudents(matchIds) {
    const result = await db.query(
      `SELECT ms.match_id, ms.student_email, ms.response, ms.responded_at, sp.display_name
       FROM match_students ms
       LEFT JOIN users u ON u.email = ms.student_email
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       WHERE ms.match_id = ANY($1::int[])
       ORDER BY ms.student_email`,
      [matchIds],
    );
    return result.rows;
  }

  // The current partner agreement record of each run in `runIds`.
  async function loadAgreements(runIds) {
    const result = await db.query(
      `SELECT DISTINCT ON (pa.run_id) pa.run_id, pa.agreed, pa.note, pa.created_at,
         coalesce(fp.display_name, u.email) AS recorded_by_name
       FROM partner_agreements pa
       LEFT JOIN users u ON u.id = pa.recorded_by
       LEFT JOIN faculty_profiles fp ON fp.user_id = u.id
       WHERE pa.run_id = ANY($1::int[])
       ORDER BY pa.run_id, pa.created_at DESC, pa.id DESC`,
      [runIds],
    );
    return new Map(result.rows.map((row) => [row.run_id, row]));
  }

  // The API shape of each match row, as `viewer` may act on it.
  async function describeMatches(rows, viewer) {
    if (rows.length === 0) return [];
    const students = await loadStudents(rows.map((r) => r.id));
    const agreements = await loadAgreements(rows.filter((r) => r.kind === "industry").map((r) => r.run_id));
    return rows.map((row) => {
      const own = students.filter((s) => s.match_id === row.id);
      const state = matchState(row, own);
      const lifecycle = describeLifecycle(row);
      const mine = own.find((s) => s.student_email === viewer.email);
      const answerable = state === "proposed" || state === "partly_confirmed";
      // A match can be confirmed only while its run is the current one and still taking
      // students: confirming after the deadline would undo an expiry that already happened.
      const runTakesConfirmations = row.current_run && (lifecycle.state === "open" || lifecycle.state === "matched");
      const manages = Boolean(viewer.is_verified_faculty && row.viewer_manages);
      let confirmBlockedReason = null;
      if (mine && mine.response === "pending" && answerable && !runTakesConfirmations) {
        confirmBlockedReason = row.current_run
          ? `This opportunity is ${lifecycle.label.toLowerCase()}, so the match can't be confirmed now. If you still intend to work on it, ask the faculty member to reopen it.`
          : "The opportunity has since been offered again for a later term, so this earlier match can't be confirmed now.";
      }
      return {
        id: row.id,
        state,
        label: MATCH_LABELS[state],
        summary: matchSummary(state, own),
        notice: MATCH_NOTICE,
        opportunity: { kind: row.kind, id: row.opportunity_id, title: row.title, link: opportunityLink(row.kind, row.opportunity_id) },
        run: { runNumber: row.run_number, term: row.run_term, current: row.current_run },
        lifecycle,
        proposedBy: row.proposed_by_name,
        proposedAt: row.created_at,
        withdrawnBy: row.withdrawn_at ? row.withdrawn_by_name : null,
        withdrawnAt: row.withdrawn_at,
        students: own.map((s) => ({
          name: s.display_name || s.student_email,
          email: s.student_email,
          response: s.response,
          responseLabel: RESPONSE_LABELS[s.response],
          respondedAt: s.responded_at,
          isYou: s.student_email === viewer.email,
        })),
        confirmedCount: own.filter((s) => s.response === "confirmed").length,
        partnerAgreement: row.kind === "industry" ? toPartnerAgreement(agreements.get(row.run_id)) : null,
        you: {
          isStudent: Boolean(mine),
          managesOpportunity: manages,
          response: mine ? mine.response : null,
          canConfirm: Boolean(mine && mine.response === "pending" && answerable && runTakesConfirmations),
          confirmBlockedReason,
          // R3-04: before the match is fully confirmed, a student can still say no.
          canDecline: Boolean(mine && mine.response !== "declined" && answerable),
          canWithdraw: manages && answerable,
        },
      };
    });
  }

  // One match the viewer takes part in, or null (a 404 for everyone else, R3-21, R3-22).
  async function loadMatch(viewer, id) {
    const rows = await queryMatches(`m.id = $3 AND ${participantSql(viewer)}`, [viewer.id, viewer.email, id]);
    return (await describeMatches(rows, viewer))[0] || null;
  }

  function sendMatch(res, match, status = 200) {
    res.status(status).json({ match });
  }

  // R3-05: the matches proposed to the signed-in student, with who has confirmed.
  router.get("/", auth.requireAuth, async (req, res, next) => {
    try {
      const rows = await queryMatches(
        "EXISTS (SELECT 1 FROM match_students ms WHERE ms.match_id = m.id AND ms.student_email = $2)",
        [req.user.id, req.user.email],
      );
      res.json({ matches: await describeMatches(rows, req.user), notice: MATCH_NOTICE });
    } catch (error) {
      next(error);
    }
  });

  // The opportunities a faculty member manages, each with its matches (every run) and, for
  // industry ones, the partner agreement record of the current run.
  router.get("/manage", auth.requireVerifiedFaculty, async (req, res, next) => {
    try {
      // Faculty scope only: staff who are also faculty propose on what they manage as faculty.
      const viewer = { ...req.user, is_staff: false };
      const items = [];
      for (const kind of Object.keys(KINDS)) {
        const sql = `${managedSql(config, viewer, kind)} ORDER BY lower(title)`;
        items.push(...(await db.query(sql, [req.user.id])).rows.filter((row) => row.status !== "draft"));
      }
      const matches = await describeMatches(await queryMatches(MANAGES_RUN_SQL, [req.user.id]), req.user);
      const agreements = await loadAgreements(items.filter((i) => i.kind === "industry").map((i) => i.run_id));
      res.json({
        notice: MATCH_NOTICE,
        limits: LIMITS,
        opportunities: items.map((row) => {
          const lifecycle = describeLifecycle(row);
          return {
            kind: row.kind,
            id: row.id,
            title: row.title,
            link: opportunityLink(row.kind, row.id),
            lifecycle,
            canPropose: lifecycle.state === "open",
            partnerAgreement: row.kind === "industry" ? toPartnerAgreement(agreements.get(row.run_id)) : null,
            canRecordPartnerAgreement: row.kind === "industry",
            matches: matches.filter((m) => m.opportunity.kind === row.kind && m.opportunity.id === row.id),
          };
        }),
      });
    } catch (error) {
      next(error);
    }
  });

  // The opportunity `kind`/`id` from a request, if the faculty member manages it; else null.
  async function loadManaged(viewer, kind, id) {
    if (!KINDS[kind] || id === null) return null;
    const alias = kind === "project" ? "p" : "ps";
    const result = await db.query(`${managedSql(config, { ...viewer, is_staff: false }, kind)} AND ${alias}.id = $2`, [
      viewer.id,
      id,
    ]);
    return result.rows[0] || null;
  }

  // Normalised, unique student emails from the body, or { error }.
  async function cleanStudents(value, proposer) {
    if (!Array.isArray(value)) return { error: "Name at least one student by their university email." };
    const domain = config.allowedEmailDomain;
    const emails = [];
    for (const raw of value) {
      if (typeof raw !== "string" || !raw.trim()) continue;
      const email = raw.trim().toLowerCase();
      const at = email.lastIndexOf("@");
      if (at < 1 || /\s/.test(email) || email.slice(at + 1) !== domain) {
        return { error: `"${raw.trim().slice(0, 100)}" isn't an @${domain} email address.` };
      }
      if (!emails.includes(email)) emails.push(email);
    }
    if (emails.length === 0) return { error: "Name at least one student by their university email." };
    if (emails.length > LIMITS.students) return { error: `A match can name at most ${LIMITS.students} students.` };
    if (emails.includes(proposer.email)) return { error: "You can't name yourself as a student on your own match." };
    const staffOrFaculty = await db.query(
      "SELECT email FROM users WHERE email = ANY($1::text[]) AND (is_verified_faculty OR is_staff) ORDER BY email",
      [emails],
    );
    if (staffOrFaculty.rows.length) {
      return { error: `${staffOrFaculty.rows[0].email} is a faculty or staff account, not a student.` };
    }
    return { emails };
  }

  // R3-01: propose a match on the current run of an open opportunity the faculty member manages.
  // Who proposes is always the session user; anything else in the body is ignored.
  router.post("/", auth.requireVerifiedFaculty, async (req, res, next) => {
    try {
      const body = req.body || {};
      const kind = body.kind;
      const id = parseId(String(body.opportunityId ?? ""));
      const row = await loadManaged(req.user, kind, id);
      if (!row) return res.status(404).json({ error: "Opportunity not found." });
      const lifecycle = describeLifecycle(row);
      if (row.status === "draft") {
        return res.status(409).json({ error: "Publish the project before proposing a match.", code: "not_open" });
      }
      if (lifecycle.state !== "open") {
        return res.status(409).json({
          error: `This opportunity is ${lifecycle.label.toLowerCase()}, so no new match can be proposed. ${lifecycle.reason}`,
          code: "not_open",
        });
      }
      const { emails, error } = await cleanStudents(body.students, req.user);
      if (error) return res.status(400).json({ error, field: "students" });
      // A student can be on only one live match per run.
      const taken = await db.query(
        `SELECT ms.student_email FROM match_students ms JOIN matches m ON m.id = ms.match_id
         WHERE m.run_id = $1 AND m.withdrawn_at IS NULL AND ms.student_email = ANY($2::text[])
           AND NOT EXISTS (SELECT 1 FROM match_students d WHERE d.match_id = m.id AND d.response = 'declined')
         ORDER BY ms.student_email LIMIT 1`,
        [row.run_id, emails],
      );
      if (taken.rows.length) {
        return res.status(409).json({
          error: `${taken.rows[0].student_email} is already on a match for this opportunity.`,
          code: "already_matched",
          field: "students",
        });
      }
      const created = await db.query("INSERT INTO matches (run_id, proposed_by) VALUES ($1, $2) RETURNING id", [
        row.run_id,
        req.user.id,
      ]);
      const matchId = created.rows[0].id;
      await db.query(
        "INSERT INTO match_students (match_id, student_email) SELECT $1, unnest($2::text[])",
        [matchId, emails],
      );
      sendMatch(res, await loadMatch(req.user, matchId), 201);
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", auth.requireAuth, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      const match = id === null ? null : await loadMatch(req.user, id);
      if (!match) return res.status(404).json({ error: "Match not found." });
      sendMatch(res, match);
    } catch (error) {
      next(error);
    }
  });

  // Loads the match the viewer takes part in, checks `allowed(match)`, then runs `change`.
  function matchAction(allowed, change) {
    return async (req, res, next) => {
      try {
        const id = parseId(req.params.id);
        const match = id === null ? null : await loadMatch(req.user, id);
        if (!match) return res.status(404).json({ error: "Match not found." });
        const refusal = allowed(match);
        if (refusal) return res.status(refusal.status || 409).json({ error: refusal.error, code: refusal.code });
        await change(req, match);
        sendMatch(res, await loadMatch(req.user, id));
      } catch (error) {
        next(error);
      }
    };
  }

  function respond(response) {
    return async (req, match) => {
      // The session's own email only, so nobody can answer for another student (R3-03).
      await db.query(
        "UPDATE match_students SET response = $3, responded_at = now() WHERE match_id = $1 AND student_email = $2",
        [match.id, req.user.email, response],
      );
    };
  }

  // R3-02, R3-03: only an invited student confirms, and only for themselves.
  router.post(
    "/:id/confirm",
    auth.requireAuth,
    matchAction((m) => {
      if (!m.you.isStudent) return { status: 403, error: "Only the students named on a match can confirm it." };
      if (m.you.canConfirm) return null;
      if (m.you.response === "confirmed") return { error: "You have already confirmed this match.", code: "already_answered" };
      return { error: m.you.confirmBlockedReason || `This match is ${m.label.toLowerCase()}, so it can't be confirmed.`, code: "not_confirmable" };
    }, respond("confirmed")),
  );

  // R3-04: a student declines (even after confirming, until everyone has). The answer is kept.
  router.post(
    "/:id/decline",
    auth.requireAuth,
    matchAction((m) => {
      if (!m.you.isStudent) return { status: 403, error: "Only the students named on a match can decline it." };
      if (m.you.canDecline) return null;
      return { error: `This match is ${m.label.toLowerCase()}, so it can't be declined now.`, code: "not_declinable" };
    }, respond("declined")),
  );

  // R3-04: a faculty member who manages the opportunity withdraws the proposal before it is
  // fully confirmed. The match is kept, marked withdrawn.
  router.post(
    "/:id/withdraw",
    auth.requireVerifiedFaculty,
    matchAction(
      (m) => {
        if (!m.you.managesOpportunity) return { status: 404, error: "Match not found." };
        if (m.you.canWithdraw) return null;
        return { error: `This match is ${m.label.toLowerCase()}, so it can't be withdrawn.`, code: "not_withdrawable" };
      },
      async (req, match) => {
        await db.query("UPDATE matches SET withdrawn_at = now(), withdrawn_by = $2 WHERE id = $1 AND withdrawn_at IS NULL", [
          match.id,
          req.user.id,
        ]);
      },
    ),
  );

  // R3-07: a supervising faculty member records (or retracts) that the partner agreed in
  // principle, for the current run. Each call adds a record; none is overwritten.
  router.post("/partner-agreements/:id", auth.requireVerifiedFaculty, async (req, res, next) => {
    try {
      const row = await loadManaged(req.user, "industry", parseId(req.params.id));
      if (!row) return res.status(404).json({ error: "Opportunity not found." });
      const { agreed, note = "" } = req.body || {};
      if (typeof agreed !== "boolean") return res.status(400).json({ error: "Say whether the partner agreed in principle." });
      if (typeof note !== "string" || note.trim().length > LIMITS.note) {
        return res.status(400).json({ error: `The note must be ${LIMITS.note} characters or fewer.`, field: "note" });
      }
      await db.query("INSERT INTO partner_agreements (run_id, agreed, note, recorded_by) VALUES ($1, $2, $3, $4)", [
        row.run_id,
        agreed,
        note.trim(),
        req.user.id,
      ]);
      const agreements = await loadAgreements([row.run_id]);
      res.status(201).json({ partnerAgreement: toPartnerAgreement(agreements.get(row.run_id)) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createMatchesRouter, MANAGES_RUN_SQL, MATCH_NOTICE, matchState };
