const express = require("express");
const {
  LEVEL_FILTERS,
  RESEARCH_AREA_GROUPS,
  STUDENT_LEVELS,
  canonicalArea,
  canonicalTerm,
  compareTerms,
  describeInquiryPreference,
} = require("../catalog");
const { currentRunJoin, describeLifecycle, logRunChange, parseDate } = require("../lifecycle");
const { cleanAreas, cleanText, likePattern, parseId } = require("../validation");
const { PUBLIC_FACULTY_SQL, isPubliclyVisibleFaculty } = require("../visibility");

const LIMITS = {
  title: 150,
  description: 1000,
  researchAreas: 10,
  prerequisites: 1000,
  search: 100,
};

// What everyone sees in lists: no email or account details. `faculty.displayName` is null
// only for an owner previewing their own project before writing a profile.
// `status` keeps its R1 meaning (draft, published, or closed = withdrawn); `lifecycle` is the
// current run's term, deadline and state (R3-08 to R3-11).
function toProject(row) {
  const lifecycle = describeLifecycle(row);
  const status = row.status === "draft" ? "draft" : lifecycle.state === "withdrawn" ? "closed" : "published";
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    researchAreas: row.research_areas,
    studentLevel: row.student_level,
    targetTerm: row.run_term || row.target_term,
    prerequisites: row.prerequisites,
    status,
    lifecycle,
    faculty: { id: row.faculty_user_id, displayName: row.faculty_display_name },
    publiclyVisible: status === "published" && lifecycle.available && isPubliclyVisibleFaculty(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// The project page adds the faculty member's inquiry preference and, unless they aren't
// accepting inquiries, their university email for the Contact action (R1-22). Only viewers who
// may see the project ever reach this.
function toProjectDetail(row) {
  const project = toProject(row);
  const preference = row.faculty_inquiry_preference;
  project.faculty.inquiryPreference = preference ? describeInquiryPreference(preference) : null;
  project.contact =
    project.status === "published" && project.lifecycle.available && preference && preference !== "not_accepting"
      ? { email: row.faculty_email }
      : null;
  return project;
}

// Optional free text: missing or blank is null, anything else must be a string within `max`.
function optionalText(value, max, label) {
  if (value === undefined || value === null) return { value: null };
  if (typeof value !== "string") return { error: `${label} must be text.` };
  const text = value.trim();
  if (text.length > max) return { error: `${label} must be ${max} characters or fewer.` };
  return { value: text || null };
}

// Returns { project } with normalized fields, or { error, field } describing the first problem.
// Only editable content is read: status, ids and owner in the body are ignored (R1-12, R1-16).
function validateProject(body) {
  const title = cleanText(body.title);
  if (!title) return { error: "Enter a project title.", field: "title" };
  if (title.length > LIMITS.title) {
    return { error: `Title must be ${LIMITS.title} characters or fewer.`, field: "title" };
  }

  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description) return { error: "Enter a short description of the project.", field: "description" };
  if (description.length > LIMITS.description) {
    return { error: `Description must be ${LIMITS.description} characters or fewer.`, field: "description" };
  }

  const { areas: researchAreas, error: areasError } = cleanAreas(body.researchAreas, { max: LIMITS.researchAreas });
  if (areasError) return { error: areasError, field: "researchAreas" };

  let studentLevel = null;
  const rawLevel = typeof body.studentLevel === "string" ? body.studentLevel.trim() : body.studentLevel;
  if (rawLevel !== undefined && rawLevel !== null && rawLevel !== "") {
    studentLevel = STUDENT_LEVELS.find((level) => level === rawLevel) || null;
    if (!studentLevel) return { error: "Choose a student level from the list, or leave it unset.", field: "studentLevel" };
  }

  const targetTerm = canonicalTerm(body.targetTerm);
  if (!targetTerm) return { error: "Choose the target term's season and year.", field: "targetTerm" };

  const prereq = optionalText(body.prerequisites, LIMITS.prerequisites, "Background note");
  if (prereq.error) return { error: prereq.error, field: "prerequisites" };

  // R3-08: optional deadline. Left out means "leave it as it is"; null or "" clears it.
  let deadline;
  if (body.deadline === null || body.deadline === "") deadline = null;
  else if (body.deadline !== undefined) {
    deadline = parseDate(body.deadline);
    if (!deadline) return { error: "Enter the deadline as a date, or leave it empty.", field: "deadline" };
  }

  return { project: { title, description, researchAreas, studentLevel, targetTerm, prerequisites: prereq.value, deadline } };
}

// R1-20 filters from the query string. Returns { filters } or { error }. All given filters must
// match (AND); an area matches if it is any one of the project's areas.
function parseFilters(query) {
  const filters = {};
  if (query.area !== undefined && query.area !== "") {
    filters.area = canonicalArea(query.area);
    if (!filters.area) return { error: "Unknown research area." };
  }
  if (query.level !== undefined && query.level !== "") {
    filters.level = LEVEL_FILTERS.find((level) => level.value === query.level);
    if (!filters.level) return { error: "Unknown student level." };
  }
  if (query.term !== undefined && query.term !== "") {
    filters.term = cleanText(query.term);
    if (!filters.term || filters.term.length > 60) return { error: "Unknown term." };
  }
  if (query.facultyId !== undefined && query.facultyId !== "") {
    filters.facultyId = parseId(query.facultyId);
    if (filters.facultyId === null) return { error: "Invalid faculty id." };
  }
  if (query.q !== undefined) {
    const q = cleanText(query.q);
    if (q === null || q.length > LIMITS.search) return { error: `Search text must be ${LIMITS.search} characters or fewer.` };
    if (q) filters.q = q;
  }
  return { filters };
}

// Adds each filter as an AND clause, appending its values to `params`.
function filterSql(filters, params) {
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const clauses = [];
  if (filters.area) clauses.push(`${add(filters.area)} = ANY(p.research_areas)`);
  if (filters.level) clauses.push(`p.student_level = ANY(${add(filters.level.matches)}::text[])`);
  if (filters.term) clauses.push(`lower(p.target_term) = lower(${add(filters.term)})`);
  if (filters.facultyId) clauses.push(`p.faculty_user_id = ${add(filters.facultyId)}`);
  if (filters.q) {
    const pattern = add(likePattern(filters.q));
    clauses.push(`(p.title ILIKE ${pattern} OR p.description ILIKE ${pattern}
      OR coalesce(p.prerequisites, '') ILIKE ${pattern} OR faculty_profiles.display_name ILIKE ${pattern}
      OR array_to_string(p.research_areas, ' ') ILIKE ${pattern})`);
  }
  return clauses.map((clause) => `AND ${clause}`).join("\n");
}

// The choices each filter offers, with counts, taken from the projects this viewer can see
// before filtering, so options never reveal hidden projects and never lead to zero results.
function facetsFor(rows) {
  const count = (values) => {
    const counts = new Map();
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
    return counts;
  };
  const areaCounts = count(rows.flatMap((row) => row.research_areas));
  const termCounts = count(rows.map((row) => row.target_term));
  const facultyCounts = new Map();
  for (const row of rows) {
    const entry = facultyCounts.get(row.faculty_user_id) || { id: row.faculty_user_id, displayName: row.faculty_display_name, count: 0 };
    entry.count += 1;
    facultyCounts.set(row.faculty_user_id, entry);
  }
  return {
    areas: RESEARCH_AREA_GROUPS.map((g) => ({
      group: g.group,
      areas: g.areas.filter((area) => areaCounts.has(area)).map((area) => ({ value: area, count: areaCounts.get(area) })),
    })).filter((g) => g.areas.length > 0),
    levels: LEVEL_FILTERS.map((level) => ({
      value: level.value,
      label: level.label,
      count: rows.filter((row) => level.matches.includes(row.student_level)).length,
    })).filter((level) => level.count > 0),
    terms: [...termCounts.keys()].sort(compareTerms).map((term) => ({ value: term, count: termCounts.get(term) })),
    faculty: [...facultyCounts.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
  };
}

// Projects joined to their owner's account (for the visibility rule and contact email) and
// profile (for the name and inquiry preference), and the current run as `run` (R3-08).
function projectQuery(config) {
  const source = "projects";
  return `SELECT p.*, run.*, users.is_verified_faculty, users.public_profile_choice, users.email AS faculty_email,
            faculty_profiles.display_name AS faculty_display_name,
            faculty_profiles.inquiry_preference AS faculty_inquiry_preference
          FROM ${source} p
          JOIN users ON users.id = p.faculty_user_id
          LEFT JOIN faculty_profiles ON faculty_profiles.user_id = p.faculty_user_id
          ${currentRunJoin(config, "project", "p")}`;
}

// R1-12 and R1-14: discovery shows published projects only. Logged-out visitors see those of
// faculty who allowed public display; signed-in users also see signed-in-only ones. Revoked
// faculty's projects are hidden from everyone. R1-21: a project is only shown when its owner
// has a profile to name and link to (publish also requires one).
// R3-19: and only while currently available, so expired, withdrawn, matched, completed and
// archived projects leave discovery.
function discoverableFilter(viewer) {
  return `p.status = 'published' AND run.lifecycle_state = 'open' AND ${visibleRecordFilter(viewer)}`;
}

// Who may see that a project exists at all, whatever its lifecycle state (R3-19 explains why an
// unavailable one isn't listed only to people who could have seen it).
function visibleRecordFilter(viewer) {
  return `p.status <> 'draft' AND users.is_verified_faculty AND faculty_profiles.user_id IS NOT NULL
          ${viewer ? "" : `AND ${PUBLIC_FACULTY_SQL}`}`;
}

// R1-11 to R1-16: faculty create, edit, publish and close their own projects; everyone else
// reads published ones subject to the visibility rule. Every write names the owner as req.user
// in the SQL itself, so another faculty member's project id simply matches nothing (404).
// R1-17 to R1-20: GET / is project discovery with filters.
function createProjectsRouter({ db, config, auth }) {
  const router = express.Router();

  // An owner's own project, in the response shape, or null.
  async function loadOwn(id, userId) {
    const result = await db.query(`${projectQuery(config)} WHERE p.id = $1 AND p.faculty_user_id = $2`, [id, userId]);
    return result.rows[0] || null;
  }

  // Keeps the current run's term (and deadline, when given) in step with the project form.
  async function saveRunSchedule(projectId, userId, { targetTerm, deadline }) {
    const run = await db.query(
      `UPDATE opportunity_runs r SET target_term = $2, deadline = CASE WHEN $3::boolean THEN $4::date ELSE r.deadline END
       WHERE r.id = (SELECT id FROM opportunity_runs WHERE project_id = $1 ORDER BY run_number DESC LIMIT 1)
       RETURNING r.id, coalesce(to_char(r.deadline, 'YYYY-MM-DD'), 'none') AS deadline`,
      [projectId, targetTerm, deadline !== undefined, deadline ?? null],
    );
    if (run.rows[0]) {
      await logRunChange(db, run.rows[0].id, "schedule", `${targetTerm}, deadline ${run.rows[0].deadline}`, userId);
    }
  }

  router.get("/mine", auth.requireVerifiedFaculty, async (req, res, next) => {
    try {
      const result = await db.query(
        `${projectQuery(config)}
         WHERE p.faculty_user_id = $1
         ORDER BY p.updated_at DESC, p.id DESC`,
        [req.user.id],
      );
      res.json({ projects: result.rows.map(toProject), limits: LIMITS });
    } catch (error) {
      next(error);
    }
  });

  // R1-11, R1-12: a new project is always a draft, whatever the body says.
  router.post("/", auth.requireVerifiedFaculty, async (req, res, next) => {
    try {
      const { project, error, field } = validateProject(req.body || {});
      if (error) return res.status(400).json({ error, field });
      // A database trigger gives the new project its first run (migration 005).
      const result = await db.query(
        `INSERT INTO projects
           (faculty_user_id, title, description, research_areas, student_level, target_term, prerequisites, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')
         RETURNING id`,
        [
          req.user.id,
          project.title,
          project.description,
          project.researchAreas,
          project.studentLevel,
          project.targetTerm,
          project.prerequisites,
        ],
      );
      const id = result.rows[0].id;
      await saveRunSchedule(id, req.user.id, project);
      res.status(201).json({ project: toProject(await loadOwn(id, req.user.id)) });
    } catch (error) {
      next(error);
    }
  });

  // R1-15: edit content only. Status changes go through publish and close.
  router.put("/:id", auth.requireVerifiedFaculty, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: "Invalid project id." });
      const { project, error, field } = validateProject(req.body || {});
      if (error) return res.status(400).json({ error, field });
      const result = await db.query(
        `UPDATE projects SET
           title = $3, description = $4, research_areas = $5, student_level = $6,
           target_term = $7, prerequisites = $8, updated_at = now()
         WHERE id = $1 AND faculty_user_id = $2
         RETURNING id`,
        [
          id,
          req.user.id,
          project.title,
          project.description,
          project.researchAreas,
          project.studentLevel,
          project.targetTerm,
          project.prerequisites,
        ],
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Project not found." });
      await saveRunSchedule(id, req.user.id, project);
      res.json({ project: toProject(await loadOwn(id, req.user.id)) });
    } catch (error) {
      next(error);
    }
  });

  // Publishing or closing also sets the current run's stored state: closing withdraws it, and
  // publishing a withdrawn project reopens it (R1-15, R3-13). Other states are left alone.
  async function setStatus(req, res, next, status) {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: "Invalid project id." });
      const result = await db.query(
        `UPDATE projects SET status = $3, updated_at = now()
         WHERE id = $1 AND faculty_user_id = $2
         RETURNING id`,
        [id, req.user.id, status],
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Project not found." });
      const [from, to] = status === "closed" ? ["open", "withdrawn"] : ["withdrawn", "open"];
      const run = await db.query(
        `UPDATE opportunity_runs SET state = $3, state_changed_by = $4, state_changed_at = now()
         WHERE id = (SELECT id FROM opportunity_runs WHERE project_id = $1 ORDER BY run_number DESC LIMIT 1)
           AND state = $2
         RETURNING id`,
        [id, from, to, req.user.id],
      );
      if (run.rows[0]) await logRunChange(db, run.rows[0].id, "state", `${from} to ${to}`, req.user.id);
      res.json({ project: toProject(await loadOwn(id, req.user.id)) });
    } catch (error) {
      next(error);
    }
  }

  // R1-13: explicit publish, also used to reopen a closed project. R1-05: needs the
  // public-profile choice to have been made (either answer). R1-21: needs a faculty profile,
  // so students can see who leads the project and open their profile.
  router.post("/:id/publish", auth.requirePublicProfileChoice, async (req, res, next) => {
    try {
      const profile = await db.query("SELECT 1 FROM faculty_profiles WHERE user_id = $1", [req.user.id]);
      if (profile.rows.length === 0) {
        return res.status(409).json({
          error: "Write your faculty profile before publishing, so students can see who leads this project.",
          code: "faculty_profile_required",
        });
      }
      await setStatus(req, res, next, "published");
    } catch (error) {
      next(error);
    }
  });

  // R1-15: withdraw from discovery. Nothing is deleted, so the record and its history stay.
  router.post("/:id/close", auth.requireVerifiedFaculty, (req, res, next) => setStatus(req, res, next, "closed"));

  // R1-19, R1-20: published projects this viewer may see, narrowed by ?area=, ?level=
  // (undergraduate|graduate), ?term=, ?facultyId= and ?q= (text search). `filters` lists the
  // choices for each filter with counts.
  router.get("/", async (req, res, next) => {
    try {
      const { filters, error } = parseFilters(req.query);
      if (error) return res.status(400).json({ error });
      const viewer = await auth.getSessionUser(req);
      const visible = await db.query(`${projectQuery(config)} WHERE ${discoverableFilter(viewer)}`);
      const params = [];
      const result = await db.query(
        `${projectQuery(config)}
         WHERE ${discoverableFilter(viewer)}
         ${filterSql(filters, params)}
         ORDER BY lower(p.title), p.id`,
        params,
      );
      res.json({ projects: result.rows.map(toProject), filters: facetsFor(visible.rows) });
    } catch (error) {
      next(error);
    }
  });

  // Owners can also open their own drafts and closed projects, to preview them.
  router.get("/:id", async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: "Invalid project id." });
      const viewer = await auth.getSessionUser(req);
      const result = await db.query(
        `${projectQuery(config)}
         WHERE p.id = $1 AND ((${discoverableFilter(viewer)}) OR p.faculty_user_id = $2)`,
        [id, viewer ? viewer.id : null],
      );
      if (!result.rows[0]) {
        // R3-19: a project this viewer could see, but which is no longer available, still gets a
        // 404 (so R1 links behave as before), plus why it was removed.
        const removed = await db.query(`${projectQuery(config)} WHERE p.id = $1 AND ${visibleRecordFilter(viewer)}`, [id]);
        if (removed.rows[0]) {
          return res.status(404).json({ error: "This project is no longer available.", removed: removedSummary(removed.rows[0]) });
        }
        // Same 404 whether the project is missing, a draft, or not visible to this viewer.
        return res.status(404).json({ error: "Project not found." });
      }
      res.json({ project: toProjectDetail(result.rows[0]) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

// What a 404 for an unavailable record says (R3-19): enough to recognise it and know why.
function removedSummary(row) {
  const lifecycle = describeLifecycle(row);
  return { id: row.id, title: row.title, lifecycle };
}

module.exports = { createProjectsRouter, parseFilters, removedSummary };
