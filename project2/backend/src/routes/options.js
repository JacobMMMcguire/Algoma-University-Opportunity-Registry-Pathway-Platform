const express = require("express");
const { RESEARCH_AREA_GROUPS, STUDENT_LEVELS, TERM_SEASONS, termYears } = require("../catalog");

// The fixed lists the profile and project forms offer, so the browser never has its own copy.
function createOptionsRouter() {
  const router = express.Router();
  router.get("/", (_req, res) => {
    res.json({
      researchAreaGroups: RESEARCH_AREA_GROUPS,
      studentLevels: STUDENT_LEVELS,
      termSeasons: TERM_SEASONS,
      termYears: termYears(),
    });
  });
  return router;
}

module.exports = { createOptionsRouter };
