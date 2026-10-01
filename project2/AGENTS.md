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
| Faculty profile | R1-08 to R1-10 | Done (see "Faculty profiles" below) |
| Faculty-created projects | R1-11 to R1-16 | Done (see "Faculty projects" below) |
| Discovery, contact, production usability | R1-17 to R1-26 | Jacob, done (see "Discovery" below) |
| Fixture loading, submission files | Brief, "Submission evidence" | Jacob, done (`release_submission.md`, `evaluation_adapter.json`) |

## Layout (`project2/backend/`)

```
server.js               Production entry: env config, Postgres pool, Brevo email
src/app.js              createApp({ db, config, sendSignInEmail }): mounts routers
src/config.js           Environment settings (domain, TTLs, email, test mode)
src/db.js               Postgres pool, in-memory PGlite db, migration runner
src/auth.js             Session lookup and guards (requireAuth, requireStaff, ...)
src/visibility.js       The public-visibility rule (R1-10, R1-14)
src/catalog.js          Fixed lists: research areas, student levels, terms, inquiry wording
src/validation.js       Shared input clean-up (text, research areas, ids, search patterns)
src/fixture.js          Turns ../r1_fixture.json into idempotent seed SQL
src/email.js            Brevo sender
src/routes/auth.js      /api/auth: sign-in codes, sessions (R1-01 to R1-03)
src/routes/admin.js     /api/admin: grant or revoke faculty (R1-04)
src/routes/account.js   /api/account: public-profile choice (R1-05 to R1-07)
src/routes/faculty.js   /api/faculty: profiles, faculty discovery (R1-08 to R1-10, R1-17, R1-18)
src/routes/projects.js  /api/projects: projects, project discovery (R1-11 to R1-16, R1-19 to R1-21)
src/routes/options.js   /api/options: the fixed lists for the forms
migrations/NNN_*.sql    Schema history, applied in order
public/                 Frontend, served by Express from the same origin as the API
test/                   node:test suites and helpers (in-memory Postgres)
scripts/dev-local.js    Run the app locally on an in-memory database with the fixture loaded
scripts/migrate.js      Apply pending migrations to DATABASE_URL
scripts/seed-fixture.js Load the R1 fixture into DATABASE_URL, or print it as SQL
```

The frontend is served by the backend, not a separate static site, so the session cookie is
first-party. A separate site makes it third-party, which Safari and every iOS browser block.

## Running and testing

From `project2/backend/` (Node 22+):

- `npm install`
- `npm test`: every suite, against a fresh in-memory Postgres (PGlite). No credentials.
- `npm run dev:local`: the full app at http://localhost:3001 on an in-memory database with
  the R1 fixture loaded; it resets on restart. Sign in as any `@algomau.ca` address or a
  fixture account (see "Fixture" below) and read the code at `/operator.html`.
- `npm start`: production mode, needs `DATABASE_URL` in `.env` (see `.env.example`).
- `npm run seed:fixture` (needs `DATABASE_URL`) or `npm run seed:fixture:sql` (prints SQL to
  paste into the Supabase SQL Editor): load or reset the R1 fixture.

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

Example (a trimmed version of the real `src/routes/projects.js`, which also validates every
field):

```js
const express = require("express");

function createProjectsRouter({ db, auth }) {
  const router = express.Router();

  router.put("/:id", auth.requireVerifiedFaculty, async (req, res, next) => {
    try {
      const id = parseId(req.params.id); // from src/validation.js
      if (id === null) return res.status(400).json({ error: "Invalid project id." });
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
- `loadFixtureInto(t)`: loads the R1 fixture; returns `projectId("P-101")` and
  `facultyId("F-ALEX")` lookups.

Signing the same address in more than 3 times per test file hits the real rate limit; reuse
the session instead (see `test/discovery.test.js`).

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

Applied so far: `000` (initial), `001` (public-profile choice on `users`, guess limit),
`002` (`fixture_id` on `users` and `projects`; student levels fixed to three values with a
CHECK constraint). The public-profile choice lives on `users` (`public_profile_choice`), not
on `faculty_profiles`.

## Frontend conventions

- One HTML page per screen in `public/`, each loading `styles.css`, `common.js`, then its
  own script. Copy `admin.html` as a template.
- Put record ids in the query string (`faculty.html?id=12`). Direct opens and refreshes then
  work with no server routing (R1-24); the page fetches the record and shows "not found" on
  404.
- `common.js` has `api(path, { method, body })` (same-origin, never throws),
  `getSession()`, `renderNav(session)`, `showStatus(el, msg, { error })`,
  `showApiError(el, res, fallback)` (adds a link to the fix for known error codes),
  `escapeHtml()` and `PROJECT_STATUS_LABELS`. Add new pages to `NAV_LINKS` there.
- `form-pickers.js` has the fixed-list inputs (`renderAreaPicker`, `renderTermPicker`,
  `fillSelect`, `fillGroupedSelect`) and the filter-form helpers (`submitFiltersAsUrl`,
  `showResultCount`). `contact.js` has `renderContactPanel` (R1-22).
- `styles.css` has `.button-link` for links that sit next to buttons (Edit, View).
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

## Faculty profiles (R1-08 to R1-10, done)

- One profile per faculty member, keyed by `faculty_profiles.user_id`, so a profile's id is
  its owner's user id (`faculty.html?id=12` is user 12). No migration was needed: the columns
  in 000 already fit.
- `GET /api/faculty/me/profile` (verified faculty): own profile or `null`, plus the inquiry
  options for the form. `PUT /api/faculty/me/profile` (`requirePublicProfileChoice`): creates
  or replaces it. There is deliberately no route that writes a profile by id (R1-16).
- `GET /api/faculty` and `GET /api/faculty/:id`: everyone, filtered by the visibility rule;
  hidden and missing profiles get the same 404. Revoked faculty are hidden from everyone.
- Inquiry preference codes (`open`, `projects_only`, `not_accepting`) are never shown to
  students; `INQUIRY_PREFERENCES` in `src/catalog.js` holds the label and explanation they
  see. Only the owner's response adds `inquiryPreferenceCode`.
- Limits: name 100 chars, description 1000, 1 to 10 areas from the fixed list in
  `src/catalog.js`, 0 to 5 external links that must be `http(s)` URLs.
- Pages: `profile.html` (faculty edit their own) and `faculty.html` (filterable list, or one
  profile with `?id=`).

## Faculty projects (R1-11 to R1-16, done)

- Stored in `projects` (from 000, no migration needed): `title`, `description`,
  `research_areas`, optional `student_level`, `target_term`, optional `prerequisites`,
  `status` (`draft`, `published`, `closed`), owned by `faculty_user_id`.
- Owner routes, all with ownership in the SQL (`WHERE id = $1 AND faculty_user_id = $2`) and
  a 404 for anyone else's project (R1-16):
  - `GET /api/projects/mine` (verified faculty): own projects in every status, plus the form
    limits.
  - `POST /api/projects` (verified faculty): always creates a `draft` (R1-11, R1-12). Status,
    ids and owner fields in the body are ignored.
  - `PUT /api/projects/:id` (verified faculty): replaces the content; never changes status.
  - `POST /api/projects/:id/publish` (`requirePublicProfileChoice`, R1-05): draft or closed
    to published (R1-13; also how a closed project is reopened). Also needs the owner to
    have a faculty profile (409 `faculty_profile_required`), so every public project can
    name its faculty and link to their profile (R1-21).
  - `POST /api/projects/:id/close` (verified faculty): withdraws it (R1-15). There is
    deliberately no DELETE route, so closing never loses the record.
- Drafts can be created before the public-profile choice is made; only publishing needs it.
- `GET /api/projects` (optionally `?facultyId=N`) and `GET /api/projects/:id`: published
  projects of verified faculty who have a profile, with `PUBLIC_FACULTY_SQL` for logged-out
  visitors (R1-14).
  Drafts, closed, hidden and missing projects all get the same 404. The owner can also open
  their own draft or closed project by id, to preview it.
- Responses include `faculty: { id, displayName }` from the owner's profile (`displayName`
  is `null` only for an owner previewing before writing a profile). Lists never include an
  email address; see "Contact" below for the detail page.
- Limits: title 150 chars, description 1000, 1 to 10 areas from the fixed list, background
  note 1000. Student level is one of `Undergraduate`, `Graduate`, `Undergraduate or Graduate`
  or unset (a database CHECK enforces it). Target term is `<Winter|Spring|Summer|Fall> <year>`.
- Pages: `my-projects.html` (owner's list with Publish, Close, Reopen), `project-edit.html`
  (create, or edit with `?id=`), `projects.html` (filterable list, or one project with
  `?id=`), and a "Projects" list on each `faculty.html?id=` profile.

## Discovery (R1-17 to R1-26, done)

- **Filters (R1-20)**, applied on the server from the query string; every given filter must
  match (AND), and an area matches if it is any one of the record's areas:
  - `GET /api/projects`: `area`, `level` (`undergraduate` or `graduate`; "Undergraduate or
    Graduate" projects match both), `term`, `facultyId`, `q` (title, description, background
    note, areas and faculty name).
  - `GET /api/faculty`: `area`, `inquiry` (`open`, `projects_only`, `not_accepting`), `q`
    (name, description, areas).
  - Unknown values are a 400; search text is matched literally (`%` and `_` are escaped).
  - Both lists also return `filters`: the choices for each filter with counts, computed from
    what the viewer can see before filtering, so options never reveal hidden records.
  - The pages keep filters in the URL (`projects.html?area=Cybersecurity&term=Winter+2027`),
    so filtered results survive refreshes and links (R1-24).
- **Contact (R1-22)**: the detail endpoints add `contact: { email }` only where the faculty
  member invites it: on the profile if they're open to general inquiries; on a published
  project unless they're not accepting inquiries. `contactViaProjects` on a profile means
  "use a project's Contact". The page (`public/contact.js`) drafts an editable subject and
  message and hands them to the student's own Gmail (Algoma is Google Workspace) or mail
  app, with copy buttons as a fallback. The site never sends the message and doesn't print
  the address.
- **Phone width and keyboard (R1-25, R1-26)**: every main-journey page was checked in
  headless Chrome at 390px for horizontal overflow and with axe-core (WCAG 2.1 A/AA plus
  best practice): no overflow, no violations. Filter results move focus to the result
  count; Contact opens by keyboard and focuses the subject.

## Fixture (`project2/r1_fixture.json`)

- `npm run seed:fixture` / `seed:fixture:sql` loads it. Reruns reset the fixture records to
  the fixture's values (matched by `fixture_id`) and leave everything else alone. It is run
  by hand, never on server start: the free Render server restarts after sleeping, and
  reseeding then would silently undo evaluators' edits.
- The fixture's own wording is translated: inquiry `general` / `listed-projects-only` become
  `open` / `projects_only`; status `withdrawn` becomes `closed`. Values outside the fixed
  lists make the seed fail loudly rather than load bad data.
- Accounts get synthetic addresses, `fixture-<id>@algomau.ca` (e.g.
  `fixture-f-alex@algomau.ca`), plus `fixture-test-staff@` and `fixture-test-student@`.
  Fixture accounts are never emailed (they have no inbox); they sign in through test mode,
  and are refused when test mode is off.
- `test/fixture.test.js` checks the app against the fixture's own `expected_public` and
  `expected_authenticated` flags.
