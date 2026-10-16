// Loads the course's synthetic R1 fixture (project2/r1_fixture.json) and R2 fixtures
// (project2/r2_fixtures/: partner submissions and faculty subscriptions) as idempotent SQL scripts: rerunning them resets
// the fixture records to the fixture's values and leaves every other record alone. Used by
// `npm run seed:fixture`, `npm run dev:local` and the tests.
const fs = require("fs");
const path = require("path");
const { STUDENT_LEVELS, canonicalArea, canonicalTerm } = require("./catalog");

const FIXTURE_PATH = path.join(__dirname, "..", "..", "r1_fixture.json");
const R2_FIXTURE_DIR = path.join(__dirname, "..", "..", "r2_fixtures");

// The fixture has no email addresses. These are deliberately unlike real Algoma addresses
// (firstname.lastname@), have no inbox, and are never emailed (see routes/auth.js).
function fixtureEmail(fixtureId) {
  return `fixture-${fixtureId.toLowerCase()}@algomau.ca`;
}

// Accounts the fixture doesn't include but evaluators need (R1-04: a staff account for peer
// testers; a plain student account).
const EXTRA_ACCOUNTS = [
  { fixtureId: "TEST-STAFF", isStaff: true },
  { fixtureId: "TEST-STUDENT", isStaff: false },
];

const INQUIRY_CODES = { general: "open", "listed-projects-only": "projects_only", "not-accepting": "not_accepting" };
const STATUS_CODES = { draft: "draft", published: "published", withdrawn: "closed", closed: "closed" };

function loadFixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
}

function literal(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function textArray(values) {
  return values.length ? `ARRAY[${values.map(literal).join(", ")}]::text[]` : "ARRAY[]::text[]";
}

function areas(values, where) {
  return values.map((value) => {
    const area = canonicalArea(value);
    if (!area) throw new Error(`${where}: "${value}" is not in the research area list (src/catalog.js).`);
    return area;
  });
}

function lookup(table, key, where) {
  if (!(key in table)) throw new Error(`${where}: unknown value "${key}".`);
  return table[key];
}

function buildFixtureSql(fixture) {
  const statements = [];
  const owners = new Set(fixture.faculty.map((f) => f.fixture_id));

  for (const account of EXTRA_ACCOUNTS) {
    statements.push(`INSERT INTO users (email, fixture_id, is_staff, is_verified_faculty, public_profile_choice, public_profile_choice_at)
VALUES (${literal(fixtureEmail(account.fixtureId))}, ${literal(account.fixtureId)}, ${literal(account.isStaff)}, false, NULL, NULL)
ON CONFLICT (email) DO UPDATE SET fixture_id = EXCLUDED.fixture_id, is_staff = EXCLUDED.is_staff,
  is_verified_faculty = false, public_profile_choice = NULL, public_profile_choice_at = NULL;`);
  }

  for (const f of fixture.faculty) {
    const where = `faculty ${f.fixture_id}`;
    const email = literal(fixtureEmail(f.fixture_id));
    statements.push(`INSERT INTO users (email, fixture_id, is_staff, is_verified_faculty, public_profile_choice, public_profile_choice_at)
VALUES (${email}, ${literal(f.fixture_id)}, false, ${literal(Boolean(f.verified_faculty))}, ${literal(Boolean(f.public_profile))}, now())
ON CONFLICT (email) DO UPDATE SET fixture_id = EXCLUDED.fixture_id, is_staff = false,
  is_verified_faculty = EXCLUDED.is_verified_faculty, public_profile_choice = EXCLUDED.public_profile_choice,
  public_profile_choice_at = EXCLUDED.public_profile_choice_at;`);
    statements.push(`INSERT INTO faculty_profiles (user_id, display_name, description, research_areas, inquiry_preference, external_links, updated_at)
SELECT id, ${literal(f.display_name)}, ${literal(f.bio)}, ${textArray(areas(f.areas, where))},
  ${literal(lookup(INQUIRY_CODES, f.inquiry_preference, where))}, ${textArray(f.external_links || [])}, now()
FROM users WHERE email = ${email}
ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, description = EXCLUDED.description,
  research_areas = EXCLUDED.research_areas, inquiry_preference = EXCLUDED.inquiry_preference,
  external_links = EXCLUDED.external_links, updated_at = now();`);
  }

  for (const p of fixture.projects) {
    const where = `project ${p.fixture_id}`;
    if (!owners.has(p.owner)) throw new Error(`${where}: owner ${p.owner} is not a fixture faculty member.`);
    if (p.student_level && !STUDENT_LEVELS.includes(p.student_level)) {
      throw new Error(`${where}: "${p.student_level}" is not one of ${STUDENT_LEVELS.join(", ")}.`);
    }
    const term = canonicalTerm(p.term);
    if (!term) throw new Error(`${where}: "${p.term}" is not a "<Season> <Year>" term.`);
    // The fixture gives no description or background note; the pages hide empty ones.
    statements.push(`INSERT INTO projects (fixture_id, faculty_user_id, title, description, research_areas, student_level, target_term, prerequisites, status, updated_at)
SELECT ${literal(p.fixture_id)}, id, ${literal(p.title)}, ${literal(p.description || "")}, ${textArray(areas(p.areas, where))},
  ${literal(p.student_level || null)}, ${literal(term)}, ${literal(p.prerequisites || null)},
  ${literal(lookup(STATUS_CODES, p.status, where))}, now()
FROM users WHERE email = ${literal(fixtureEmail(p.owner))}
ON CONFLICT (fixture_id) DO UPDATE SET faculty_user_id = EXCLUDED.faculty_user_id, title = EXCLUDED.title,
  description = EXCLUDED.description, research_areas = EXCLUDED.research_areas,
  student_level = EXCLUDED.student_level, target_term = EXCLUDED.target_term,
  prerequisites = EXCLUDED.prerequisites, status = EXCLUDED.status, updated_at = now();`);
  }

  return `-- R1 fixture ${fixture.fixture_version}: generated from r1_fixture.json by npm run seed:fixture.
BEGIN;
${statements.join("\n\n")}
COMMIT;
`;
}

function readR2Fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(R2_FIXTURE_DIR, name), "utf8"));
}

function loadIntakeFixture() {
  return readR2Fixture("intake_submissions.json");
}

function loadSubscriptionFixture() {
  return readR2Fixture("faculty_subscriptions.json").subscriptions;
}

// The fixture's submissions, in the API's field names.
function intakeRequestBody(s) {
  return {
    organisation: s.organisation,
    contactName: s.contact_name,
    contactEmail: s.contact_email,
    title: s.title,
    description: s.description,
    researchAreas: s.areas,
    capacity: s.capacity,
  };
}

// R2-16: the fixture faculty's private notification settings. Load before the submissions,
// so they notify the right faculty.
function buildSubscriptionFixtureSql(subscriptions) {
  const statements = subscriptions.map((sub) => {
    const where = `subscription ${sub.faculty_id}`;
    if (!["none", "all", "areas"].includes(sub.mode)) throw new Error(`${where}: unknown mode "${sub.mode}".`);
    const subAreas = sub.mode === "areas" ? areas(sub.areas, where) : [];
    return `INSERT INTO faculty_subscriptions (user_id, mode, research_areas, updated_at)
SELECT id, ${literal(sub.mode)}, ${textArray(subAreas)}, now() FROM users WHERE fixture_id = ${literal(sub.faculty_id)}
ON CONFLICT (user_id) DO UPDATE SET mode = EXCLUDED.mode, research_areas = EXCLUDED.research_areas, updated_at = now();`;
  });
  return `-- R2 faculty subscriptions: generated from r2_fixtures/faculty_subscriptions.json by npm run seed:fixture.
BEGIN;
${statements.join("\n\n")}
COMMIT;
`;
}

// Each submission goes through the same validation as the public form, so the ones the form
// would reject (S-204) are left out, exactly as if a partner had sent them. Accepted ones are
// reset to how they arrive: no supervisors, not contacted. Matching subscribers are notified,
// as they would be by the form.
function buildIntakeFixtureSql(submissions) {
  // Required here, not at the top, so loading the R1 fixture never depends on the R2 router.
  const { SUBSCRIBER_MATCH_SQL, validateSubmission } = require("./routes/partner-submissions");
  const statements = [];
  const accepted = [];
  const rejected = [];
  for (const s of submissions) {
    const { submission, errors } = validateSubmission(intakeRequestBody(s));
    if (errors) {
      rejected.push(s.fixture_id);
      continue;
    }
    accepted.push(s.fixture_id);
    statements.push(`INSERT INTO partner_submissions (fixture_id, organisation, contact_name, contact_email, title, description, research_areas, capacity)
VALUES (${literal(s.fixture_id)}, ${literal(submission.organisation)}, ${literal(submission.contactName)}, ${literal(submission.contactEmail)},
  ${literal(submission.title)}, ${literal(submission.description)}, ${textArray(submission.researchAreas)}, ${literal(submission.capacity)})
ON CONFLICT (fixture_id) DO UPDATE SET organisation = EXCLUDED.organisation, contact_name = EXCLUDED.contact_name,
  contact_email = EXCLUDED.contact_email, title = EXCLUDED.title, description = EXCLUDED.description,
  research_areas = EXCLUDED.research_areas, capacity = EXCLUDED.capacity,
  engagement_state = 'not_contacted', engagement_user_id = NULL, engagement_updated_at = NULL;`);
  }
  const fixtureIds = textArray(accepted);
  statements.push(`DELETE FROM opportunity_supervisors WHERE submission_id IN
  (SELECT id FROM partner_submissions WHERE fixture_id = ANY(${fixtureIds}));`);
  statements.push(`INSERT INTO notifications (user_id, submission_id)
SELECT fs.user_id, s.id FROM partner_submissions s
JOIN faculty_subscriptions fs ON true
JOIN users ON users.id = fs.user_id
WHERE s.fixture_id = ANY(${fixtureIds}) AND ${SUBSCRIBER_MATCH_SQL}
ON CONFLICT DO NOTHING;`);
  return `-- R2 partner submissions: generated from r2_fixtures/intake_submissions.json by npm run seed:fixture.
-- Rejected by validation, so not loaded: ${rejected.join(", ") || "none"}.
BEGIN;
${statements.join("\n\n")}
COMMIT;
`;
}

// Everything R2 adds, in order. Needs the R1 fixture loaded first (for the faculty accounts).
function buildR2FixtureSql() {
  return `${buildSubscriptionFixtureSql(loadSubscriptionFixture())}
${buildIntakeFixtureSql(loadIntakeFixture())}`;
}

module.exports = {
  FIXTURE_PATH,
  R2_FIXTURE_DIR,
  EXTRA_ACCOUNTS,
  fixtureEmail,
  loadFixture,
  buildFixtureSql,
  loadIntakeFixture,
  loadSubscriptionFixture,
  intakeRequestBody,
  buildSubscriptionFixtureSql,
  buildIntakeFixtureSql,
  buildR2FixtureSql,
};
