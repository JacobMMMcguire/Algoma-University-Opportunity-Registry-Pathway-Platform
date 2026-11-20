// Synchronisation (R4-08 to R4-12, R4-15, R4-17). One run:
//   1. records an attempt in external_sync_runs;
//   2. fetches and parses the feed, and adapts it (src/external/sources.js). Any failure here
//      fails the run and touches no opportunity (R4-11);
//   3. in one transaction, classifies every record against the stored copy and writes only the
//      source-controlled columns of external_opportunities (R4-15, R4-16). Malformed records are
//      reported and skipped (R4-12).
// Local tables (interest, student links, guidance) are keyed by the local id and are never
// written here, so nothing local can be overwritten (R4-15, R4-20).
const { FeedError } = require("./sources");

// The source-controlled fields compared to decide "changed" (R4-08, R4-09), in the names
// expected_sync_results.json uses. Areas compare as a set, so a reordering is not a change.
const FIELDS = [
  { name: "title", column: "title", of: (r) => r.title },
  { name: "description", column: "description", of: (r) => r.description },
  { name: "areas", column: "areas", of: (r) => [...r.areas].sort().join("\u0001") },
  { name: "authoritative_url", column: "authoritative_url", of: (r) => r.authoritativeUrl },
  { name: "closes", column: "closes_on", of: (r) => r.closesOn || "" },
];

function fromRow(row) {
  return {
    title: row.title,
    description: row.description,
    areas: row.areas || [],
    authoritativeUrl: row.authoritative_url,
    closesOn: row.closes_iso || null,
  };
}

function changedFields(stored, incoming) {
  return FIELDS.filter((f) => f.of(stored) !== f.of(incoming)).map((f) => f.name);
}

const EMPTY_COUNTS = { new: 0, unchanged: 0, changed: 0, reappeared: 0, withdrawn: 0, not_seen: 0, still_not_seen: 0, malformed: 0 };

async function ensureSource(db, source) {
  await db.query(
    `INSERT INTO external_sources (id, name, owner_name) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, owner_name = EXCLUDED.owner_name`,
    [source.id, source.name, source.ownerName],
  );
}

async function failRun(db, runId, reason) {
  await db.query(
    "UPDATE external_sync_runs SET status = 'failed', failure_reason = $2, finished_at = now() WHERE id = $1",
    [runId, reason.slice(0, 500)],
  );
  return { runId, status: "failed", failureReason: reason };
}

// Runs one sync of `source`, asking its provider for `feedChoice`. Never throws for a provider
// problem: the run is recorded as failed instead. Returns a summary of the run.
async function runSync(db, source, feedChoice, { triggeredBy = null } = {}) {
  await ensureSource(db, source);
  const feedLabel = source.feeds[feedChoice]?.label || String(feedChoice).slice(0, 60);
  const started = await db.query(
    "INSERT INTO external_sync_runs (source_id, feed_label, triggered_by) VALUES ($1, $2, $3) RETURNING id",
    [source.id, feedLabel, triggeredBy],
  );
  const runId = started.rows[0].id;

  let adapted;
  try {
    const body = await source.fetchFeed(feedChoice);
    let feed;
    try {
      feed = typeof body === "string" ? JSON.parse(body) : body;
    } catch {
      throw new FeedError("The source's response could not be parsed as a feed.");
    }
    adapted = source.adapt(feed, source);
  } catch (error) {
    const reason = error instanceof FeedError ? error.message : `The source could not be read: ${error.message}`;
    return failRun(db, runId, reason);
  }

  try {
    return await db.transaction(async (tx) => {
      // One sync per source at a time.
      await tx.query("SELECT id FROM external_sources WHERE id = $1 FOR UPDATE", [source.id]);
      const existing = await tx.query("SELECT *, to_char(closes_on, 'YYYY-MM-DD') AS closes_iso FROM external_opportunities WHERE source_id = $1", [source.id]);
      const byExternalId = new Map(existing.rows.map((row) => [row.external_id, row]));
      const counts = { ...EMPTY_COUNTS, malformed: adapted.malformed.length };
      const items = [];
      const now = new Date().toISOString();

      const record = async (opportunityId, externalId, classification, fields = []) => {
        counts[classification] += 1;
        items.push({ externalId, classification, changedFields: fields });
        await tx.query(
          `INSERT INTO external_sync_items (run_id, external_opportunity_id, external_id, classification, changed_fields)
           VALUES ($1, $2, $3, $4, $5)`,
          [runId, opportunityId, externalId, classification, fields],
        );
      };
      const event = (opportunityId, kind, fields = [], previous = null) =>
        tx.query(
          `INSERT INTO external_source_events (external_opportunity_id, run_id, kind, changed_fields, previous, occurred_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [opportunityId, runId, kind, fields, previous && JSON.stringify(previous), now],
        );

      for (const r of adapted.records) {
        const stored = byExternalId.get(r.externalId);
        const state = r.withdrawn ? "withdrawn" : "listed";
        if (!stored) {
          const inserted = await tx.query(
            `INSERT INTO external_opportunities
               (source_id, external_id, title, description, areas, authoritative_url, closes_on, source_state, first_seen_at, last_seen_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
            [source.id, r.externalId, r.title, r.description, r.areas, r.authoritativeUrl, r.closesOn, state, now],
          );
          await record(inserted.rows[0].id, r.externalId, "new");
          continue;
        }
        byExternalId.delete(r.externalId);
        const previous = fromRow(stored);
        const fields = changedFields(previous, r);
        let classification = fields.length ? "changed" : "unchanged";
        if (state === "withdrawn" && stored.source_state !== "withdrawn") classification = "withdrawn";
        else if (state === "listed" && stored.source_state !== "listed") classification = "reappeared";

        await tx.query(
          `UPDATE external_opportunities
           SET title = $2, description = $3, areas = $4, authoritative_url = $5, closes_on = $6, source_state = $7,
               last_seen_at = $8, not_seen_since = CASE WHEN $7 = 'listed' THEN NULL ELSE not_seen_since END,
               last_changed_at = CASE WHEN $9 THEN $8::timestamptz ELSE last_changed_at END
           WHERE id = $1`,
          [stored.id, r.title, r.description, r.areas, r.authoritativeUrl, r.closesOn, state, now, fields.length > 0],
        );
        if (classification === "reappeared" || classification === "withdrawn") await event(stored.id, classification, fields, fields.length ? previous : null);
        else if (fields.length) await event(stored.id, "changed", fields, previous);
        await record(stored.id, r.externalId, classification, fields);
      }

      // R4-10: what a successful sync didn't mention is "not seen", never deleted. Already not-seen
      // records are counted separately, so they aren't reported as newly disappeared (R4-09).
      for (const stored of byExternalId.values()) {
        if (stored.source_state === "listed") {
          await tx.query("UPDATE external_opportunities SET source_state = 'not_seen', not_seen_since = $2 WHERE id = $1", [stored.id, now]);
          await event(stored.id, "not_seen");
          await record(stored.id, stored.external_id, "not_seen");
        } else if (stored.source_state === "not_seen") {
          await record(stored.id, stored.external_id, "still_not_seen");
        }
      }

      await tx.query(
        `UPDATE external_sync_runs SET status = 'succeeded', counts = $2, malformed = $3, feed_synced_at = $4, finished_at = now()
         WHERE id = $1`,
        [runId, JSON.stringify(counts), JSON.stringify(adapted.malformed), adapted.syncedAt],
      );
      return { runId, status: "succeeded", counts, items, malformed: adapted.malformed };
    });
  } catch (error) {
    console.error("External sync failed while saving:", error.message);
    return failRun(db, runId, "The sync could not be saved; nothing was changed.");
  }
}

module.exports = { runSync, EMPTY_COUNTS };
