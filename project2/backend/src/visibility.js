// The one rule for R1-10 and R1-14. A faculty member's profile and published projects may be
// shown to logged-out visitors only while they are verified faculty AND have explicitly allowed
// public display. Otherwise they are visible to signed-in users only. Drafts are never public.
//
// Use PUBLIC_FACULTY_SQL in any query that serves logged-out visitors, with the faculty member's
// row from `users` joined as `users`. Do not re-implement this condition elsewhere.
const PUBLIC_FACULTY_SQL = "(users.is_verified_faculty AND users.public_profile_choice IS TRUE)";

function isPubliclyVisibleFaculty(user) {
  return Boolean(user.is_verified_faculty && user.public_profile_choice === true);
}

// R2-07 to R2-10, R2-21, R2-22: an industry opportunity is visible to a viewer while at least
// one supervisor is visible to them, and only those supervisors are named. A supervisor counts
// while they are verified faculty with a profile (so students can see who they are), plus, for
// logged-out visitors, the rule above. Use with `opportunity_supervisors`, `users` and
// `faculty_profiles` joined for the supervisor.
function visibleSupervisorSql(viewer) {
  return `users.is_verified_faculty AND faculty_profiles.user_id IS NOT NULL ${viewer ? "" : `AND ${PUBLIC_FACULTY_SQL}`}`;
}

module.exports = { PUBLIC_FACULTY_SQL, isPubliclyVisibleFaculty, visibleSupervisorSql };
