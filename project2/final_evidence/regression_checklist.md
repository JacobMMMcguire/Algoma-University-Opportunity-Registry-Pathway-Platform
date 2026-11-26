# Team regression checklist: Releases 1 to 4 after the Final hardening (F-25)

Run on the launch candidate (`final-development` = `r1-development`), 2026-11-26.

- **Automated:** `npm test` in `project2/backend`: 375 tests, all passing. The files named below
  are the checks for each journey.
- **Browser:** each journey's pages at 390px in headless Chrome with axe-core
  (`final_evidence/browser_pass.json`: 58 page views, no overflow, violations or errors).
- **Live:** the "Live" column is filled in from the deployed site after the Final seed (see
  `release_submission.md`).

| # | Journey (F-25) | Release | Automated check | Browser / live check | Result |
|---|---|---|---|---|---|
| 1 | Sign in with a university email code; operator console for test accounts | R1-01 to R1-03 | `sign-in.test.js`, `operator-console.test.js` | Signed in as every role for the browser pass | Pass |
| 2 | Staff grant and revoke faculty; revocation applies at once | R1-04, F-02 | `faculty-verification.test.js`, `authorization-sweep.test.js` | `/admin.html` as staff | Pass |
| 3 | Public-profile choice and consent-driven visibility | R1-05 to R1-07, R1-10, R1-14, F-04 | `public-profile.test.js`, `fixture.test.js`, `authorization-sweep.test.js` (F-04) | Visitor sees only public faculty and projects | Pass |
| 4 | Faculty profiles and projects: create, edit, publish, close, reopen | R1-08 to R1-16 | `faculty-profile.test.js`, `faculty-projects.test.js` | `/profile.html`, `/my-projects.html`, `/project-edit.html` | Pass |
| 5 | Discovery and filtering, contact, direct links | R1-17 to R1-24, R2-21 to R2-23, F-18 | `discovery.test.js`, `paging.test.js`, `regression.test.js` | `/projects.html` filters and "Show more"; `/faculty.html` | Pass |
| 6 | Accountless partner intake and validation | R2-01 to R2-06 | `partner-intake.test.js` | `/partner.html` | Pass |
| 7 | Publication gate: willingness makes an industry opportunity visible | R2-07 to R2-10, R2-24 | `publication-gate.test.js` | `/submissions.html` as faculty | Pass |
| 8 | Engagement state, recorded by any faculty member | R2-11 to R2-14 | `publication-gate.test.js`, `recovery-attribution.test.js` (RC-04 style correction) | `/submissions.html?id=` | Pass |
| 9 | Subscriptions and notifications; browsing always shows everything | R2-16 to R2-20, F-14 | `notifications.test.js`, `notification-failure.test.js` | `/notifications.html`; `/operations.html` retry | Pass |
| 10 | Two-sided matching: propose, confirm, decline, withdraw | R3-01 to R3-07, R3-22 | `matches.test.js` | `/matches.html` as faculty and students | Pass |
| 11 | Lifecycle and expiry: terms, deadlines, Centre deadline, withdraw, complete, renew, reopen | R3-08 to R3-13, R3-19 | `lifecycle.test.js`, `regression.test.js` | `/lifecycle.html` | Pass |
| 12 | Outcomes and showcase, with consent | R3-14 to R3-18, R3-20 | `outcomes.test.js` | `/outcomes.html`, `/showcase.html`, `/student.html?id=` | Pass |
| 13 | R1 to R3 fixtures together, and reseeding | R3-23 | `regression.test.js` (R1 to R3), `final-regression.test.js` (Final layer) | Live after seeding | Pass |
| 14 | External sync: v1, v2, classifications, malformed record, failure | R4-08 to R4-14, F-13 | `external-sync.test.js`, `integration-failures.test.js` | `/sync.html` as staff | Pass |
| 15 | External handoff, ownership, untrusted content, local support and readiness | R4-02 to R4-07, R4-15 to R4-26 | `external-opportunities.test.js` | `/external.html?id=`, "View / apply through Mitacs" at 390px | Pass |
| 16 | Authorization across every route (no regression from new routes) | R1-16, R2-24, R3-21, F-01 to F-03 | `authorization-sweep.test.js` (all 76 routes) | Private routes 401 to visitors on the live site | Pass |

## Intended changes to earlier results

These are deliberate Final changes, not regressions (see `DECISIONS.md`):

- **R3-04:** a fully confirmed match can now be undone (RC-03). Declining it is still refused.
- **Departures:**
  - F-ALEX has left, so he is out of the faculty directory.
  - His R1 projects P-101 and P-107 need a new supervisor and leave discovery.
  - O-302 needs a new supervisor instead of being Expired.
- **Not accepting inquiries:** F-PRIYA offers no contact.
- **RC-01:** O-303 starts Expired until staff extend its Centre deadline.
- **Showcase:** an outcome is public only while its match is fully confirmed.
- **Projects page:** it reads the combined `/api/discovery` list 20 at a time. The R1 to R4
  endpoints are unchanged without `limit`.
