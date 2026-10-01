// Input clean-up shared by the profile and project routes.

// Trims and collapses runs of whitespace. Returns null for anything that isn't a string.
function cleanText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : null;
}

// Research/project areas: a list of 1 to `max` short labels, blanks skipped and duplicates
// dropped case-insensitively. Returns { areas } or { error }.
function cleanAreas(value, { max, maxLength }) {
  if (!Array.isArray(value)) return { error: "Enter at least one research or project area." };
  const areas = [];
  const seen = new Set();
  for (const raw of value) {
    const area = cleanText(raw);
    if (area === null) return { error: "Research areas must be text." };
    if (!area || seen.has(area.toLowerCase())) continue;
    if (area.length > maxLength) {
      return { error: `Each research area must be ${maxLength} characters or fewer.` };
    }
    seen.add(area.toLowerCase());
    areas.push(area);
  }
  if (areas.length === 0) return { error: "Enter at least one research or project area." };
  if (areas.length > max) return { error: `List at most ${max} research areas.` };
  return { areas };
}

module.exports = { cleanText, cleanAreas };
