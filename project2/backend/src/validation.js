// Input clean-up shared by the profile and project routes.
const { canonicalArea } = require("./catalog");

// Trims and collapses runs of whitespace. Returns null for anything that isn't a string.
function cleanText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : null;
}

// Research/project areas: 1 to `max` names from the fixed list in src/catalog.js, matched
// case-insensitively and stored in the list's spelling, duplicates dropped.
// Returns { areas } or { error }.
function cleanAreas(value, { max }) {
  if (!Array.isArray(value)) return { error: "Choose at least one research or project area." };
  const areas = [];
  for (const raw of value) {
    if (typeof raw === "string" && !raw.trim()) continue;
    const area = canonicalArea(raw);
    if (area === null) return { error: `"${String(raw).slice(0, 60)}" is not one of the listed research areas.` };
    if (!areas.includes(area)) areas.push(area);
  }
  if (areas.length === 0) return { error: "Choose at least one research or project area." };
  if (areas.length > max) return { error: `Choose at most ${max} research areas.` };
  return { areas };
}

// Positive integer ids within Postgres INTEGER range; anything else is null.
function parseId(value) {
  return /^\d{1,9}$/.test(value) ? Number(value) : null;
}

// Escapes % and _ so user text is matched literally inside an ILIKE pattern.
function likePattern(text) {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

module.exports = { cleanText, cleanAreas, parseId, likePattern };
