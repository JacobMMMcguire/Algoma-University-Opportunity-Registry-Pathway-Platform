const express = require("express");
const { recordAudit } = require("../audit");
const { pageOf, pageRequest, searchText } = require("../paging");
const { canonicalTerm } = require("../catalog");
const {
  KINDS,
  LIFECYCLE_LABELS,
  currentRunJoin,
  describeClock,
  describeLifecycle,
  formatDate,
  lifecycleReason,
  lifecycleStateSql,
  logRunChange,
  parseDate,
  today,
} = require("../lifecycle");
const { parseId } = require("../validation");

// What the managers of an opportunity may do next, from its current lifecycle state.
// Withdrawing a matched opportunity isn't offered: the students have confirmed, so it is
// completed (or archived) instead. Expired and withdrawn ones can be reopened (R3-13), expired and
// completed ones renewed for a later term (R3-12).
const ACTIONS_BY_STATE = {
  open: ["schedule", "withdraw", "archive"],
  expired: ["schedule", "reopen", "renew", "withdraw", "archive"],
  matched: ["schedule", "complete", "archive"],
  withdrawn: ["reopen", "archive"],
  completed: ["renew", "reopen", "archive"],
  archived: ["reopen"],
  // F-11: staff reassign it (below); it can also be withdrawn or archived.
  needs_supervisor: ["withdraw", "archive"],
};

// The stored state each action sets on the current run.
const ACTION_STATES = { withdraw: "withdrawn", complete: "completed", archive: "archived", reopen: "open" };

// SQL for the opportunities `viewer` manages, as rows with the current run's columns. Faculty
// manage their own projects and the industry opportunities they're willing to supervise; staff
// manage every published project and every industry opportunity (R3-13). The viewer comes from
// the session, never the request (R3-21).
function managedSql(config, viewer, kind) {
  if (kind === "project") {
    const who = viewer.is_staff ? "(p.status <> 'draft' OR p.faculty_user_id = $1)" : "p.faculty_user_id = $1";
    return `SELECT 'project' AS kind, p.id, p.title, p.status, run.*, coalesce(fp.display_name, u.email) AS managed_by
      FROM projects p
      JOIN users u ON u.id = p.faculty_user_id
      LEFT JOIN faculty_profiles fp ON fp.user_id = p.faculty_user_id
      ${currentRunJoin(config, "project", "p")}
      WHERE ${who}`;
  }
  const who = viewer.is_staff
    ? "$1::int IS NOT NULL"
    : "EXISTS (SELECT 1 FROM opportunity_supervisors os WHERE os.submission_id = ps.id AND os.faculty_user_id = $1)";
  return `SELECT 'industry' AS kind, ps.id, ps.title, NULL AS status, run.*,
      (SELECT string_agg(coalesce(fp.display_name, u.email), ', ' ORDER BY os.created_at)
       FROM opportunity_supervisors os JOIN users u ON u.id = os.faculty_user_id
       LEFT JOIN faculty_profiles fp ON fp.user_id = u.id WHERE os.submission_id = ps.id) AS managed_by
    FROM partner_submissions ps
    ${currentRunJoin(config, "industry", "ps")}
    WHERE ${who}`;
}

function toItem(row, viewer) {
  const lifecycle = describeLifecycle(row);
  return {
    kind: row.kind,
    id: row.id,
    title: row.title,
    draft: row.status === "draft",
    managedBy: row.managed_by || null,
    lifecycle,
    actions: ACTIONS_BY_STATE[lifecycle.state],
    canSetCentreDeadline: Boolean(viewer.is_staff),
    // F-07, F-11: everyone managing it has left; staff can hand it to another faculty member.
    managersDeparted: Boolean(row.managers_departed),
    canReassign: Boolean(viewer.is_staff && row.managers_departed),
  };
}

// R3-08 to R3-13: managing an opportunity's term, deadlines and lifecycle state. Every route
// finds the record through managedSql, so an id the viewer doesn't manage is a 404 and changes
// nothing, whatever the URL or body says (R3-21).
function createLifecycleRouter({ db, config, auth }) {
  const router = express.Router();

  async function loadItem(viewer, kind, id) {
    const result = await db.query(`${managedSql(config, viewer, kind)} AND ${kind === "project" ? "p" : "ps"}.id = $2`, [
      viewer.id,
      id,
    ]);
    return result.rows[0] || null;
  }

  // Every run of a record, oldest first, with its derived state and history (R3-12).
  async function loadHistory(kind, id) {
    const runs = await db.query(
      `SELECT r.id, r.run_number, r.target_term AS run_term,
              to_char(r.deadline, 'YYYY-MM-DD') AS run_deadline,
              to_char(r.centre_deadline, 'YYYY-MM-DD') AS run_centre_deadline,
              ${lifecycleStateSql(config)} AS lifecycle_state
       FROM opportunity_runs r WHERE r.${KINDS[kind].runColumn} = $1 ORDER BY r.run_number`,
      [id],
    );
    const changes = await db.query(
      `SELECT c.run_id, c.change, c.detail, c.created_at, coalesce(fp.display_name, u.email) AS by_name, u.is_staff
       FROM run_changes c
       LEFT JOIN users u ON u.id = c.user_id
       LEFT JOIN faculty_profiles fp ON fp.user_id = u.id
       WHERE c.run_id = ANY($1::int[]) ORDER BY c.created_at, c.id`,
      [runs.rows.map((r) => r.id)],
    );
    return runs.rows.map((r) => ({
      runNumber: r.run_number,
      term: r.run_term,
      deadline: r.run_deadline,
      centreDeadline: r.run_centre_deadline,
      state: r.lifecycle_state,
      label: LIFECYCLE_LABELS[r.lifecycle_state],
      reason: lifecycleReason(r.lifecycle_state, {
        term: r.run_term,
        effectiveDeadline: r.run_centre_deadline || r.run_deadline,
      }),
      changes: changes.rows
        .filter((c) => c.run_id === r.id)
        .map((c) => ({ change: c.change, detail: c.detail, at: c.created_at, by: c.by_name, byStaff: Boolean(c.is_staff) })),
    }));
  }

  // Parses :kind and :id, loads the record the viewer manages, then runs `action`.
  function withItem(action) {
    return async (req, res, next) => {
      try {
        const kind = req.params.kind;
        const id = parseId(req.params.id);
        if (!KINDS[kind] || id === null) return res.status(404).json({ error: "Opportunity not found." });
        const row = await loadItem(req.user, kind, id);
        if (!row) return res.status(404).json({ error: "Opportunity not found." });
        const done = await action(req, res, { kind, id, row, lifecycle: describeLifecycle(row) });
        if (done === false) return;
        res.json({ item: toItem(await loadItem(req.user, kind, id), req.user), history: await loadHistory(kind, id) });
      } catch (error) {
        next(error);
      }
    };
  }

  function refuse(res, status, error, code) {
    res.status(status).json({ error, code });
    return false;
  }

  // Changes the current run's stored state, logging who did it.
  async function setRunState(kind, id, row, state, userId) {
    await db.query("UPDATE opportunity_runs SET state = $2, state_changed_by = $3, state_changed_at = now() WHERE id = $1", [
      row.run_id,
      state,
      userId,
    ]);
    // Faculty projects keep their R1 status in step: withdrawn is "closed" (R1-15).
    if (kind === "project") {
      await db.query(
        `UPDATE projects SET status = CASE WHEN $2 = 'withdrawn' THEN 'closed'
           WHEN status = 'closed' THEN 'published' ELSE status END, updated_at = now() WHERE id = $1`,
        [id, state],
      );
    }
    await logRunChange(db, row.run_id, "state", `${row.lifecycle_state} to ${state}`, userId);
  }

  // A deadline from the body: undefined if not given, null to clear, or a valid date. Returns
  // { deadline } or { error }. New deadlines can't already be in the past.
  function bodyDeadline(body, field = "deadline") {
    if (!(field in body)) return { deadline: undefined };
    if (body[field] === null || body[field] === "") return { deadline: null };
    const deadline = parseDate(body[field]);
    if (!deadline) return { error: "Enter the deadline as a date (YYYY-MM-DD)." };
    if (deadline < today(config)) return { error: `The deadline can't be before today, ${formatDate(today(config))}.` };
    return { deadline };
  }

  function bodyTerm(body, kind) {
    if (body.targetTerm === null || body.targetTerm === "" || body.targetTerm === undefined) {
      return kind === "project" ? { error: "Choose the target term's season and year." } : { term: null };
    }
    const term = canonicalTerm(body.targetTerm);
    return term ? { term } : { error: "Choose the target term's season and year." };
  }

  // F-19: with ?limit= (and ?offset=, ?q= to search titles) it is one page; staff see every
  // opportunity, so their list is paged on the page.
  router.get("/", auth.requireVerifiedFacultyOrStaff, async (req, res, next) => {
    try {
      const q = searchText(req.query);
      const rows = [];
      for (const kind of Object.keys(KINDS)) {
        rows.push(...(await db.query(`${managedSql(config, req.user, kind)} ORDER BY lower(title)`, [req.user.id])).rows);
      }
      const items = rows.filter((row) => !q || row.title.toLowerCase().includes(q)).map((row) => toItem(row, req.user));
      const page = pageRequest(req.query);
      if (!page) return res.json({ items, clock: describeClock(config) });
      const { items: shown, ...paging } = pageOf(items, page);
      res.json({ items: shown, ...paging, clock: describeClock(config) });
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/:kind/:id",
    auth.requireVerifiedFacultyOrStaff,
    withItem(() => true),
  );

  // R3-08: the term and the faculty deadline of the current run.
  router.put(
    "/:kind/:id/schedule",
    auth.requireVerifiedFacultyOrStaff,
    withItem(async (req, res, { kind, id, row, lifecycle }) => {
      if (!ACTIONS_BY_STATE[lifecycle.state].includes("schedule")) {
        return refuse(res, 409, `A ${lifecycle.label.toLowerCase()} opportunity's term can't be changed. Renew it for a later term instead.`);
      }
      const body = req.body || {};
      const { term, error: termError } = bodyTerm(body, kind);
      if (termError) return refuse(res, 400, termError);
      const { deadline, error } = bodyDeadline(body);
      if (error) return refuse(res, 400, error);
      await db.query(
        `UPDATE opportunity_runs SET target_term = $2, deadline = CASE WHEN $3::boolean THEN $4::date ELSE deadline END
         WHERE id = $1`,
        [row.run_id, term, deadline !== undefined, deadline ?? null],
      );
      if (kind === "project") await db.query("UPDATE projects SET target_term = $2, updated_at = now() WHERE id = $1", [id, term]);
      const shown = deadline === undefined ? row.run_deadline : deadline;
      await logRunChange(db, row.run_id, "schedule", `${term || "no term"}, deadline ${shown || "none"}`, req.user.id);
    }),
  );

  // R3-08: Centre deadlines are authoritative, so only staff set them.
  router.put(
    "/:kind/:id/centre-deadline",
    auth.requireStaff,
    withItem(async (req, res, { row }) => {
      const { deadline, error } = bodyDeadline(req.body || {}, "centreDeadline");
      if (error) return refuse(res, 400, error);
      if (deadline === undefined) return refuse(res, 400, "Give a Centre deadline, or null to remove it.");
      await db.query("UPDATE opportunity_runs SET centre_deadline = $2 WHERE id = $1", [row.run_id, deadline]);
      await logRunChange(db, row.run_id, "centre_deadline", deadline || "removed", req.user.id);
    }),
  );

  // R3-11, R3-13: withdraw, complete, archive or reopen. Reopening an expired run needs a new
  // deadline that hasn't passed.
  router.post(
    "/:kind/:id/state",
    auth.requireVerifiedFacultyOrStaff,
    withItem(async (req, res, { kind, id, row, lifecycle }) => {
      const action = req.body?.action;
      if (!ACTION_STATES[action]) return refuse(res, 400, "Choose withdraw, complete, archive or reopen.");
      if (!ACTIONS_BY_STATE[lifecycle.state].includes(action)) {
        return refuse(res, 409, `This opportunity is ${lifecycle.label.toLowerCase()}, so it can't be changed that way.`, "invalid_transition");
      }
      if (action === "reopen") {
        const { deadline, error } = bodyDeadline(req.body);
        if (error) return refuse(res, 400, error);
        const faculty = deadline === undefined ? row.run_deadline : deadline;
        const effective = row.run_centre_deadline || faculty;
        if (effective && effective < today(config)) {
          return refuse(
            res,
            409,
            row.run_centre_deadline
              ? `The Centre deadline, ${formatDate(row.run_centre_deadline)}, has passed. Centre staff can set a later one.`
              : `The deadline, ${formatDate(effective)}, has passed. Give a new deadline to reopen it.`,
            "deadline_passed",
          );
        }
        if (deadline !== undefined) {
          await db.query("UPDATE opportunity_runs SET deadline = $2 WHERE id = $1", [row.run_id, deadline]);
          await logRunChange(db, row.run_id, "schedule", `${row.run_term || "no term"}, deadline ${deadline || "none"}`, req.user.id);
        }
      }
      await setRunState(kind, id, row, ACTION_STATES[action], req.user.id);
    }),
  );

  // R3-12: renewal adds a run to the same record. The earlier run keeps its matches and outcomes.
  router.post(
    "/:kind/:id/renew",
    auth.requireVerifiedFacultyOrStaff,
    withItem(async (req, res, { kind, id, row, lifecycle }) => {
      if (!ACTIONS_BY_STATE[lifecycle.state].includes("renew")) {
        return refuse(res, 409, "Only an expired or completed opportunity can be renewed for a later term.", "invalid_transition");
      }
      const body = req.body || {};
      const { term, error: termError } = bodyTerm({ targetTerm: body.targetTerm }, "project");
      if (termError) return refuse(res, 400, termError);
      const { deadline, error } = bodyDeadline(body);
      if (error) return refuse(res, 400, error);
      const created = await db.query(
        `INSERT INTO opportunity_runs (${KINDS[kind].runColumn}, run_number, target_term, deadline)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [id, row.run_number + 1, term, deadline ?? null],
      );
      if (kind === "project") await db.query("UPDATE projects SET target_term = $2, updated_at = now() WHERE id = $1", [id, term]);
      await logRunChange(db, created.rows[0].id, "renewed", `from ${row.run_term || "run " + row.run_number}`, req.user.id);
    }),
  );

  // F-07, F-11 (FINAL_PLAN.md D3): staff give an opportunity whose managers have all left to a
  // verified faculty member who has agreed to take it on. A project gets a new owner; an industry
  // opportunity gets them as a willing supervisor, and the departed supervisors' rows stay. The
  // record keeps its id, runs, matches and outcomes. Recorded in run_changes and audit_events.
  router.post(
    "/:kind/:id/reassign",
    auth.requireStaff,
    withItem(async (req, res, { kind, id, row }) => {
      if (!row.managers_departed) {
        return refuse(res, 409, "Someone who manages this opportunity is still at Algoma, so it doesn't need reassigning.", "not_orphaned");
      }
      const body = req.body || {};
      const facultyId = parseId(String(body.facultyUserId ?? ""));
      if (facultyId === null) return refuse(res, 400, "Choose the faculty member who will take it on.");
      if (body.agreed !== true) {
        return refuse(res, 400, "Confirm that the faculty member has agreed to take it on.", "agreement_required");
      }
      const found = await db.query(
        `SELECT u.id, u.email, u.is_verified_faculty, u.departure, u.public_profile_choice, fp.display_name
         FROM users u LEFT JOIN faculty_profiles fp ON fp.user_id = u.id WHERE u.id = $1`,
        [facultyId],
      );
      const faculty = found.rows[0];
      if (!faculty || !faculty.is_verified_faculty || faculty.departure) {
        return refuse(res, 400, "Choose a verified faculty member who is still at Algoma.");
      }
      if (!faculty.display_name || faculty.public_profile_choice === null) {
        return refuse(
          res,
          409,
          `${faculty.display_name || faculty.email} needs a faculty profile and a public-display choice first, so students can see who supervises it.`,
          "faculty_profile_required",
        );
      }
      await db.transaction(async (tx) => {
        let from;
        if (kind === "project") {
          const before = await tx.query("SELECT faculty_user_id FROM projects WHERE id = $1 FOR UPDATE", [id]);
          from = [before.rows[0].faculty_user_id];
          await tx.query("UPDATE projects SET faculty_user_id = $2, updated_at = now() WHERE id = $1", [id, facultyId]);
        } else {
          const before = await tx.query("SELECT faculty_user_id FROM opportunity_supervisors WHERE submission_id = $1 ORDER BY faculty_user_id", [id]);
          from = before.rows.map((r) => r.faculty_user_id);
          await tx.query("INSERT INTO opportunity_supervisors (submission_id, faculty_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
            id,
            facultyId,
          ]);
        }
        await logRunChange(tx, row.run_id, "reassigned", `to ${faculty.display_name}`, req.user.id);
        await recordAudit(tx, {
          actorId: req.user.id,
          action: "opportunity.reassign",
          subjectType: kind === "project" ? "project" : "partner_submission",
          subjectId: id,
          detail: { fromUserIds: from, toUserId: facultyId, agreedByNewSupervisor: true },
        });
      });
    }),
  );

  return router;
}

module.exports = { createLifecycleRouter, ACTIONS_BY_STATE, managedSql };
