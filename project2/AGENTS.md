# Project 2 — guide for developers and coding agents

Opportunity Registry and Pathway Platform, Release 1 (R1-01 to R1-26): students discover
Algoma faculty and projects and contact faculty by email. The course brief and R1
requirements are the spec; this file is how the codebase works and the rules for changing it.

**Everything for Project 2 is inside `project2/`**: code in `project2/backend/`, docs in
`project2/`. Files and folders at the repository root other than `.gitignore`, `.github/`,
`AGENTS.md` and `CLAUDE.md` belong to Phase 0 and must be ignored (see the root `AGENTS.md`).
Run every command from `project2/backend/`.

## Hard rules

1. **Branches.** Work on a feature branch off `r1-development` and merge back into it.
   Never push to or merge into `master`: it holds the submitted Phase 0 app, which is still
   being assessed. Never edit the Phase 0 files at the repository root (listed in the root
   `AGENTS.md`) or Phase 0's Render services and Supabase project.
2. **Merging to `r1-development` deploys to production immediately.** Render auto-deploys
   that branch to https://algoma-opportunity-registry-r1-backend.onrender.com. Run
   `npm test` before merging.
3. **The Supabase database is shared and live.** Change the schema only with a new numbered
   migration (see "Database changes"), apply it before merging code that needs it, and never
   edit a migration that has already been applied.
4. **Authorization is server-side only (R1-16).** The acting user is `req.user`, set by the
   auth guards. Never take "who am I" or "who owns this" from the request body, URL or query.
   Put ownership in the SQL itself, e.g.
   `UPDATE projects SET ... WHERE id = $1 AND faculty_user_id = $2` with `req.user.id`, and
   return 404 when no row matches (don't reveal that someone else's record exists).
5. **Visibility has exactly one rule** (`src/visibility.js`). Anything served to logged-out
   visitors must filter with `PUBLIC_FACULTY_SQL`. Don't write your own version of it.
6. **R1-05:** endpoints that save a faculty profile for display or publish a project must use
   `auth.requirePublicProfileChoice`. Do not require the choice to be *true* anywhere: faculty
   who decline public display keep every faculty feature (R1-06).
7. **No secrets in git, chat, issues or screenshots.** `.env` is gitignored. Ask the team for
   `DATABASE_URL` privately, or use `npm run dev:local`, which needs no credentials.
8. **Escape user text.** Prefer `textContent`; when building HTML strings, wrap every
   user-supplied value in `escapeHtml()` from `public/common.js`.
9. **Every requirement gets tests** in `backend/test/`, named after the requirement
   (see existing files). R1-16 needs explicit cross-user tests.

## Who owns what

| Area | Requirements | Owner |
|---|---|---|
| Identity, roles, consent | R1-01 to R1-07 | Jacob, done (see below) |
| Faculty profile, faculty-created projects | R1-08 to R1-16 | Teammates |
| Discovery, production usability | R1-17 to R1-26 | Whole team, later |

Unassigned, but needed for submission: loading `r1_fixture.json` through a seed/setup
mechanism (the brief requires it; normal users must not see fixture controls),
`release_submission.md`, and `evaluation_adapter.json`.

## Layout (`project2/backend/`)

```
server.js               Production entry: env config, Postgres pool, Brevo email
src/app.js              createApp({ db, config, sendSignInEmail }): mounts routers
src/config.js           Environment settings (domain, TTLs, email, test mode)
src/db.js               Postgres pool, in-memory PGlite db, migration runner
src/auth.js             Session lookup and guards (requireAuth, requireStaff, ...)
src/visibility.js       The public-visibility rule (R1-10, R1-14)
src/email.js            Brevo sender
src/routes/auth.js      /api/auth: sign-in codes, sessions (R1-01 to R1-03)
src/routes/admin.js     /api/admin: grant or revoke faculty (R1-04)
src/routes/account.js   /api/account: public-profile choice (R1-05 to R1-07)
migrations/NNN_*.sql    Schema history, applied in order
public/                 Frontend, served by Express from the same origin as the API
test/                   node:test suites and helpers (in-memory Postgres)
scripts/dev-local.js    Run the app locally with an in-memory database
scripts/migrate.js      Apply pending migrations to DATABASE_URL
```

The frontend is served by the backend, not a separate static site, so the session cookie is
first-party. A separate site makes it third-party, which Safari and every iOS browser block.

## Running and testing

From `project2/backend/` (Node 22+):

- `npm install`
- `npm test`: every suite, against a fresh in-memory Postgres (PGlite). No credentials.
- `npm run dev:local`: the full app at http://localhost:3001 on an in-memory database that
  resets on restart. `staff@algomau.ca` is pre-made staff; sign in with any `@algomau.ca`
  address and read its code at `/operator.html`.
- `npm start`: production mode, needs `DATABASE_URL` in `.env` (see `.env.example`).

## Using auth in feature code

Routers are factories receiving `{ db, config, auth }`. Mount them in `src/app.js` where
the comment says to.

Guards (each is a complete middleware list; use one per route):

| Guard | Allows |
|---|---|
| `auth.requireAuth` | Any signed-in user (401 otherwise) |
| `auth.requireStaff` | Staff (403 otherwise) |
| `auth.requireVerifiedFaculty` | Currently verified faculty (403 otherwise) |
| `auth.requirePublicProfileChoice` | Verified faculty who have made the public-profile choice (409 with `code: "public_profile_choice_required"` otherwise) |
| `await auth.getSessionUser(req)` | Not a guard: the user row or `null`, for routes that serve both logged-out and signed-in visitors |

`req.user` is the full `users` row in snake_case: `id`, `email`, `is_staff`,
`is_verified_faculty`, `public_profile_choice` (true, false, or null if not chosen),
`public_profile_choice_at`, `created_at`. It is re-read on every request, so revocations
apply at once. `toPublicUser(row)` from `src/auth.js` is the camelCase shape sent to the
browser.

Example:

```js
// src/routes/projects.js
const express = require("express");

function createProjectsRouter({ db, auth }) {
  const router = express.Router();

  router.patch("/:id", auth.requireVerifiedFaculty, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid project id." });
      const result = await db.query(
        "UPDATE projects SET title = $1, updated_at = now() WHERE id = $2 AND faculty_user_id = $3 RETURNING *",
        [req.body.title, id, req.user.id],
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Project not found." });
      res.json({ project: result.rows[0] });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createProjectsRouter };
```

## Visibility (R1-10, R1-14)

A faculty member's profile and published projects are public only while they are verified
faculty **and** `public_profile_choice IS TRUE`. Otherwise they are for signed-in users
only. Drafts are visible only to their owner. Revoked faculty drop out of public view
automatically.

```js
const { PUBLIC_FACULTY_SQL } = require("../visibility");
const viewer = await auth.getSessionUser(req);
const sql = `SELECT ... FROM faculty_profiles JOIN users ON users.id = faculty_profiles.user_id
             WHERE users.is_verified_faculty ${viewer ? "" : `AND ${PUBLIC_FACULTY_SQL}`}`;
```

This also applies to direct URLs (R1-24): a logged-out request for a non-public profile or
project must get 404, not the record.

## Writing tests

`test/helpers.js` provides:

- `startTestApp({ config?, extend? })`: the real app on a random port with an empty
  in-memory database. Emails are captured in `t.sentEmails`. Call `t.close()` in `after`.
- `signIn(t, email, { staff?, faculty?, publicProfile? })`: signs in through the real flow
  and returns `{ client, user }`. Roles are set directly in the database.
- `createClient(baseUrl)`: a signed-out client. Clients keep their own cookie like a browser.
- `uniqueEmail(prefix)`: a fresh `@algomau.ca` address per call.

For R1-16, sign in two faculty and assert that B gets 404 (and no change in the database)
when editing A's profile or project by id, body or URL.

## Database changes

`migrations/000_initial_schema.sql` is the starting schema; each later change is the next
number, e.g. `002_faculty_profile_fields.sql`. Each migration must:

- be safe to run while the previous code is still deployed (add before you remove);
- end with `INSERT INTO schema_migrations (id) VALUES ('002_faculty_profile_fields') ON CONFLICT DO NOTHING;`
- enable RLS on any new table (`ALTER TABLE x ENABLE ROW LEVEL SECURITY;`): the backend
  bypasses it as table owner, and it blocks Supabase's public Data API.

Tests and `dev:local` apply every migration automatically. For the live database, paste
the file into the Project 2 Supabase SQL Editor (or `npm run migrate` with `DATABASE_URL`)
**before** merging the code that needs it. Check what's applied with
`SELECT * FROM schema_migrations`.

The `faculty_profiles` and `projects` tables in 000 are a first draft owned by the profile
and project work. Reshape them freely with migrations, but check the columns against
`r1_fixture.json` first so seeding stays simple. The public-profile choice lives on `users`
(`public_profile_choice`), not on `faculty_profiles`.

## Frontend conventions

- One HTML page per screen in `public/`, each loading `styles.css`, `common.js`, then its
  own script. Copy `admin.html` as a template.
- Put record ids in the query string (`faculty.html?id=12`). Direct opens and refreshes then
  work with no server routing (R1-24); the page fetches the record and shows "not found" on
  404.
- `common.js` has `api(path, { method, body })` (same-origin, never throws),
  `getSession()`, `renderNav(session)`, `showStatus(el, msg, { error })` and
  `escapeHtml()`. Add new pages to `NAV_LINKS` there.
- Accessibility and phone width (R1-25, R1-26): every input has a `<label>`, errors go to a
  `role="status"` element and focus returns to the field, everything works by keyboard, and
  nothing scrolls sideways at 390px wide.

## Sign-in details (R1-01 to R1-07, done)

- Codes: 6 digits, expire after 10 minutes, single-use (enforced in one SQL statement), dead
  after 5 wrong guesses, at most 3 requested per address per 10 minutes. Only
  `@algomau.ca`, matched exactly after the final `@` (`ALLOWED_EMAIL_DOMAIN`).
- Delivery: emailed via Brevo's HTTPS API when `BREVO_API_KEY` and `EMAIL_FROM` are set.
  With `SIGN_IN_TEST_MODE=true`, unused codes are also listed at `/operator.html` so
  testers can use accounts with no inbox (the brief's approved test mode).
- Sessions: random token in an httpOnly, SameSite=Lax cookie, stored in `sessions`, 7 days.
- New accounts are never staff or faculty. The first staff account was set in the Supabase
  SQL Editor: `UPDATE users SET is_staff = true WHERE email = '...';`
- Staff grant or revoke faculty at `/admin.html`. Faculty choose public display on the home
  page.
