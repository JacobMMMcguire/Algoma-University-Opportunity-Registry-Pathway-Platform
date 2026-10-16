const express = require("express");
const {
  ENGAGEMENT_STATES,
  OPPORTUNITY_STATES,
  PARTNER_CAPACITIES,
  describeCapacity,
  describeEngagement,
} = require("../catalog");
const { cleanAreas, cleanText, parseId } = require("../validation");
const { isPubliclyVisibleFaculty, visibleSupervisorSql } = require("../visibility");

const LIMITS = {
  organisation: 150,
  contactName: 100,
  contactEmail: 254,
  title: 150,
  description: 1000,
  researchAreas: 10,
};

// The address shape browsers accept for <input type="email">, so the form and the server agree.
const EMAIL_PATTERN =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

// R2-18: which subscribers a new submission `s` notifies, with their subscription as `fs` and
// account as `users`. Revoked faculty are never notified. Shared with the fixture seed.
const SUBSCRIBER_MATCH_SQL = `users.is_verified_faculty
  AND (fs.mode = 'all' OR (fs.mode = 'areas' AND fs.research_areas && s.research_areas))`;

// Control characters (other than tab and newlines) have no place in a form field, and Postgres
// rejects NUL outright.
function stripControl(value) {
  return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "") : value;
}

// R2-01, R2-04, R2-06: checks every field and reports every problem at once, so a partner who
// filled the form in once can fix it all in one go. Returns { submission } or { errors }, each
// error { field, message }. Only these fields are read: state, ids, or anything else in the
// body is ignored (R2-03).
function validateSubmission(body) {
  const errors = [];
  const fail = (field, message) => errors.push({ field, message });

  const organisation = cleanText(stripControl(body.organisation));
  if (!organisation) fail("organisation", "Enter your organisation's name.");
  else if (organisation.length > LIMITS.organisation) {
    fail("organisation", `Organisation name must be ${LIMITS.organisation} characters or fewer.`);
  }

  const contactName = cleanText(stripControl(body.contactName));
  if (!contactName) fail("contactName", "Enter the name of the person faculty should contact.");
  else if (contactName.length > LIMITS.contactName) {
    fail("contactName", `Contact name must be ${LIMITS.contactName} characters or fewer.`);
  }

  const contactEmail = typeof body.contactEmail === "string" ? body.contactEmail.trim() : "";
  if (!contactEmail) fail("contactEmail", "Enter an email address faculty can reach you at.");
  else if (contactEmail.length > LIMITS.contactEmail || !EMAIL_PATTERN.test(contactEmail)) {
    fail("contactEmail", "Enter the email address in the form name@example.com.");
  }

  const title = cleanText(stripControl(body.title));
  if (!title) fail("title", "Enter a short title for the project idea.");
  else if (title.length > LIMITS.title) fail("title", `Title must be ${LIMITS.title} characters or fewer.`);

  const description = typeof body.description === "string" ? stripControl(body.description).trim() : "";
  if (!description) fail("description", "Describe the project idea in a few sentences.");
  else if (description.length > LIMITS.description) {
    fail("description", `Description must be ${LIMITS.description} characters or fewer.`);
  }

  // Areas help faculty find the idea but are optional: a partner may not know the academic terms.
  let researchAreas = [];
  const rawAreas = body.researchAreas ?? [];
  if (!Array.isArray(rawAreas)) fail("researchAreas", "Choose areas from the list.");
  else if (rawAreas.some((a) => !(typeof a === "string" && !a.trim()))) {
    const cleaned = cleanAreas(rawAreas, { max: LIMITS.researchAreas });
    if (cleaned.error) fail("researchAreas", cleaned.error);
    else researchAreas = cleaned.areas;
  }

  const capacity = PARTNER_CAPACITIES.find((o) => o.value === body.capacity)?.value;
  if (!capacity) fail("capacity", "Choose how many student teams you could work with, or \"Not sure yet\".");

  if (errors.length) return { errors };
  return { submission: { organisation, contactName, contactEmail, title, description, researchAreas, capacity } };
}

// The faculty and staff view: everything, including partner contact details (R2-05), capacity
// (R2-06), state (R2-08), willing supervisors and their count (R2-11) and engagement (R2-13).
// Student-facing views are built in routes/opportunities.js and never include these extras.
function toReviewerOpportunity(row, supervisors, viewer) {
  const state = supervisors.length ? "supervised" : "awaiting_supervisor";
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    researchAreas: row.research_areas,
    organisation: row.organisation,
    capacity: describeCapacity(row.capacity),
    state: { value: state, label: OPPORTUNITY_STATES[state] },
    supervisorCount: supervisors.length,
    supervisors: supervisors.map((s) => ({ id: s.id, displayName: s.display_name, publiclyVisible: isPubliclyVisibleFaculty(s) })),
    viewerIsSupervisor: supervisors.some((s) => s.id === viewer.id),
    engagement: {
      ...describeEngagement(row.engagement_state),
      by: row.engagement_user_id ? { id: row.engagement_user_id, displayName: row.engagement_by_name } : null,
      updatedAt: row.engagement_updated_at,
    },
    contact: { name: row.contact_name, email: row.contact_email },
    createdAt: row.created_at,
  };
}

// Opportunities (all of them, or the one with `id`) in the faculty and staff shape.
async function loadForReviewers(db, viewer, id = null) {
  const rows = (
    await db.query(
      `SELECT ps.*, coalesce(efp.display_name, eu.email) AS engagement_by_name
       FROM partner_submissions ps
       LEFT JOIN users eu ON eu.id = ps.engagement_user_id
       LEFT JOIN faculty_profiles efp ON efp.user_id = eu.id
       WHERE $1::int IS NULL OR ps.id = $1
       ORDER BY ps.created_at DESC, ps.id DESC`,
      [id],
    )
  ).rows;
  // Supervisors who count are exactly the ones signed-in students see (R2-07, R2-10).
  const supervisors = (
    await db.query(
      `SELECT os.submission_id, users.id, users.is_verified_faculty, users.public_profile_choice,
              faculty_profiles.display_name
       FROM opportunity_supervisors os
       JOIN users ON users.id = os.faculty_user_id
       LEFT JOIN faculty_profiles ON faculty_profiles.user_id = users.id
       WHERE os.submission_id = ANY($1::int[]) AND ${visibleSupervisorSql(viewer)}
       ORDER BY os.created_at, users.id`,
      [rows.map((row) => row.id)],
    )
  ).rows;
  return rows.map((row) =>
    toReviewerOpportunity(
      row,
      supervisors.filter((s) => s.submission_id === row.id),
      viewer,
    ),
  );
}

// R2-01 to R2-14, R2-24: anyone can submit a project idea, with no account; verified faculty
// and staff read them; only verified faculty record willingness to supervise or partner
// engagement, always as themselves (req.user), never as anyone named in the request.
function createPartnerSubmissionsRouter({ db, auth }) {
  const router = express.Router();

  // R2-01: public, no sign-in. R2-02: a new submission has no supervisors, so it is awaiting
  // a supervisor and invisible to students. R2-18: matching subscribers are notified in the
  // same statement, so a submission and its notifications are saved together or not at all.
  router.post("/", async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
      const { submission, errors } = validateSubmission(body);
      // R2-04: nothing is stored unless every field is valid.
      if (errors) {
        return res.status(400).json({
          error: `Your project idea wasn't sent. ${errors.map((e) => e.message).join(" ")}`,
          errors,
          field: errors[0].field,
        });
      }
      const result = await db.query(
        `WITH s AS (
           INSERT INTO partner_submissions
             (organisation, contact_name, contact_email, title, description, research_areas, capacity)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, title, research_areas, created_at
         ), notified AS (
           INSERT INTO notifications (user_id, submission_id)
           SELECT fs.user_id, s.id FROM s
           JOIN faculty_subscriptions fs ON true
           JOIN users ON users.id = fs.user_id
           WHERE ${SUBSCRIBER_MATCH_SQL}
           ON CONFLICT DO NOTHING
         )
         SELECT id, title, created_at FROM s`,
        [
          submission.organisation,
          submission.contactName,
          submission.contactEmail,
          submission.title,
          submission.description,
          submission.researchAreas,
          submission.capacity,
        ],
      );
      const row = result.rows[0];
      res.status(201).json({
        submission: {
          id: row.id,
          title: row.title,
          state: { value: "awaiting_supervisor", label: OPPORTUNITY_STATES.awaiting_supervisor },
          createdAt: row.created_at,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // R2-19: every opportunity, newest first, whether or not the viewer was notified about it.
  router.get("/", auth.requireVerifiedFacultyOrStaff, async (req, res, next) => {
    try {
      res.json({
        submissions: await loadForReviewers(db, req.user),
        capacities: PARTNER_CAPACITIES,
        engagementStates: ENGAGEMENT_STATES,
        limits: LIMITS,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", auth.requireVerifiedFacultyOrStaff, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: "Invalid submission id." });
      const [submission] = await loadForReviewers(db, req.user, id);
      if (!submission) return res.status(404).json({ error: "Submission not found." });
      res.json({ submission, engagementStates: ENGAGEMENT_STATES });
    } catch (error) {
      next(error);
    }
  });

  // Runs `change` for an existing opportunity, then responds with its updated faculty view.
  async function updateOpportunity(req, res, next, change) {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: "Invalid submission id." });
      const exists = await db.query("SELECT 1 FROM partner_submissions WHERE id = $1", [id]);
      if (exists.rows.length === 0) return res.status(404).json({ error: "Submission not found." });
      await change(id);
      const [submission] = await loadForReviewers(db, req.user, id);
      res.json({ submission });
    } catch (error) {
      next(error);
    }
  }

  // R2-07, R2-09: record willingness. Any number of faculty can; repeating it changes nothing.
  // Naming the faculty member to students publishes the opportunity with their name on it, so
  // this needs the public-display choice (R1-05, either answer) and a profile, like publishing
  // a project (R1-13, R1-21).
  router.put("/:id/willingness", auth.requirePublicProfileChoice, async (req, res, next) => {
    try {
      const profile = await db.query("SELECT 1 FROM faculty_profiles WHERE user_id = $1", [req.user.id]);
      if (profile.rows.length === 0) {
        return res.status(409).json({
          error: "Write your faculty profile first, so students can see who supervises this opportunity.",
          code: "faculty_profile_required",
        });
      }
      await updateOpportunity(req, res, next, (id) =>
        db.query(
          `INSERT INTO opportunity_supervisors (submission_id, faculty_user_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [id, req.user.id],
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  // R2-10: withdraw only your own willingness. Whether the opportunity stays visible follows
  // from whoever else remains.
  router.delete("/:id/willingness", auth.requireVerifiedFaculty, (req, res, next) =>
    updateOpportunity(req, res, next, (id) =>
      db.query("DELETE FROM opportunity_supervisors WHERE submission_id = $1 AND faculty_user_id = $2", [id, req.user.id]),
    ),
  );

  // R2-12 to R2-14: any verified faculty member can record the engagement state, and is shown
  // as the one who recorded it. It locks nothing.
  router.put("/:id/engagement", auth.requireVerifiedFaculty, (req, res, next) => {
    const state = ENGAGEMENT_STATES.find((o) => o.value === req.body?.state)?.value;
    if (!state) return res.status(400).json({ error: "Choose an engagement state from the list.", field: "state" });
    return updateOpportunity(req, res, next, (id) =>
      db.query(
        `UPDATE partner_submissions SET engagement_state = $2, engagement_user_id = $3, engagement_updated_at = now()
         WHERE id = $1`,
        [id, state, req.user.id],
      ),
    );
  });

  return router;
}

module.exports = { createPartnerSubmissionsRouter, validateSubmission, SUBSCRIBER_MATCH_SQL, LIMITS };
