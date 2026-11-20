// /api/external-sync: triggering syncs and observing sync health (R4-08 to R4-14, R4-26).
// Staff only (the "authorised operator"); everyone else gets 401/403 whatever the request says.
// Ordinary users only ever see freshness in plain language (routes/external.js), never these logs.
const express = require("express");
const { SOURCES } = require("../external/sources");
const { runSync } = require("../external/sync");
const { parseId } = require("../validation");

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

function toRun(row) {
  return {
    id: row.id,
    sourceId: row.source_id,
    feed: row.feed_label,
    status: row.status,
    failureReason: row.failure_reason,
    feedSyncedAt: row.feed_synced_at,
    counts: row.counts,
    malformed: row.malformed,
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    triggeredBy: row.triggered_by_email || null,
  };
}

const RUN_SELECT = `SELECT r.*, u.email AS triggered_by_email FROM external_sync_runs r LEFT JOIN users u ON u.id = r.triggered_by`;

function createExternalSyncRouter({ db, config, auth }) {
  const router = express.Router();
  router.use(auth.requireStaff);

  router.get("/health", async (_req, res, next) => {
    try {
      const sources = [];
      for (const source of Object.values(SOURCES)) {
        const runs = await db.query(`${RUN_SELECT} WHERE r.source_id = $1 ORDER BY r.id DESC LIMIT 15`, [source.id]);
        const lastSuccess = await db.query(`${RUN_SELECT} WHERE r.source_id = $1 AND r.status = 'succeeded' ORDER BY r.id DESC LIMIT 1`, [source.id]);
        const lastFailure = await db.query(`${RUN_SELECT} WHERE r.source_id = $1 AND r.status = 'failed' ORDER BY r.id DESC LIMIT 1`, [source.id]);
        const states = await db.query(
          "SELECT source_state, count(*)::int AS n FROM external_opportunities WHERE source_id = $1 GROUP BY source_state",
          [source.id],
        );
        const success = lastSuccess.rows[0] ? toRun(lastSuccess.rows[0]) : null;
        const failure = lastFailure.rows[0] ? toRun(lastFailure.rows[0]) : null;
        const latest = runs.rows[0] ? toRun(runs.rows[0]) : null;
        const healthy = Boolean(success && latest && latest.status === "succeeded");
        sources.push({
          id: source.id,
          name: source.name,
          ownerName: source.ownerName,
          health: {
            healthy,
            summary: !latest
              ? "Never synchronised."
              : healthy
                ? "Healthy: the latest sync succeeded."
                : latest.status === "running"
                  ? "A sync is running."
                  : "Unhealthy: the latest sync failed. Students see the last successful data, labelled as possibly out of date.",
          },
          lastSuccessfulRun: success,
          lastFailedRun: failure,
          recentRuns: runs.rows.map(toRun),
          storedByState: Object.fromEntries(states.rows.map((r) => [r.source_state, r.n])),
          feeds: Object.entries(source.feeds).map(([value, f]) => ({ value, label: f.label })),
        });
      }
      res.json({ sources, resetAvailable: config.testMode });
    } catch (error) {
      next(error);
    }
  });

  // One run's per-record classification (R4-08).
  router.get("/runs/:id", async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: "Invalid run id." });
      const run = await db.query(`${RUN_SELECT} WHERE r.id = $1`, [id]);
      if (!run.rows[0]) return res.status(404).json({ error: "Sync run not found." });
      const items = await db.query(
        `SELECT i.external_id, i.classification, i.changed_fields, i.external_opportunity_id
         FROM external_sync_items i WHERE i.run_id = $1 ORDER BY i.external_id`,
        [id],
      );
      res.json({
        run: toRun(run.rows[0]),
        items: items.rows.map((i) => ({
          externalId: i.external_id,
          opportunityId: i.external_opportunity_id,
          classification: i.classification,
          changedFields: i.changed_fields,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  // Triggers a sync. `feed` picks what the demonstration provider returns: v1, v2, or a simulated
  // failure (unreachable, unparseable).
  router.post("/run", async (req, res, next) => {
    try {
      const source = SOURCES[req.body?.sourceId];
      if (!source) return res.status(400).json({ error: "Unknown source." });
      if (!Object.hasOwn(source.feeds, req.body?.feed)) return res.status(400).json({ error: "Unknown feed." });
      const result = await runSync(db, source, req.body.feed, { triggeredBy: req.user.id });
      // 200 either way: the trigger worked. Whether the provider did is `status` (and the run log).
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // Evaluation only (test mode): returns the synthetic demonstration source to "never synced", so
  // a reviewer can run v1 then v2 and compare with expected_sync_results.json. It removes that
  // source's copies, its sync history and the local data attached to those copies. Normal syncs
  // never delete anything (R4-10, R4-11).
  router.post("/reset", async (req, res, next) => {
    try {
      if (!config.testMode) return res.status(403).json({ error: "Resetting a source is only available in test mode." });
      const source = SOURCES[req.body?.sourceId];
      if (!source) return res.status(400).json({ error: "Unknown source." });
      if (req.body?.confirm !== true) return res.status(400).json({ error: "Confirm the reset." });
      await db.transaction(async (tx) => {
        await tx.query("DELETE FROM external_opportunities WHERE source_id = $1", [source.id]);
        await tx.query("DELETE FROM external_sync_runs WHERE source_id = $1", [source.id]);
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createExternalSyncRouter };
