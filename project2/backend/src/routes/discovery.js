// GET /api/discovery (F-18, FINAL_PLAN.md D6): one page of everything a student can browse on
// /projects.html (faculty projects, industry opportunities and external opportunities) sorted
// by title, with the same filters and visibility rules as the three separate lists, which it
// reuses. The page loads 20 at a time instead of every record, and "Show more" asks for the next.
//
// Query: the R1-20 filters (q, area, level, term, facultyId), `type` (faculty | industry |
// external), `limit` (default 20, at most 50) and `offset` (the previous page's `next`).
const express = require("express");
const { listExternal } = require("./external");
const { listOpportunities } = require("./opportunities");
const { listProjects, parseFilters } = require("./projects");

const { PAGE, pageOf, pageRequest } = require("../paging");

const TYPES = ["faculty", "industry", "external"];

function createDiscoveryRouter({ db, config, auth }) {
  const router = express.Router();

  router.get("/", async (req, res, next) => {
    try {
      const { filters, error } = parseFilters(req.query);
      if (error) return res.status(400).json({ error });
      const type = req.query.type || "";
      if (type && !TYPES.includes(type)) return res.status(400).json({ error: "Unknown type." });
      const pageReq = pageRequest(req.query) || { limit: PAGE.default, offset: 0 };
      const viewer = await auth.getSessionUser(req);
      const deps = { db, config };
      const projects = await listProjects(deps, viewer, filters);
      const industry = await listOpportunities(deps, viewer, filters);
      // External opportunities are an extra: if they can't load, local discovery still works (R4).
      let external = { opportunities: [], filters: { areas: [], levels: [], terms: [], faculty: [] } };
      let externalUnavailable = false;
      try {
        external = await listExternal(deps, viewer, filters);
      } catch (externalError) {
        console.error("Discovery could not load external opportunities:", externalError.message);
        externalUnavailable = true;
      }

      const all = [
        ...projects.projects.map((record) => ({ kind: "faculty", record })),
        ...industry.opportunities.map((record) => ({ kind: "industry", record })),
        ...external.opportunities.map((record) => ({ kind: "external", record })),
      ];
      const counts = Object.fromEntries(TYPES.map((t) => [t, all.filter((i) => i.kind === t).length]));
      const matching = all
        .filter((i) => !type || i.kind === type)
        .sort(
          (a, b) =>
            a.record.title.toLowerCase().localeCompare(b.record.title.toLowerCase()) ||
            TYPES.indexOf(a.kind) - TYPES.indexOf(b.kind) ||
            a.record.id - b.record.id,
        );
      res.json({
        ...pageOf(matching, pageReq),
        counts,
        filters: { faculty: projects.filters, industry: industry.filters, external: external.filters },
        externalUnavailable,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createDiscoveryRouter, PAGE };
