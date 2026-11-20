// External sources (R4-01, R4-02). A source is an entry in SOURCES: who owns it, how to fetch its
// feed, and an adapter that turns the feed into the common record shape below. The opportunity
// model (migration 008) knows nothing about any particular source, so a second source is a new
// entry here, not a schema change.
//
// Common record shape produced by every adapter:
//   { externalId, title, description, areas: [canonical area], authoritativeUrl, closesOn: "YYYY-MM-DD" | null,
//     withdrawn: boolean }
//
// Everything a feed says is untrusted data (R4-07): it is normalised here, never interpreted, and
// only the fields above are ever stored. In particular the owner label comes from this file, never
// from the feed, so a record cannot relabel itself.
const fs = require("fs");
const path = require("path");
const { canonicalArea } = require("../catalog");

// The supplied feeds, bundled inside backend/ so the deployed service (whose root is
// project2/backend) can read them. test/external-sync.test.js checks they are identical to
// project2/r4_fixtures.
const FIXTURE_DIR = path.join(__dirname, "demo-feeds");

const LIMITS = { title: 300, description: 5000, externalId: 64, areas: 10 };

// Removes control characters (except newlines in descriptions) and trims. Never interprets markup.
function cleanSourceText(value, { multiline = false } = {}) {
  if (typeof value !== "string") return "";
  const stripped = value.replace(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, " ");
  return multiline ? stripped.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() : stripped.replace(/\s+/g, " ").trim();
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// The provider's link must be an http(s) URL on the provider's own site: a record cannot send
// students somewhere else by putting another address in its link (R4-04, R4-07).
function cleanProviderUrl(value, allowedHosts) {
  if (typeof value !== "string" || !value.trim()) return { error: "empty authoritative_url" };
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return { error: "authoritative_url is not a valid address" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { error: "authoritative_url is not a web address" };
  if (!allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    return { error: `authoritative_url is not on the provider's site (${allowedHosts.join(", ")})` };
  }
  if (url.username || url.password) return { error: "authoritative_url contains credentials" };
  return { url: url.toString() };
}

// Normalises one record of a feed shaped like the Mitacs demonstration feed. Returns { record } or
// { reasons: [...] } when the record can't be used; the reasons are reported, not thrown (R4-12).
function normaliseMitacsRecord(raw, { allowedHosts }) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { reasons: ["record is not an object"] };
  const reasons = [];
  const externalId = cleanSourceText(raw.external_id);
  if (!externalId) reasons.push("empty external_id");
  else if (externalId.length > LIMITS.externalId || !/^[A-Za-z0-9._:-]+$/.test(externalId)) reasons.push("external_id has unexpected characters");
  const title = cleanSourceText(raw.title).slice(0, LIMITS.title);
  if (!title) reasons.push("empty title");
  const description = cleanSourceText(raw.description, { multiline: true }).slice(0, LIMITS.description);
  const link = cleanProviderUrl(raw.authoritative_url, allowedHosts);
  if (link.error) reasons.push(link.error);
  let closesOn = null;
  if (raw.closes !== undefined && raw.closes !== null && raw.closes !== "") {
    if (isIsoDate(raw.closes)) closesOn = raw.closes;
    else reasons.push("unparseable closes date");
  }
  const areas = [];
  for (const area of Array.isArray(raw.areas) ? raw.areas : []) {
    const known = canonicalArea(area);
    if (known && !areas.includes(known) && areas.length < LIMITS.areas) areas.push(known);
  }
  if (reasons.length) return { reasons, externalId: externalId || null };
  return {
    record: {
      externalId,
      title,
      description,
      areas,
      authoritativeUrl: link.url,
      closesOn,
      withdrawn: typeof raw.status === "string" && raw.status.trim().toLowerCase() === "withdrawn",
    },
  };
}

class FeedError extends Error {}

// Turns a whole parsed feed into { records, malformed, syncedAt }. Throws FeedError when the feed
// as a whole is unusable (wrong source, no record list): that fails the run (R4-11).
function adaptMitacsFeed(feed, source) {
  if (!feed || typeof feed !== "object" || Array.isArray(feed)) throw new FeedError("The response is not a feed object.");
  if (feed.source_id !== source.id) throw new FeedError(`The feed is for source "${String(feed.source_id).slice(0, 40)}", not ${source.id}.`);
  if (!Array.isArray(feed.records)) throw new FeedError("The feed has no list of records.");
  const records = [];
  const malformed = [];
  const seen = new Set();
  feed.records.forEach((raw, index) => {
    const result = normaliseMitacsRecord(raw, source);
    if (result.record && seen.has(result.record.externalId)) {
      malformed.push({ position: index + 1, externalId: result.record.externalId, reasons: ["duplicate external_id in the same feed"] });
      return;
    }
    if (result.reasons) {
      malformed.push({ position: index + 1, externalId: result.externalId, reasons: result.reasons });
      return;
    }
    seen.add(result.record.externalId);
    records.push(result.record);
  });
  const syncedAt = isIsoDate(feed.synced_at) ? feed.synced_at : null;
  return { records, malformed, syncedAt };
}

// The demonstration provider. There is no real Mitacs integration (an R4 non-requirement): the
// supplied feeds stand in for it, and an operator chooses which one the "provider" returns, or
// simulates the provider failing (R4-11).
const DEMO_FEEDS = {
  v1: { label: "Feed v1 (last week)", file: "external_source_feed_v1.json" },
  v2: { label: "Feed v2 (this week)", file: "external_source_feed_v2.json" },
  unreachable: { label: "Simulated failure: source unreachable" },
  unparseable: { label: "Simulated failure: response cannot be parsed" },
};

async function fetchDemoFeed(choice) {
  if (choice === "unreachable") throw new FeedError("The source could not be reached (simulated: connection timed out).");
  if (choice === "unparseable") return '{"source_id": "mitacs-demo", "records": [ {"external_id": "MX-10';
  const feed = DEMO_FEEDS[choice];
  if (!feed?.file) throw new FeedError("Unknown feed.");
  return fs.readFileSync(path.join(FIXTURE_DIR, feed.file), "utf8");
}

const SOURCES = {
  "mitacs-demo": {
    id: "mitacs-demo",
    name: "Mitacs (synthetic demonstration feed)",
    ownerName: "Mitacs",
    allowedHosts: ["mitacs.example", "mitacs.ca"],
    feeds: DEMO_FEEDS,
    fetchFeed: fetchDemoFeed,
    adapt: adaptMitacsFeed,
  },
};

module.exports = { SOURCES, FeedError, adaptMitacsFeed, normaliseMitacsRecord, cleanSourceText, isIsoDate, FIXTURE_DIR };
