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

module.exports = { PUBLIC_FACULTY_SQL, isPubliclyVisibleFaculty };
