const express = require("express");
const { cleanAreas, cleanText } = require("../validation");
const { PUBLIC_FACULTY_SQL, isPubliclyVisibleFaculty } = require("../visibility");

const LIMITS = {
  title: 150,
  description: 1000,
  researchAreas: 10,
  researchArea: 60,
  studentLevel: 60,
  targetTerm: 60,
  prerequisites: 1000,
};

// Offered as suggestions in the form; any short text is accepted ("where relevant").
const STUDENT_LEVEL_SUGGESTIONS = [
  "Any level",
  "First- or second-year undergraduate",
  "Third- or fourth-year undergraduate",
  "Graduate",
];

// What everyone sees: no email or account details. `faculty.displayName` is null when the
// owner hasn't written a profile yet.
function toProject(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    researchAreas: row.research_areas,
    studentLevel: row.student_level,
    targetTerm: row.target_term,
    prerequisites: row.prerequisites,
    status: row.status,
    faculty: { id: row.faculty_user_id, displayName: row.faculty_display_name },
    publiclyVisible: row.status === "published" && isPubliclyVisibleFaculty(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Optional free text: missing or blank is null, anything else must be a string within `max`.
function optionalText(value, max, label, { singleLine = true } = {}) {
  if (value === undefined || value === null) return { value: null };
  if (typeof value !== "string") return { error: `${label} must be text.` };
  const text = singleLine ? cleanText(value) : value.trim();
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

  const { areas: researchAreas, error: areasError } = cleanAreas(body.researchAreas, {
    max: LIMITS.researchAreas,
    maxLength: LIMITS.researchArea,
  });
  if (areasError) return { error: areasError, field: "researchAreas" };

  const level = optionalText(body.studentLevel, LIMITS.studentLevel, "Student level");
  if (level.error) return { error: level.error, field: "studentLevel" };

  const targetTerm = cleanText(body.targetTerm);
  if (!targetTerm) return { error: "Enter the target academic term, for example Winter 2027.", field: "targetTerm" };
  if (targetTerm.length > LIMITS.targetTerm) {
    return { error: `Target term must be ${LIMITS.targetTerm} characters or fewer.`, field: "targetTerm" };
  }

  const prereq = optionalText(body.prerequisites, LIMITS.prerequisites, "Background note", { singleLine: false });
  if (prereq.error) return { error: prereq.error, field: "prerequisites" };

  return {
    project: {
      title,
      description,
      researchAreas,
      studentLevel: level.value,
      targetTerm,
      prerequisites: prereq.value,
    },
  };
}

// Positive integer ids within Postgres INTEGER range; anything else is null.
function parseId(value) {
  return /^\d{1,9}$/.test(value) ? Number(value) : null;
}

// Projects joined to their owner's account (for the visibility rule) and profile (for the name).
// `source` is `projects` or the name of a CTE holding rows just written.
function projectQuery(source) {
  return `SELECT p.*, users.is_verified_faculty, users.public_profile_choice,
            faculty_profiles.display_name AS faculty_display_name
          FROM ${source} p
          JOIN users ON users.id = p.faculty_user_id
          LEFT JOIN faculty_profiles ON faculty_profiles.user_id = p.faculty_user_id`;
}

// R1-12 and R1-14: discovery shows published projects only. Logged-out visitors see those of
// faculty who allowed public display; signed-in users also see signed-in-only ones. Revoked
// faculty's projects are hidden from everyone.
function discoverableFilter(viewer) {
  return `p.status = 'published' AND users.is_verified_faculty ${viewer ? "" : `AND ${PUBLIC_FACULTY_SQL}`}`;
}

// R1-11 to R1-16: faculty create, edit, publish and close their own projects; everyone else
// reads published ones subject to the visibility rule. Every write names the owner as req.user
// in the SQL itself, so another faculty member's project id simply matches nothing (404).
function createProjectsRouter({ db, auth }) {
  const router = express.Router();

  router.get("/mine", auth.requireVerifiedFaculty, async (req, res, next) => {
    try {
      const result = await db.query(
        `${projectQuery("projects")}
         WHERE p.faculty_user_id = $1
         ORDER BY p.updated_at DESC, p.id DESC`,
        [req.user.id],
      );
      res.json({
        projects: result.rows.map(toProject),
        limits: LIMITS,
        studentLevelSuggestions: STUDENT_LEVEL_SUGGESTIONS,
      });
    } catch (error) {
      next(error);
    }
  });

  // R1-11, R1-12: a new project is always a draft, whatever the body says.
  router.post("/", auth.requireVerifiedFaculty, async (req, res, next) => {
    try {
      const { project, error, field } = validateProject(req.body || {});
      if (error) return res.status(400).json({ error, field });
      const result = await db.query(
        `WITH saved AS (
           INSERT INTO projects
             (faculty_user_id, title, description, research_areas, student_level, target_term, prerequisites, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')
           RETURNING *
         ) ${projectQuery("saved")}`,
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
      res.status(201).json({ project: toProject(result.rows[0]) });
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
        `WITH saved AS (
           UPDATE projects SET
             title = $3, description = $4, research_areas = $5, student_level = $6,
             target_term = $7, prerequisites = $8, updated_at = now()
           WHERE id = $1 AND faculty_user_id = $2
           RETURNING *
         ) ${projectQuery("saved")}`,
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
      res.json({ project: toProject(result.rows[0]) });
    } catch (error) {
      next(error);
    }
  });

  async function setStatus(req, res, next, status) {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: "Invalid project id." });
      const result = await db.query(
        `WITH saved AS (
           UPDATE projects SET status = $3, updated_at = now()
           WHERE id = $1 AND faculty_user_id = $2
           RETURNING *
         ) ${projectQuery("saved")}`,
        [id, req.user.id, status],
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Project not found." });
      res.json({ project: toProject(result.rows[0]) });
    } catch (error) {
      next(error);
    }
  }

  // R1-13: explicit publish, also used to reopen a closed project. R1-05: needs the
  // public-profile choice to have been made (either answer).
  router.post("/:id/publish", auth.requirePublicProfileChoice, (req, res, next) =>
    setStatus(req, res, next, "published"),
  );

  // R1-15: withdraw from discovery. Nothing is deleted, so the record and its history stay.
  router.post("/:id/close", auth.requireVerifiedFaculty, (req, res, next) => setStatus(req, res, next, "closed"));

  // `?facultyId=N` narrows the list to one faculty member, e.g. on their profile page.
  router.get("/", async (req, res, next) => {
    try {
      const params = [];
      let byFaculty = "";
      if (req.query.facultyId !== undefined) {
        const facultyId = parseId(req.query.facultyId);
        if (facultyId === null) return res.status(400).json({ error: "Invalid faculty id." });
        params.push(facultyId);
        byFaculty = "AND p.faculty_user_id = $1";
      }
      const viewer = await auth.getSessionUser(req);
      const result = await db.query(
        `${projectQuery("projects")}
         WHERE ${discoverableFilter(viewer)} ${byFaculty}
         ORDER BY lower(p.title), p.id`,
        params,
      );
      res.json({ projects: result.rows.map(toProject) });
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
        `${projectQuery("projects")}
         WHERE p.id = $1 AND ((${discoverableFilter(viewer)}) OR p.faculty_user_id = $2)`,
        [id, viewer ? viewer.id : null],
      );
      // Same 404 whether the project is missing, a draft, closed, or not visible to this viewer.
      if (!result.rows[0]) return res.status(404).json({ error: "Project not found." });
      res.json({ project: toProject(result.rows[0]) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createProjectsRouter };
