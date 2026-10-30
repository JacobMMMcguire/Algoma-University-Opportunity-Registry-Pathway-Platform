const express = require("express");
const { formatDate, parseDate, today } = require("../lifecycle");
const { cleanText, parseId } = require("../validation");
const { PUBLIC_FACULTY_SQL } = require("../visibility");
const { MANAGES_RUN_SQL } = require("./matches");

// R3-14 to R3-18, R3-20 (R3_PLAN.md D8). A participant of a confirmed match records what came
// of it. Until a participating verified faculty member confirms it, only its participants see it
// (R3-15). A confirmed outcome is showcased (public, and on profiles) only while consent allows:
// every faculty member on it, and the owner of a faculty project, is publicly visible (R3-16).
// Students are named to visitors only if their own profile is public. Partner contact details
// are never selected here.

const LIMITS = { summary: 1000, link: 300, faculty: 5 };
const LINK_KINDS = ["demo", "repo", "poster", "video", "image"];
const LINK_LABELS = { demo: "Demo", repo: "Code repository", poster: "Poster", video: "Video", image: "Image" };

// A faculty participant counts as publicly visible while verified, public by choice, and with a
// profile to link to. `users` and `fp` are joined for the participant.
const PUBLIC_PARTICIPANT_SQL = `coalesce(${PUBLIC_FACULTY_SQL} AND fp.user_id IS NOT NULL, false)`;

// The showcase rule for outcome `o` on run `r`, in one place (D8).
const SHOWCASE_SQL = `(o.confirmed_by IS NOT NULL
  AND EXISTS (SELECT 1 FROM outcome_participants op JOIN users cu ON cu.email = op.email
    WHERE op.outcome_id = o.id AND op.role = 'faculty' AND cu.id = o.confirmed_by AND cu.is_verified_faculty)
  AND NOT EXISTS (SELECT 1 FROM outcome_participants op
    LEFT JOIN users ON users.email = op.email
    LEFT JOIN faculty_profiles fp ON fp.user_id = users.id
    WHERE op.outcome_id = o.id AND op.role = 'faculty' AND NOT ${PUBLIC_PARTICIPANT_SQL})
  AND (r.project_id IS NULL OR EXISTS (SELECT 1 FROM projects op_p JOIN users ON users.id = op_p.faculty_user_id
    WHERE op_p.id = r.project_id AND ${PUBLIC_FACULTY_SQL})))`;

// A match with at least one student, every one of whom confirmed, not withdrawn (R3-02).
const CONFIRMED_MATCH_SQL = `(m.withdrawn_at IS NULL
  AND EXISTS (SELECT 1 FROM match_students ms WHERE ms.match_id = m.id)
  AND NOT EXISTS (SELECT 1 FROM match_students ms WHERE ms.match_id = m.id AND ms.response <> 'confirmed'))`;

function cleanLinks(value) {
  if (value === undefined || value === null) return { links: {} };
  if (typeof value !== "object" || Array.isArray(value)) return { error: "Links must be given by kind." };
  const links = {};
  for (const [kind, raw] of Object.entries(value)) {
    if (!LINK_KINDS.includes(kind)) return { error: `"${kind.slice(0, 30)}" isn't a kind of link (${LINK_KINDS.join(", ")}).` };
    if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim())) continue;
    if (typeof raw !== "string") return { error: `The ${LINK_LABELS[kind].toLowerCase()} link must be a web address.`, field: kind };
    let url;
    try {
      url = new URL(raw.trim());
    } catch {
      return { error: `The ${LINK_LABELS[kind].toLowerCase()} link isn't a valid web address. Start it with https://`, field: kind };
    }
    // Only http(s): anything else (javascript:, data:) could run script when clicked.
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { error: `The ${LINK_LABELS[kind].toLowerCase()} link must start with https:// or http://`, field: kind };
    }
    if (url.href.length > LIMITS.link) return { error: `Each link must be ${LIMITS.link} characters or fewer.`, field: kind };
    links[kind] = url.href;
  }
  return { links };
}

// Summary, completion date and links, shared by recording and editing. Returns { content } or
// { error, field }.
function validateContent(body, config) {
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  if (!summary) return { error: "Write a short summary of what was produced.", field: "summary" };
  if (summary.length > LIMITS.summary) return { error: `The summary must be ${LIMITS.summary} characters or fewer.`, field: "summary" };
  const completedOn = parseDate(body.completedOn);
  if (!completedOn) return { error: "Enter the completion date (YYYY-MM-DD).", field: "completedOn" };
  if (completedOn > today(config)) {
    return { error: `The completion date can't be after today, ${formatDate(today(config))}.`, field: "completedOn" };
  }
  const { links, error, field } = cleanLinks(body.links);
  if (error) return { error, field: field || "links" };
  return { content: { summary, completedOn, links } };
}

const linkList = (links) => LINK_KINDS.filter((k) => links?.[k]).map((k) => ({ kind: k, label: LINK_LABELS[k], url: links[k] }));

function createOutcomesRouter({ db, config, auth }) {
  const router = express.Router();

  // Outcomes with their opportunity and showcase status, for the condition `where`.
  async function queryOutcomes(where, params) {
    const result = await db.query(
      `SELECT o.id, o.match_id, o.summary, to_char(o.completed_on, 'YYYY-MM-DD') AS completed_on, o.links,
         o.confirmed_by, o.confirmed_at, o.updated_at,
         coalesce(cfp.display_name, cu.email) AS confirmed_by_name,
         CASE WHEN r.project_id IS NULL THEN 'industry' ELSE 'project' END AS kind,
         coalesce(r.project_id, r.submission_id) AS opportunity_id,
         coalesce(p.title, ps.title) AS title, ps.organisation, r.target_term, r.run_number,
         ${SHOWCASE_SQL} AS showcased,
         (r.project_id IS NULL OR EXISTS (SELECT 1 FROM users WHERE users.id = p.faculty_user_id AND ${PUBLIC_FACULTY_SQL})) AS owner_public
       FROM outcomes o
       JOIN matches m ON m.id = o.match_id
       JOIN opportunity_runs r ON r.id = m.run_id
       LEFT JOIN projects p ON p.id = r.project_id
       LEFT JOIN partner_submissions ps ON ps.id = r.submission_id
       LEFT JOIN users cu ON cu.id = o.confirmed_by
       LEFT JOIN faculty_profiles cfp ON cfp.user_id = cu.id
       WHERE ${where}
       ORDER BY o.completed_on DESC, o.id DESC`,
      params,
    );
    return result.rows;
  }

  async function loadParticipants(outcomeIds) {
    if (outcomeIds.length === 0) return [];
    const result = await db.query(
      `SELECT op.outcome_id, op.email, op.role, op.show_on_profile, users.id AS user_id,
         fp.display_name AS faculty_name, sp.display_name AS student_name,
         sp.public_profile_choice AS student_public, ${PUBLIC_PARTICIPANT_SQL} AS faculty_public
       FROM outcome_participants op
       LEFT JOIN users ON users.email = op.email
       LEFT JOIN faculty_profiles fp ON fp.user_id = users.id
       LEFT JOIN student_profiles sp ON sp.user_id = users.id
       WHERE op.outcome_id = ANY($1::int[])
       ORDER BY op.role, op.email`,
      [outcomeIds],
    );
    return result.rows;
  }

  const opportunityOf = (row) => ({
    kind: row.kind,
    title: row.title,
    // Only the organisation's name, as in student discovery; never its contact details (R3-16).
    organisation: row.kind === "industry" ? row.organisation : null,
    term: row.target_term,
  });

  // A student may be named to this viewer: they have a profile, and either the viewer is signed
  // in or the student chose public display (D8, mirroring R1-10).
  const studentVisible = (p, viewer) => Boolean(p.student_name && p.user_id && (viewer || p.student_public === true));

  // What anyone may see of a showcased outcome (R3-20).
  function toPublicOutcome(row, participants, viewer) {
    const students = participants.filter((p) => p.role === "student");
    const named = students.filter((p) => studentVisible(p, viewer));
    return {
      id: row.id,
      opportunity: opportunityOf(row),
      summary: row.summary,
      completedOn: row.completed_on,
      links: linkList(row.links),
      faculty: participants.filter((p) => p.role === "faculty").map((p) => ({ id: p.user_id, displayName: p.faculty_name })),
      students: named.map((p) => ({ id: p.user_id, displayName: p.student_name })),
      otherStudents: students.length - named.length,
    };
  }

  // Why a participant's outcome is or isn't public, in words ("Who decides whether my project
  // appears publicly?").
  function publicStatus(row, participants) {
    if (!row.confirmed_by) {
      return "Visible only to the people on it. It becomes public once a faculty member on it confirms it, if every faculty member on it allows public display.";
    }
    const by = row.confirmed_by_name || "a faculty member";
    if (row.showcased) return `Confirmed by ${by}. Shown publicly in Completed work and on the profiles of the people on it.`;
    const hidden = participants.filter((p) => p.role === "faculty" && !p.faculty_public).map((p) => p.faculty_name || p.email);
    if (hidden.length) {
      return `Confirmed by ${by}, but visible only to the people on it: ${hidden.join(", ")} ${hidden.length === 1 ? "doesn't" : "don't"} allow public display of their profile.`;
    }
    if (!row.owner_public) return `Confirmed by ${by}, but visible only to the people on it: the project's faculty member doesn't allow public display.`;
    return `Confirmed by ${by}, but visible only to the people on it, because the faculty member who confirmed it is no longer verified. Another faculty member on it can confirm it.`;
  }

  // The full view, for the outcome's participants only (R3-15).
  function toParticipantOutcome(row, participants, viewer) {
    const mine = participants.find((p) => p.email === viewer.email);
    const isFaculty = mine?.role === "faculty" && viewer.is_verified_faculty;
    return {
      ...toPublicOutcome(row, participants, viewer),
      confirmed: Boolean(row.confirmed_by),
      confirmedBy: row.confirmed_by_name,
      confirmedAt: row.confirmed_at,
      showcased: row.showcased,
      publicStatus: publicStatus(row, participants),
      participants: participants.map((p) => ({
        role: p.role,
        name: (p.role === "faculty" ? p.faculty_name : p.student_name) || p.email,
        email: p.email,
        isYou: p.email === viewer.email,
        showOnProfile: p.role === "student" ? p.show_on_profile : null,
      })),
      linkValues: row.links,
      you: {
        role: mine.role,
        canEdit: true,
        canConfirm: Boolean(isFaculty && !row.confirmed_by),
        canUnconfirm: Boolean(isFaculty && row.confirmed_by),
        // R3-18: a student's own choice, about their own profile only.
        showOnProfile: mine.role === "student" ? mine.show_on_profile : null,
      },
    };
  }

  // Participants' outcomes, by the session's email.
  const PARTICIPANT_SQL = "EXISTS (SELECT 1 FROM outcome_participants me WHERE me.outcome_id = o.id AND me.email = $1)";

  async function loadOwn(viewer, id) {
    const rows = await queryOutcomes(`o.id = $2 AND ${PARTICIPANT_SQL}`, [viewer.email, id]);
    if (!rows[0]) return null;
    return toParticipantOutcome(rows[0], await loadParticipants([id]), viewer);
  }

  // The confirmed matches the viewer can record an outcome for: they were a student on it, or
  // they manage its opportunity as verified faculty. With the choices for the form.
  async function recordableMatches(viewer, matchId = null) {
    const result = await db.query(
      `SELECT m.id, coalesce(p.title, ps.title) AS title, r.target_term, r.run_number,
         CASE WHEN r.project_id IS NULL THEN 'industry' ELSE 'project' END AS kind,
         p.faculty_user_id AS owner_id, r.submission_id
       FROM matches m
       JOIN opportunity_runs r ON r.id = m.run_id
       LEFT JOIN projects p ON p.id = r.project_id
       LEFT JOIN partner_submissions ps ON ps.id = r.submission_id
       WHERE ${CONFIRMED_MATCH_SQL}
         AND (EXISTS (SELECT 1 FROM match_students ms WHERE ms.match_id = m.id AND ms.student_email = $2)
           OR ($3::boolean AND ${MANAGES_RUN_SQL}))
         AND ($4::int IS NULL OR m.id = $4)
       ORDER BY m.created_at DESC, m.id DESC`,
      [viewer.id, viewer.email, Boolean(viewer.is_verified_faculty), matchId],
    );
    const matches = [];
    for (const row of result.rows) {
      const students = await db.query(
        `SELECT ms.student_email AS email, coalesce(sp.display_name, ms.student_email) AS name
         FROM match_students ms LEFT JOIN users u ON u.email = ms.student_email
         LEFT JOIN student_profiles sp ON sp.user_id = u.id
         WHERE ms.match_id = $1 ORDER BY ms.student_email`,
        [row.id],
      );
      // The opportunity's faculty, offered as participants by name (their emails aren't shown).
      const faculty = await db.query(
        `SELECT u.id, fp.display_name AS name FROM users u JOIN faculty_profiles fp ON fp.user_id = u.id
         WHERE u.is_verified_faculty AND (u.id = $1 OR u.id IN (SELECT faculty_user_id FROM opportunity_supervisors WHERE submission_id = $2))
         ORDER BY fp.display_name`,
        [row.owner_id, row.submission_id],
      );
      matches.push({
        matchId: row.id,
        opportunity: { kind: row.kind, title: row.title, term: row.target_term },
        students: students.rows,
        faculty: faculty.rows.map((f) => ({ id: f.id, name: f.name, isYou: f.id === viewer.id })),
      });
    }
    return matches;
  }

  // Faculty participants from the body: ids from the form's choices and, for anyone else, a
  // verified faculty member's email. Every one needs a profile, so they can be named.
  async function cleanFaculty(body, viewer) {
    const ids = Array.isArray(body.faculty) ? body.faculty.map((v) => parseId(String(v))).filter((v) => v !== null) : [];
    const emails = Array.isArray(body.otherFacultyEmails)
      ? body.otherFacultyEmails.filter((e) => typeof e === "string" && e.trim()).map((e) => e.trim().toLowerCase())
      : [];
    if (viewer.is_verified_faculty) ids.push(viewer.id);
    const found = await db.query(
      `SELECT u.id, u.email, u.is_verified_faculty, fp.user_id IS NOT NULL AS has_profile
       FROM users u LEFT JOIN faculty_profiles fp ON fp.user_id = u.id
       WHERE u.id = ANY($1::int[]) OR u.email = ANY($2::text[])`,
      [ids, emails],
    );
    for (const email of emails) {
      if (!found.rows.some((u) => u.email === email)) return { error: `${email.slice(0, 100)} isn't a faculty account here.` };
    }
    const invalid = found.rows.find((u) => !u.is_verified_faculty || !u.has_profile);
    if (invalid) return { error: `${invalid.email} isn't a verified faculty member with a profile.` };
    const unique = [...new Set(found.rows.map((u) => u.email))];
    if (unique.length === 0) return { error: "Name at least one faculty member who worked on it." };
    if (unique.length > LIMITS.faculty) return { error: `Name at most ${LIMITS.faculty} faculty members.` };
    return { emails: unique };
  }

  // R3-20: the showcase. Optional ?facultyId= or ?studentId= give one person's outcomes, for
  // their profile (R3-17). A student's own choice hides it only from their own profile (R3-18).
  router.get("/showcase", async (req, res, next) => {
    try {
      const viewer = await auth.getSessionUser(req);
      const params = [];
      let where = SHOWCASE_SQL;
      for (const key of ["facultyId", "studentId"]) {
        if (req.query[key] === undefined) continue;
        const id = parseId(String(req.query[key]));
        if (id === null) return res.status(400).json({ error: "Unknown person." });
        params.push(id);
        where +=
          key === "facultyId"
            ? ` AND EXISTS (SELECT 1 FROM outcome_participants f JOIN users fu ON fu.email = f.email
                WHERE f.outcome_id = o.id AND f.role = 'faculty' AND fu.id = $${params.length})`
            : ` AND EXISTS (SELECT 1 FROM outcome_participants s JOIN users su ON su.email = s.email
                JOIN student_profiles ssp ON ssp.user_id = su.id
                WHERE s.outcome_id = o.id AND s.role = 'student' AND s.show_on_profile AND su.id = $${params.length}
                  ${viewer ? "" : "AND ssp.public_profile_choice IS TRUE"})`;
      }
      const rows = await queryOutcomes(where, params);
      const participants = await loadParticipants(rows.map((r) => r.id));
      res.json({
        outcomes: rows.map((row) => toPublicOutcome(row, participants.filter((p) => p.outcome_id === row.id), viewer)),
      });
    } catch (error) {
      next(error);
    }
  });

  // R3-14, R3-15: the signed-in user's outcomes, and the confirmed matches they can record one for.
  router.get("/mine", auth.requireAuth, async (req, res, next) => {
    try {
      const rows = await queryOutcomes(PARTICIPANT_SQL, [req.user.email]);
      const participants = await loadParticipants(rows.map((r) => r.id));
      res.json({
        outcomes: rows.map((row) => toParticipantOutcome(row, participants.filter((p) => p.outcome_id === row.id), req.user)),
        recordable: await recordableMatches(req.user),
        limits: LIMITS,
        linkKinds: LINK_KINDS.map((kind) => ({ kind, label: LINK_LABELS[kind] })),
        today: today(config),
      });
    } catch (error) {
      next(error);
    }
  });

  // R3-14: a participant of a confirmed match records an outcome. Confirmation and every other
  // status field in the body are ignored: a new outcome is always unconfirmed (R3-15).
  router.post("/", auth.requireAuth, async (req, res, next) => {
    try {
      const body = req.body || {};
      const matchId = parseId(String(body.matchId ?? ""));
      const [match] = matchId === null ? [] : await recordableMatches(req.user, matchId);
      if (!match) return res.status(404).json({ error: "Confirmed match not found." });
      const { content, error, field } = validateContent(body, config);
      if (error) return res.status(400).json({ error, field });

      const allowed = match.students.map((s) => s.email);
      const students = Array.isArray(body.students)
        ? [...new Set(body.students.filter((e) => typeof e === "string").map((e) => e.trim().toLowerCase()))]
        : [];
      if (allowed.includes(req.user.email) && !students.includes(req.user.email)) students.push(req.user.email);
      const stranger = students.find((e) => !allowed.includes(e));
      if (stranger) return res.status(400).json({ error: `${stranger.slice(0, 100)} wasn't a student on this match.`, field: "students" });
      if (students.length === 0) return res.status(400).json({ error: "Choose at least one student who took part.", field: "students" });
      const faculty = await cleanFaculty(body, req.user);
      if (faculty.error) return res.status(400).json({ error: faculty.error, field: "faculty" });

      const created = await db.query(
        `INSERT INTO outcomes (match_id, summary, completed_on, links, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [matchId, content.summary, content.completedOn, JSON.stringify(content.links), req.user.id],
      );
      const id = created.rows[0].id;
      await db.query(
        `INSERT INTO outcome_participants (outcome_id, email, role)
         SELECT $1::int, unnest($2::text[]), 'faculty' UNION ALL SELECT $1::int, unnest($3::text[]), 'student'`,
        [id, faculty.emails, students],
      );
      res.status(201).json({ outcome: await loadOwn(req.user, id) });
    } catch (error) {
      next(error);
    }
  });

  // Showcased outcomes for anyone; the full view for participants; 404 otherwise (R3-15).
  router.get("/:id", async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(404).json({ error: "Outcome not found." });
      const viewer = await auth.getSessionUser(req);
      if (viewer) {
        const own = await loadOwn(viewer, id);
        if (own) return res.json({ outcome: own });
      }
      const rows = await queryOutcomes(`o.id = $1 AND ${SHOWCASE_SQL}`, [id]);
      if (!rows[0]) return res.status(404).json({ error: "Outcome not found." });
      res.json({ outcome: toPublicOutcome(rows[0], await loadParticipants([id]), viewer) });
    } catch (error) {
      next(error);
    }
  });

  // Loads the viewer's own outcome, checks `allowed(outcome)`, runs `change`, and answers with it.
  function ownAction(allowed, change) {
    return async (req, res, next) => {
      try {
        const id = parseId(req.params.id);
        const outcome = id === null ? null : await loadOwn(req.user, id);
        if (!outcome) return res.status(404).json({ error: "Outcome not found." });
        const refusal = allowed(outcome, req);
        if (refusal) return res.status(refusal.status || 409).json({ error: refusal.error, field: refusal.field });
        await change(req, outcome);
        res.json({ outcome: await loadOwn(req.user, id) });
      } catch (error) {
        next(error);
      }
    };
  }

  // Any participant edits the summary, date and links. That clears the confirmation, so what is
  // public is always what a faculty member confirmed (R3-15).
  router.put(
    "/:id",
    auth.requireAuth,
    ownAction(
      (o, req) => {
        const { error, field } = validateContent(req.body || {}, config);
        return error ? { status: 400, error, field } : null;
      },
      async (req, o) => {
        const { content } = validateContent(req.body, config);
        await db.query(
          `UPDATE outcomes SET summary = $2, completed_on = $3, links = $4, confirmed_by = NULL, confirmed_at = NULL,
             updated_at = now() WHERE id = $1`,
          [o.id, content.summary, content.completedOn, JSON.stringify(content.links)],
        );
      },
    ),
  );

  const facultyOnly = (o) =>
    o.you.role === "faculty" ? null : { status: 403, error: "Only a verified faculty member on this outcome can confirm it." };

  // R3-15: a participating verified faculty member confirms it, or takes the confirmation back.
  router.post(
    "/:id/confirm",
    auth.requireVerifiedFaculty,
    ownAction(
      (o) => facultyOnly(o) || (o.you.canConfirm ? null : { error: "It is already confirmed." }),
      (req, o) => db.query("UPDATE outcomes SET confirmed_by = $2, confirmed_at = now() WHERE id = $1", [o.id, req.user.id]),
    ),
  );

  router.post(
    "/:id/unconfirm",
    auth.requireVerifiedFaculty,
    ownAction(
      (o) => facultyOnly(o) || (o.you.canUnconfirm ? null : { error: "It isn't confirmed." }),
      (req, o) => db.query("UPDATE outcomes SET confirmed_by = NULL, confirmed_at = NULL WHERE id = $1", [o.id]),
    ),
  );

  // R3-18: a student chooses whether it appears on their own profile. Only their own row changes.
  router.put(
    "/:id/show-on-profile",
    auth.requireAuth,
    ownAction(
      (o, req) => {
        if (o.you.role !== "student") return { status: 403, error: "Only students choose this, for their own profile." };
        return typeof req.body?.show === "boolean" ? null : { status: 400, error: "Choose whether to show it on your profile." };
      },
      (req, o) =>
        db.query("UPDATE outcome_participants SET show_on_profile = $3 WHERE outcome_id = $1 AND email = $2 AND role = 'student'", [
          o.id,
          req.user.email,
          req.body.show,
        ]),
    ),
  );

  return router;
}

// R3-17, R3-20: a student's profile, so visitors can reach the people behind completed work.
// Visible to signed-in users, and to visitors only if the student chose public display. Never
// shows matches (R3-22).
function createStudentsRouter({ db, auth }) {
  const router = express.Router();
  router.get("/:id", async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      const viewer = await auth.getSessionUser(req);
      const result =
        id === null
          ? { rows: [] }
          : await db.query(
              `SELECT u.id, sp.display_name, sp.public_profile_choice FROM users u JOIN student_profiles sp ON sp.user_id = u.id
               WHERE u.id = $1 AND NOT u.is_verified_faculty ${viewer ? "" : "AND sp.public_profile_choice IS TRUE"}`,
              [id],
            );
      const row = result.rows[0];
      if (!row) return res.status(404).json({ error: "Student not found." });
      res.json({ student: { id: row.id, displayName: row.display_name, publiclyVisible: row.public_profile_choice === true } });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

module.exports = { createOutcomesRouter, createStudentsRouter, SHOWCASE_SQL, cleanLinks };
