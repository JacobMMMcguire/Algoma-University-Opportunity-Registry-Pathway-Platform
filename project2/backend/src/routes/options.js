const express = require("express");
const { PARTNER_CAPACITIES, RESEARCH_AREA_GROUPS, STUDENT_LEVELS, TERM_SEASONS, termYears } = require("../catalog");

// The fixed lists the profile, project and partner intake forms offer, so the browser never has its own copy.
function createOptionsRouter() {
  const router = express.Router();
  router.get("/", (_req, res) => {
    res.json({
      researchAreaGroups: RESEARCH_AREA_GROUPS,
      studentLevels: STUDENT_LEVELS,
      termSeasons: TERM_SEASONS,
      termYears: termYears(),
      partnerCapacities: PARTNER_CAPACITIES,
    });
  });
  return router;
}

module.exports = { createOptionsRouter };
