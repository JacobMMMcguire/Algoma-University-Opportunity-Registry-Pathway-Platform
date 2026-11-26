// External opportunities (R4-01 to R4-07, R4-13, R4-15 to R4-26): what students, faculty and
// visitors see of externally owned opportunities, and the local data attached to them.
// /api/external-sync (operators) is in routes/external-sync.js.
//
// Source-controlled fields (title, description, areas, link, closing date) have no write route
// here at all (R4-16): only a successful sync changes them. Everything writable is local and lives
// in its own table, keyed by the local id, for req.user only (R4-26).
const express = require("express");
const { recordAudit } = require("../audit");
const { RESEARCH_AREA_GROUPS } = require("../catalog");
const { today } = require("../lifecycle");
const { cleanText, likePattern, parseId } = require("../validation");
const { visibleSupervisorSql } = require("../visibility");
const { parseFilters } = require("./projects");

// Weekly feed: data counts as stale once the last successful sync is more than 8 days old.
const STALE_AFTER_HOURS = 8 * 24;
const NOTE_MAX = 500;

// R4-15: a student's own record of what happened with the provider. The provider decides; the
// student only records what they were told (R4-06).
const STUDENT_STATUSES = {
  interested: "Thinking about applying",
  applied: "I applied through the provider",
  accepted_by_provider: "The provider offered me a place",
  not_accepted_by_provider: "The provider didn't offer me a place",
  completed: "I completed it",
  not_pursuing: "Not pursuing it",
};

// Plain-language wording shown with every external opportunity (R4-03 to R4-06, R4-19).
function wordingFor(ownerName) {
  return {
    ownership: `Owned by ${ownerName}, not Algoma University.`,
    authority:
      `${ownerName} owns this opportunity and is the only authority on it: ${ownerName} decides who can apply, ` +
      `who is selected and every other outcome. Algoma University shows a copy here only to help you find it, ` +
      `and does not decide or check eligibility.`,
    apply: `View / apply through ${ownerName}`,
    applyNote: `Applications are made on the ${ownerName} site, not here.`,
    interest:
      `Algoma faculty who are willing to support students pursuing this. This is local support from Algoma, ` +
      `not selection, approval or endorsement by ${ownerName}. Discussion happens by email.`,
    readiness:
      "A suggestion from Algoma faculty, not a requirement: anyone can view this opportunity and apply through the provider.",
  };
}

const SOURCE_EVENT_TEXT = {
  changed: "updated the listing",
  not_seen: "stopped listing it (missing from a successful update)",
  reappeared: "listed it again",
  withdrawn: "marked it as withdrawn",
};
const FIELD_TEXT = { title: "title", description: "description", areas: "areas", authoritative_url: "link", closes: "closing date" };

// Freshness of each source's data (R4-13): the last successful sync, whether a later attempt
// failed, and whether the data is old enough to be stale.
async function loadSourceStatus(db) {
  const result = await db.query(`
    SELECT s.id, s.name, s.owner_name,
      (SELECT finished_at FROM external_sync_runs WHERE source_id = s.id AND status = 'succeeded' ORDER BY id DESC LIMIT 1) AS last_success_at,
      (SELECT finished_at FROM external_sync_runs WHERE source_id = s.id AND status = 'failed' ORDER BY id DESC LIMIT 1) AS last_failure_at
    FROM external_sources s`);
  const now = Date.now();
  return new Map(
    result.rows.map((row) => {
      const lastSuccess = row.last_success_at ? new Date(row.last_success_at) : null;
      const failedSince = Boolean(row.last_failure_at && (!lastSuccess || new Date(row.last_failure_at) > lastSuccess));
      const ageHours = lastSuccess ? (now - lastSuccess.getTime()) / 3600000 : Infinity;
      const stale = failedSince || ageHours > STALE_AFTER_HOURS;
      return [
        row.id,
        {
          id: row.id,
          name: row.name,
          ownerName: row.owner_name,
          lastSuccessfulSyncAt: lastSuccess && lastSuccess.toISOString(),
          latestAttemptFailed: failedSince,
          stale,
          staleReason: !stale
            ? null
            : failedSince
              ? `The latest attempt to update from ${row.owner_name} failed, so this may be out of date.`
              : `This hasn't been updated from ${row.owner_name} for more than ${STALE_AFTER_HOURS / 24} days, so it may be out of date.`,
        },
      ];
    }),
  );
}

// The provider's own timing (R4-25): its closing date is shown, never turned into an Algoma expiry.
function describeClosing(closesOn, config, ownerName) {
  if (!closesOn) return { closesOn: null, passed: false, text: `${ownerName} hasn't listed a closing date.` };
  const passed = closesOn < today(config);
  return {
    closesOn,
    passed,
    text: passed
      ? `${ownerName} listed a closing date that has passed. Only ${ownerName} can say whether it is still open.`
      : `${ownerName} lists a closing date. Check ${ownerName} for the current date.`,
  };
}

function describeSourceState(row, ownerName) {
  switch (row.source_state) {
    case "not_seen":
      return {
        value: "not_seen",
        label: `No longer listed by ${ownerName}`,
        text: `${ownerName} stopped listing this: it was missing from a successful update. These are the last details we had; check ${ownerName} before relying on them.`,
        since: row.not_seen_since && new Date(row.not_seen_since).toISOString(),
      };
    case "withdrawn":
      return { value: "withdrawn", label: `Withdrawn by ${ownerName}`, text: `${ownerName} has withdrawn this opportunity.`, since: null };
    default:
      return { value: "listed", label: `Listed by ${ownerName}`, text: null, since: null };
  }
}

const COLUMNS = `eo.id, eo.source_id, eo.external_id, eo.title, eo.description, eo.areas, eo.authoritative_url,
  to_char(eo.closes_on, 'YYYY-MM-DD') AS closes_iso, eo.source_state, eo.first_seen_at, eo.last_seen_at,
  eo.not_seen_since, eo.last_changed_at`;

// Faculty interest that this viewer may see, named like supervisors are (R2-22, R4-18).
const INTEREST_JOIN = `FROM external_interest ei
  JOIN users ON users.id = ei.faculty_user_id
  JOIN faculty_profiles ON faculty_profiles.user_id = users.id`;

async function loadInterest(db, viewer, ids) {
  if (!ids.length) return [];
  const result = await db.query(
    `SELECT ei.external_opportunity_id, ei.note, ei.created_at, ei.updated_at, users.id, faculty_profiles.display_name
     ${INTEREST_JOIN}
     WHERE ei.external_opportunity_id = ANY($1::int[]) AND ${visibleSupervisorSql(viewer)}
     ORDER BY lower(faculty_profiles.display_name), users.id`,
    [ids],
  );
  return result.rows;
}

// What anyone may see of an external opportunity.
function toExternal(row, { source, interest, config }) {
  const ownerName = source?.ownerName || row.source_id;
  return {
    id: row.id,
    kind: "external",
    source: {
      id: row.source_id,
      name: source?.name || row.source_id,
      ownerName,
      externalId: row.external_id,
    },
    externallyOwned: true,
    title: row.title,
    description: row.description,
    researchAreas: row.areas || [],
    authoritativeUrl: row.authoritative_url,
    closing: describeClosing(row.closes_iso, config, ownerName),
    sourceState: describeSourceState(row, ownerName),
    freshness: {
      lastSuccessfulSyncAt: source?.lastSuccessfulSyncAt || null,
      lastSeenInSyncAt: row.last_seen_at && new Date(row.last_seen_at).toISOString(),
      lastChangedBySourceAt: row.last_changed_at && new Date(row.last_changed_at).toISOString(),
      stale: source ? source.stale : true,
      staleReason: source?.staleReason || null,
    },
    interestedFaculty: interest.map((i) => ({ id: i.id, displayName: i.display_name, note: i.note, since: new Date(i.created_at).toISOString() })),
    wording: wordingFor(ownerName),
  };
}

function filterSql(filters, params, viewer) {
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const hasInterest = (extra) =>
    `EXISTS (SELECT 1 ${INTEREST_JOIN} WHERE ei.external_opportunity_id = eo.id AND ${visibleSupervisorSql(viewer)} ${extra})`;
  const clauses = [];
  if (filters.area) clauses.push(`${add(filters.area)} = ANY(eo.areas)`);
  // External opportunities have no Algoma student level or term (R4-25: their timing is the source's).
  if (filters.level) clauses.push("false");
  if (filters.term) clauses.push("false");
  if (filters.facultyId) clauses.push(hasInterest(`AND users.id = ${add(filters.facultyId)}`));
  if (filters.q) {
    const pattern = add(likePattern(filters.q));
    clauses.push(`(eo.title ILIKE ${pattern} OR eo.description ILIKE ${pattern} OR s.owner_name ILIKE ${pattern}
      OR array_to_string(eo.areas, ' ') ILIKE ${pattern}
      OR ${hasInterest(`AND faculty_profiles.display_name ILIKE ${pattern}`)})`);
  }
  return clauses.map((c) => `AND ${c}`).join("\n");
}

function facetsFor(rows, interest) {
  const areaCounts = new Map();
  for (const area of rows.flatMap((row) => row.areas || [])) areaCounts.set(area, (areaCounts.get(area) || 0) + 1);
  const facultyCounts = new Map();
  for (const i of interest) {
    const entry = facultyCounts.get(i.id) || { id: i.id, displayName: i.display_name, count: 0 };
    entry.count += 1;
    facultyCounts.set(i.id, entry);
  }
  return {
    areas: RESEARCH_AREA_GROUPS.map((g) => ({
      group: g.group,
      areas: g.areas.filter((a) => areaCounts.has(a)).map((a) => ({ value: a, count: areaCounts.get(a) })),
    })).filter((g) => g.areas.length > 0),
    levels: [],
    terms: [],
    faculty: [...facultyCounts.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
  };
}

// R4-24: a student's confirmed Release 3 outcomes. Confirmed means a faculty participant
// confirmed it (R3-15); the student must be a participant.
async function confirmedOutcomesOf(db, email) {
  const result = await db.query(
    `SELECT o.id, o.summary, to_char(o.completed_on, 'YYYY-MM-DD') AS completed_on
     FROM outcomes o JOIN outcome_participants op ON op.outcome_id = o.id
     WHERE lower(op.email) = lower($1) AND op.role = 'student' AND o.confirmed_by IS NOT NULL
     ORDER BY o.completed_on DESC, o.id DESC`,
    [email],
  );
  return result.rows.map((r) => ({ id: r.id, summary: r.summary, completedOn: r.completed_on }));
}

// R4-21 to R4-24: readiness is a transparent suggestion and never gates anything. It is computed
// for the viewer only and never stored or ranked.
async function describeReadiness(db, guidance, viewer, ownerName) {
  if (!guidance || (!guidance.suggest_prior_outcome && !guidance.note)) return null;
  const readiness = {
    isRequirement: false,
    suggestion: guidance.suggest_prior_outcome
      ? "Students usually get more from this kind of advanced or funded opportunity after completing substantial project work."
      : null,
    basedOn: guidance.suggest_prior_outcome
      ? "Based only on project outcomes on this platform that you took part in and that a faculty member confirmed. Nothing else is checked, and nothing is scored or ranked."
      : null,
    note: guidance.note || null,
    reminder: `This is guidance, never a gate: you can still view this opportunity and apply through ${ownerName}.`,
    you: null,
  };
  const isStudent = viewer && !viewer.is_verified_faculty && !viewer.is_staff;
  if (guidance.suggest_prior_outcome && isStudent) {
    const outcomes = await confirmedOutcomesOf(db, viewer.email);
    readiness.you = {
      confirmedOutcomes: outcomes,
      meetsSuggestion: outcomes.length > 0,
      text: outcomes.length
        ? `You took part in ${outcomes.length} confirmed project outcome${outcomes.length === 1 ? "" : "s"} on this platform.`
        : `We don't see a confirmed project outcome for you on this platform yet. You can still apply through ${ownerName}.`,
    };
  }
  return readiness;
}

// R4-02: the listed external opportunities, narrowed by parsed `filters`, with filter choices and
// counts. Shared by GET /api/external-opportunities and GET /api/discovery (F-18).
async function listExternal({ db, config }, viewer, filters) {
  const FROM = "FROM external_opportunities eo JOIN external_sources s ON s.id = eo.source_id";
  const LISTED = "eo.source_state = 'listed'";
  const visible = await db.query(`SELECT ${COLUMNS} ${FROM} WHERE ${LISTED}`);
  const params = [];
  const result = await db.query(
    `SELECT ${COLUMNS} ${FROM} WHERE ${LISTED} ${filterSql(filters, params, viewer)} ORDER BY lower(eo.title), eo.id`,
    params,
  );
  const sources = await loadSourceStatus(db);
  const interest = await loadInterest(db, viewer, visible.rows.map((r) => r.id));
  return {
    opportunities: result.rows.map((row) =>
      toExternal(row, { source: sources.get(row.source_id), interest: interest.filter((i) => i.external_opportunity_id === row.id), config }),
    ),
    sources: [...sources.values()],
    filters: facetsFor(visible.rows, interest),
  };
}

function createExternalRouter({ db, config, auth }) {
  const router = express.Router();
  const FROM = "FROM external_opportunities eo JOIN external_sources s ON s.id = eo.source_id";

  async function loadOne(id) {
    const result = await db.query(`SELECT ${COLUMNS} ${FROM} WHERE eo.id = $1`, [id]);
    return result.rows[0] || null;
  }

  // R4-02, R4-03: discovery. Only records listed in the latest successful sync are browsed; the
  // detail page keeps working for the rest (R4-10). Takes the same filters as /api/projects.
  router.get("/", async (req, res, next) => {
    try {
      const { filters, error } = parseFilters(req.query);
      if (error) return res.status(400).json({ error });
      res.json(await listExternal({ db, config }, await auth.getSessionUser(req), filters));
    } catch (error) {
      next(error);
    }
  });

  // The signed-in user's own external opportunities: faculty interest (with whether the source
  // changed it since, R4-17) or a student's own tracking (R4-15).
  router.get("/mine", auth.requireAuth, async (req, res, next) => {
    try {
      const sources = await loadSourceStatus(db);
      const interests = await db.query(
        `SELECT ${COLUMNS}, ei.note AS my_note, ei.updated_at AS interest_at,
           (SELECT array_agg(DISTINCT f) FROM external_source_events ev, unnest(ev.changed_fields) f
             WHERE ev.external_opportunity_id = eo.id AND ev.occurred_at > ei.created_at) AS fields_changed_since,
           (SELECT array_agg(DISTINCT ev.kind) FROM external_source_events ev
             WHERE ev.external_opportunity_id = eo.id AND ev.occurred_at > ei.created_at) AS events_since
         ${FROM} JOIN external_interest ei ON ei.external_opportunity_id = eo.id AND ei.faculty_user_id = $1
         ORDER BY lower(eo.title)`,
        [req.user.id],
      );
      const links = await db.query(
        `SELECT ${COLUMNS}, l.status AS my_status, l.updated_at AS status_at
         ${FROM} JOIN external_student_links l ON l.external_opportunity_id = eo.id AND l.user_id = $1
         ORDER BY lower(eo.title)`,
        [req.user.id],
      );
      const shape = (row) => toExternal(row, { source: sources.get(row.source_id), interest: [], config });
      res.json({
        interests: interests.rows.map((row) => ({
          ...shape(row),
          myNote: row.my_note,
          changedSinceInterest: (row.events_since || []).length > 0,
          sourceEventsSinceInterest: row.events_since || [],
          fieldsChangedSinceInterest: row.fields_changed_since || [],
        })),
        tracking: links.rows.map((row) => ({ ...shape(row), myStatus: { value: row.my_status, label: STUDENT_STATUSES[row.my_status] } })),
        statuses: Object.entries(STUDENT_STATUSES).map(([value, label]) => ({ value, label })),
      });
    } catch (error) {
      next(error);
    }
  });

  // R4-04, R4-10, R4-13, R4-17, R4-19, R4-21: one external opportunity, in any source state.
  router.get("/:id", async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: "Invalid opportunity id." });
      const row = await loadOne(id);
      if (!row) return res.status(404).json({ error: "Opportunity not found." });
      const viewer = await auth.getSessionUser(req);
      const sources = await loadSourceStatus(db);
      const source = sources.get(row.source_id);
      const interest = await loadInterest(db, viewer, [id]);
      const opportunity = toExternal(row, { source, interest, config });

      const events = await db.query(
        `SELECT kind, changed_fields, previous, occurred_at FROM external_source_events
         WHERE external_opportunity_id = $1 ORDER BY id DESC LIMIT 50`,
        [id],
      );
      opportunity.sourceHistory = events.rows.map((e) => ({
        kind: e.kind,
        at: new Date(e.occurred_at).toISOString(),
        changedFields: e.changed_fields,
        text:
          `${opportunity.source.ownerName} ${SOURCE_EVENT_TEXT[e.kind] || e.kind}` +
          (e.changed_fields.length ? `: ${e.changed_fields.map((f) => FIELD_TEXT[f] || f).join(", ")} changed` : "") +
          ".",
        previousTitle: e.previous && e.changed_fields.includes("title") ? e.previous.title : null,
        previousClosesOn: e.previous && e.changed_fields.includes("closes") ? e.previous.closesOn : null,
      }));

      const guidance = (await db.query("SELECT * FROM external_guidance WHERE external_opportunity_id = $1", [id])).rows[0];
      opportunity.readiness = await describeReadiness(db, guidance, viewer, opportunity.source.ownerName);

      const isStudent = Boolean(viewer && !viewer.is_verified_faculty && !viewer.is_staff);
      opportunity.you = {
        signedIn: Boolean(viewer),
        canExpressInterest: Boolean(viewer?.is_verified_faculty),
        canEditGuidance: Boolean(viewer && (viewer.is_verified_faculty || viewer.is_staff)),
        canTrack: isStudent,
        interest: null,
        tracking: null,
      };
      if (viewer?.is_verified_faculty) {
        const mine = await db.query("SELECT note, created_at FROM external_interest WHERE external_opportunity_id = $1 AND faculty_user_id = $2", [id, viewer.id]);
        if (mine.rows[0]) {
          const since = new Date(mine.rows[0].created_at);
          opportunity.you.interest = {
            note: mine.rows[0].note,
            since: since.toISOString(),
            changedSinceInterest: opportunity.sourceHistory.filter((e) => new Date(e.at) > since).map((e) => e.text),
          };
        }
      }
      if (opportunity.you.canEditGuidance) {
        opportunity.you.guidance = { suggestPriorOutcome: Boolean(guidance?.suggest_prior_outcome), note: guidance?.note || "" };
      }
      if (isStudent) {
        const link = await db.query("SELECT status FROM external_student_links WHERE external_opportunity_id = $1 AND user_id = $2", [id, viewer.id]);
        const history = await db.query(
          "SELECT status, recorded_at FROM external_student_link_history WHERE external_opportunity_id = $1 AND user_id = $2 ORDER BY id DESC",
          [id, viewer.id],
        );
        opportunity.you.tracking = {
          status: link.rows[0]?.status || null,
          history: history.rows.map((h) => ({ status: h.status, label: STUDENT_STATUSES[h.status] || h.status, at: new Date(h.recorded_at).toISOString() })),
          statuses: Object.entries(STUDENT_STATUSES).map(([value, label]) => ({ value, label })),
          privacy: "Only you can see what you record here. It is your own note, not an application.",
        };
      }
      res.json({ opportunity });
    } catch (error) {
      next(error);
    }
  });

  // R4-18: a verified faculty member says they will support students pursuing it. Only for
  // themselves (req.user), like R2 willingness, and with a profile, because students see the name.
  router.put("/:id/interest", auth.requirePublicProfileChoice, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: "Invalid opportunity id." });
      const note = req.body?.note === undefined || req.body?.note === null ? "" : cleanText(req.body.note);
      if (note === null || note.length > NOTE_MAX) return res.status(400).json({ error: `Keep your note to ${NOTE_MAX} characters or fewer.` });
      if (!(await loadOne(id))) return res.status(404).json({ error: "Opportunity not found." });
      const profile = await db.query("SELECT 1 FROM faculty_profiles WHERE user_id = $1", [req.user.id]);
      if (!profile.rows[0]) {
        return res.status(409).json({
          error: "Write your faculty profile first, so students can see who is offering support.",
          code: "faculty_profile_required",
        });
      }
      await db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO external_interest (external_opportunity_id, faculty_user_id, note) VALUES ($1, $2, $3)
           ON CONFLICT (external_opportunity_id, faculty_user_id) DO UPDATE SET note = EXCLUDED.note, updated_at = now()`,
          [id, req.user.id, note || null],
        );
        await recordAudit(tx, { actorId: req.user.id, action: "external.support_add", subjectType: "external_opportunity", subjectId: id });
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id/interest", auth.requireVerifiedFaculty, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: "Invalid opportunity id." });
      await db.transaction(async (tx) => {
        const removed = await tx.query(
          "DELETE FROM external_interest WHERE external_opportunity_id = $1 AND faculty_user_id = $2 RETURNING faculty_user_id",
          [id, req.user.id],
        );
        if (removed.rows[0]) {
          await recordAudit(tx, { actorId: req.user.id, action: "external.support_remove", subjectType: "external_opportunity", subjectId: id });
        }
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  // R4-21, R4-22: local readiness guidance, set by verified faculty or staff. Only these two fields
  // are read; anything else in the body (title, link, ...) is ignored (R4-16).
  router.put("/:id/guidance", auth.requireVerifiedFacultyOrStaff, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: "Invalid opportunity id." });
      const suggest = req.body?.suggestPriorOutcome === true;
      const note = req.body?.note === undefined || req.body?.note === null ? "" : cleanText(req.body.note);
      if (note === null || note.length > NOTE_MAX) return res.status(400).json({ error: `Keep the guidance to ${NOTE_MAX} characters or fewer.` });
      if (!(await loadOne(id))) return res.status(404).json({ error: "Opportunity not found." });
      await db.transaction(async (tx) => {
        const before = await tx.query(
          "SELECT suggest_prior_outcome, note, updated_by FROM external_guidance WHERE external_opportunity_id = $1",
          [id],
        );
        await tx.query(
          `INSERT INTO external_guidance (external_opportunity_id, suggest_prior_outcome, note, updated_by) VALUES ($1, $2, $3, $4)
           ON CONFLICT (external_opportunity_id) DO UPDATE
           SET suggest_prior_outcome = EXCLUDED.suggest_prior_outcome, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [id, suggest, note || null, req.user.id],
        );
        // F-08: the earlier guidance is kept here, since the row holds only the latest.
        const prev = before.rows[0];
        await recordAudit(tx, {
          actorId: req.user.id,
          action: "external.guidance_set",
          subjectType: "external_opportunity",
          subjectId: id,
          detail: {
            from: prev ? { suggestPriorOutcome: prev.suggest_prior_outcome, note: prev.note, setBy: prev.updated_by } : null,
            to: { suggestPriorOutcome: suggest, note: note || null },
          },
        });
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  // R4-15: a student records their own association with it. Students only, for themselves.
  router.put("/:id/my-status", auth.requireAuth, async (req, res, next) => {
    try {
      if (req.user.is_verified_faculty || req.user.is_staff) {
        return res.status(403).json({ error: "Only students record their own progress on external opportunities." });
      }
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: "Invalid opportunity id." });
      const status = req.body?.status;
      if (!Object.hasOwn(STUDENT_STATUSES, status)) return res.status(400).json({ error: "Choose one of the listed options." });
      if (!(await loadOne(id))) return res.status(404).json({ error: "Opportunity not found." });
      await db.query(
        `INSERT INTO external_student_links (external_opportunity_id, user_id, status) VALUES ($1, $2, $3)
         ON CONFLICT (external_opportunity_id, user_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
        [id, req.user.id, status],
      );
      await db.query("INSERT INTO external_student_link_history (external_opportunity_id, user_id, status) VALUES ($1, $2, $3)", [id, req.user.id, status]);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createExternalRouter, listExternal, loadSourceStatus, STUDENT_STATUSES, wordingFor };
