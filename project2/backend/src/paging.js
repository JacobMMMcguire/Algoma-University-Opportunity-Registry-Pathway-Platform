// F-18, F-19 (FINAL_PLAN.md D6): lists that grow with use are sent a page at a time. A request
// with `limit` (default 20, at most 50) or `offset` gets one page and `next` (the offset of the
// following page, or null). A request with neither gets the whole list as before, so earlier
// clients and the evaluation adapter keep working; the pages always ask for one page.
const PAGE = { default: 20, max: 50 };

function pageRequest(query) {
  if (query.limit === undefined && query.offset === undefined) return null;
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || PAGE.default, 1), PAGE.max);
  const offset = Math.max(Number.parseInt(query.offset, 10) || 0, 0);
  return { limit, offset };
}

function pageOf(list, { limit, offset }) {
  return {
    items: list.slice(offset, offset + limit),
    total: list.length,
    offset,
    limit,
    next: offset + limit < list.length ? offset + limit : null,
  };
}

// `?q=` for searching a staff queue: trimmed, at most 100 characters, lower-cased, or null.
function searchText(query) {
  if (typeof query.q !== "string") return null;
  const q = query.q.trim().slice(0, 100).toLowerCase();
  return q || null;
}

module.exports = { PAGE, pageOf, pageRequest, searchText };
