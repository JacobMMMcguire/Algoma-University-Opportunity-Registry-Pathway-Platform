const express = require("express");
const { cleanAreas, cleanText, parseId } = require("../validation");
const { PUBLIC_FACULTY_SQL, isPubliclyVisibleFaculty } = require("../visibility");

// R1-09: the stored codes are internal. Students only ever see the label and explanation.
const INQUIRY_PREFERENCES = [
  {
    value: "open",
    label: "Open to general student inquiries",
    explanation: "Students are welcome to email about this faculty member's research, including ideas that aren't listed as projects.",
  },
  {
    value: "projects_only",
    label: "Inquiries about listed projects only",
    explanation: "Please get in touch only about the projects listed for this faculty member.",
  },
  {
    value: "not_accepting",
    label: "Not currently accepting new inquiries",
    explanation: "This faculty member isn't taking new student inquiries right now.",
  },
];

const LIMITS = {
  displayName: 100,
  description: 1000,
  researchAreas: 10,
  researchArea: 60,
  externalLinks: 5,
  externalLink: 300,
};

function describeInquiryPreference(code) {
  const option = INQUIRY_PREFERENCES.find((o) => o.value === code) || INQUIRY_PREFERENCES.at(-1);
  return { label: option.label, explanation: option.explanation };
}

// What students and visitors see: no internal codes, no email or account details.
function toFacultyProfile(row) {
  return {
    id: row.user_id,
    displayName: row.display_name,
    description: row.description,
    researchAreas: row.research_areas,
    inquiryPreference: describeInquiryPreference(row.inquiry_preference),
    externalLinks: row.external_links,
    publiclyVisible: isPubliclyVisibleFaculty(row),
    updatedAt: row.updated_at,
  };
}

// The owner's editing view also carries the stored code so the form can preselect it.
function toOwnProfile(row) {
  return { ...toFacultyProfile(row), inquiryPreferenceCode: row.inquiry_preference };
}

// Returns { profile } with normalized fields, or { error } describing the first problem.
function validateProfile(body) {
  const displayName = cleanText(body.displayName);
  if (!displayName) return { error: "Enter a display name.", field: "displayName" };
  if (displayName.length > LIMITS.displayName) {
    return { error: `Display name must be ${LIMITS.displayName} characters or fewer.`, field: "displayName" };
  }

  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description) return { error: "Enter a short description of your research.", field: "description" };
  if (description.length > LIMITS.description) {
    return { error: `Description must be ${LIMITS.description} characters or fewer.`, field: "description" };
  }

  const { areas: researchAreas, error: areasError } = cleanAreas(body.researchAreas, {
    max: LIMITS.researchAreas,
    maxLength: LIMITS.researchArea,
  });
  if (areasError) return { error: areasError, field: "researchAreas" };

  const inquiryPreference = body.inquiryPreference;
  if (!INQUIRY_PREFERENCES.some((o) => o.value === inquiryPreference)) {
    return { error: "Choose whether you are accepting student inquiries.", field: "inquiryPreference" };
  }

  const rawLinks = body.externalLinks ?? [];
  if (!Array.isArray(rawLinks)) return { error: "External links must be a list.", field: "externalLinks" };
  const externalLinks = [];
  for (const raw of rawLinks) {
    if (typeof raw !== "string") return { error: "External links must be text.", field: "externalLinks" };
    const text = raw.trim();
    if (!text) continue;
    // Only http(s): anything else (javascript:, data:) could run script when clicked.
    let url;
    try {
      url = new URL(text);
    } catch {
      return { error: `"${text}" is not a valid web address. Start it with https://`, field: "externalLinks" };
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { error: "External links must start with https:// or http://", field: "externalLinks" };
    }
    if (url.href.length > LIMITS.externalLink) {
      return { error: `Each link must be ${LIMITS.externalLink} characters or fewer.`, field: "externalLinks" };
    }
    if (!externalLinks.includes(url.href)) externalLinks.push(url.href);
  }
  if (externalLinks.length > LIMITS.externalLinks) {
    return { error: `List at most ${LIMITS.externalLinks} links.`, field: "externalLinks" };
  }

  return { profile: { displayName, description, researchAreas, inquiryPreference, externalLinks } };
}

const PROFILE_COLUMNS = `faculty_profiles.*, users.is_verified_faculty, users.public_profile_choice`;

// R1-08 to R1-10: faculty maintain their own profile; everyone else reads it subject to the
// visibility rule.
function createFacultyRouter({ db, auth }) {
  const router = express.Router();

  router.get("/me/profile", auth.requireVerifiedFaculty, async (req, res, next) => {
    try {
      const result = await db.query(
        `SELECT ${PROFILE_COLUMNS} FROM faculty_profiles
         JOIN users ON users.id = faculty_profiles.user_id
         WHERE faculty_profiles.user_id = $1`,
        [req.user.id],
      );
      res.json({
        profile: result.rows[0] ? toOwnProfile(result.rows[0]) : null,
        inquiryOptions: INQUIRY_PREFERENCES,
        limits: LIMITS,
      });
    } catch (error) {
      next(error);
    }
  });

  // Creates or replaces the signed-in faculty member's own profile. The owner is always
  // req.user; any id in the body is ignored (R1-16).
  router.put("/me/profile", auth.requirePublicProfileChoice, async (req, res, next) => {
    try {
      const { profile, error, field } = validateProfile(req.body || {});
      if (error) return res.status(400).json({ error, field });
      const saved = await db.query(
        `INSERT INTO faculty_profiles
           (user_id, display_name, description, research_areas, inquiry_preference, external_links, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (user_id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           description = EXCLUDED.description,
           research_areas = EXCLUDED.research_areas,
           inquiry_preference = EXCLUDED.inquiry_preference,
           external_links = EXCLUDED.external_links,
           updated_at = now()
         RETURNING *`,
        [
          req.user.id,
          profile.displayName,
          profile.description,
          profile.researchAreas,
          profile.inquiryPreference,
          profile.externalLinks,
        ],
      );
      const { is_verified_faculty, public_profile_choice } = req.user;
      res.json({ profile: toOwnProfile({ ...saved.rows[0], is_verified_faculty, public_profile_choice }) });
    } catch (error) {
      next(error);
    }
  });

  // R1-10: logged-out visitors get only public profiles; signed-in users also see faculty who
  // chose signed-in-only display. Revoked faculty are hidden from everyone.
  function visibilityFilter(viewer) {
    return `users.is_verified_faculty ${viewer ? "" : `AND ${PUBLIC_FACULTY_SQL}`}`;
  }

  router.get("/", async (req, res, next) => {
    try {
      const viewer = await auth.getSessionUser(req);
      const result = await db.query(
        `SELECT ${PROFILE_COLUMNS} FROM faculty_profiles
         JOIN users ON users.id = faculty_profiles.user_id
         WHERE ${visibilityFilter(viewer)}
         ORDER BY lower(faculty_profiles.display_name), faculty_profiles.user_id`,
      );
      res.json({ faculty: result.rows.map(toFacultyProfile) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: "Invalid faculty id." });
      const viewer = await auth.getSessionUser(req);
      const result = await db.query(
        `SELECT ${PROFILE_COLUMNS} FROM faculty_profiles
         JOIN users ON users.id = faculty_profiles.user_id
         WHERE faculty_profiles.user_id = $1 AND ${visibilityFilter(viewer)}`,
        [id],
      );
      // Same 404 whether the profile is missing or just not visible to this viewer.
      if (!result.rows[0]) return res.status(404).json({ error: "Faculty profile not found." });
      res.json({ profile: toFacultyProfile(result.rows[0]) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createFacultyRouter, INQUIRY_PREFERENCES };
