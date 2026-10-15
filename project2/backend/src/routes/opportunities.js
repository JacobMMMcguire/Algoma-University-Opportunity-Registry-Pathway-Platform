const express = require("express");
const { RESEARCH_AREA_GROUPS, describeInquiryPreference } = require("../catalog");
const { likePattern, parseId } = require("../validation");
const { isPubliclyVisibleFaculty, visibleSupervisorSql } = require("../visibility");
const { parseFilters } = require("./projects");

// A partner submission's supervisors, as `os`, `users` and `faculty_profiles`.
const SUPERVISOR_JOIN = `FROM opportunity_supervisors os
  JOIN users ON users.id = os.faculty_user_id
  JOIN faculty_profiles ON faculty_profiles.user_id = users.id`;

// R2-07, R2-08, R2-10: an opportunity `ps` is discoverable while it has a supervisor this
// viewer can see; `extra` narrows which supervisor (for the faculty and search filters).
function hasVisibleSupervisor(viewer, extra = "") {
  return `EXISTS (SELECT 1 ${SUPERVISOR_JOIN}
    WHERE os.submission_id = ps.id AND ${visibleSupervisorSql(viewer)} ${extra})`;
}

// The same filters as project discovery (R1-20), so one URL filters both lists. Industry
// opportunities have no student level or term, so filtering by either leaves none.
function filterSql(filters, params, viewer) {
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const clauses = [];
  if (filters.area) clauses.push(`${add(filters.area)} = ANY(ps.research_areas)`);
  if (filters.level || filters.term) clauses.push("false");
  if (filters.facultyId) clauses.push(hasVisibleSupervisor(viewer, `AND users.id = ${add(filters.facultyId)}`));
  if (filters.q) {
    const pattern = add(likePattern(filters.q));
    clauses.push(`(ps.title ILIKE ${pattern} OR ps.description ILIKE ${pattern} OR ps.organisation ILIKE ${pattern}
      OR array_to_string(ps.research_areas, ' ') ILIKE ${pattern}
      OR ${hasVisibleSupervisor(viewer, `AND faculty_profiles.display_name ILIKE ${pattern}`)})`);
  }
  return clauses.map((clause) => `AND ${clause}`).join("\n");
}

// The supervisors of these opportunities that this viewer may see (R2-22).
async function loadSupervisors(db, viewer, ids) {
  const result = await db.query(
    `SELECT os.submission_id, users.id, users.email, users.is_verified_faculty, users.public_profile_choice,
            faculty_profiles.display_name, faculty_profiles.inquiry_preference
     ${SUPERVISOR_JOIN}
     WHERE os.submission_id = ANY($1::int[]) AND ${visibleSupervisorSql(viewer)}
     ORDER BY lower(faculty_profiles.display_name), users.id`,
    [ids],
  );
  return result.rows;
}

// What students and visitors see. Never the partner's contact details (R2-05), capacity, or
// engagement state and who is engaging (R2-15): those exist only in the faculty view.
function toOpportunity(row, supervisors) {
  return {
    id: row.id,
    kind: "industry",
    title: row.title,
    description: row.description,
    researchAreas: row.research_areas,
    organisation: row.organisation,
    supervisors: supervisors.map((s) => ({ id: s.id, displayName: s.display_name })),
    publiclyVisible: supervisors.some(isPubliclyVisibleFaculty),
    createdAt: row.created_at,
  };
}

// R2-23: the detail page's Contact goes to a supervising faculty member's university email,
// following their inquiry preference as on a project page (R1-22). Never to the partner.
function toOpportunityDetail(row, supervisors) {
  const opportunity = toOpportunity(row, supervisors);
  opportunity.supervisors = supervisors.map((s) => ({
    id: s.id,
    displayName: s.display_name,
    inquiryPreference: describeInquiryPreference(s.inquiry_preference),
    contact: s.inquiry_preference !== "not_accepting" ? { email: s.email } : null,
  }));
  return opportunity;
}

// Filter choices with counts, from the opportunities this viewer can see before filtering.
function facetsFor(rows, supervisors) {
  const areaCounts = new Map();
  for (const area of rows.flatMap((row) => row.research_areas)) areaCounts.set(area, (areaCounts.get(area) || 0) + 1);
  const facultyCounts = new Map();
  for (const s of supervisors) {
    const entry = facultyCounts.get(s.id) || { id: s.id, displayName: s.display_name, count: 0 };
    entry.count += 1;
    facultyCounts.set(s.id, entry);
  }
  return {
    areas: RESEARCH_AREA_GROUPS.map((g) => ({
      group: g.group,
      areas: g.areas.filter((area) => areaCounts.has(area)).map((area) => ({ value: area, count: areaCounts.get(area) })),
    })).filter((g) => g.areas.length > 0),
    levels: [],
    terms: [],
    faculty: [...facultyCounts.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
  };
}

const COLUMNS = "ps.id, ps.title, ps.description, ps.research_areas, ps.organisation, ps.created_at";

// R2-21, R2-22: student discovery of industry opportunities with faculty support. Takes the
// same query parameters as GET /api/projects (R1-20).
function createOpportunitiesRouter({ db, auth }) {
  const router = express.Router();

  router.get("/", async (req, res, next) => {
    try {
      const { filters, error } = parseFilters(req.query);
      if (error) return res.status(400).json({ error });
      const viewer = await auth.getSessionUser(req);
      const visible = await db.query(`SELECT ${COLUMNS} FROM partner_submissions ps WHERE ${hasVisibleSupervisor(viewer)}`);
      const params = [];
      const result = await db.query(
        `SELECT ${COLUMNS} FROM partner_submissions ps
         WHERE ${hasVisibleSupervisor(viewer)}
         ${filterSql(filters, params, viewer)}
         ORDER BY lower(ps.title), ps.id`,
        params,
      );
      const supervisors = await loadSupervisors(db, viewer, visible.rows.map((row) => row.id));
      const supervisorsOf = (row) => supervisors.filter((s) => s.submission_id === row.id);
      res.json({
        opportunities: result.rows.map((row) => toOpportunity(row, supervisorsOf(row))),
        filters: facetsFor(visible.rows, supervisors),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: "Invalid opportunity id." });
      const viewer = await auth.getSessionUser(req);
      const result = await db.query(
        `SELECT ${COLUMNS} FROM partner_submissions ps WHERE ps.id = $1 AND ${hasVisibleSupervisor(viewer)}`,
        [id],
      );
      // Same 404 whether it's missing, awaiting a supervisor, or not visible to this viewer.
      if (!result.rows[0]) return res.status(404).json({ error: "Opportunity not found." });
      const supervisors = await loadSupervisors(db, viewer, [id]);
      res.json({ opportunity: toOpportunityDetail(result.rows[0], supervisors) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createOpportunitiesRouter };
