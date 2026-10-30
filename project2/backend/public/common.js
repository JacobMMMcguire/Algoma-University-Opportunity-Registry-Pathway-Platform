// Shared by every page: <script src="common.js"></script> before the page's own script.

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Calls the API on this same origin. Never throws: network failures come back as status 0.
async function api(path, { method = "GET", body, headers = {} } = {}) {
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "Could not reach the server. Check your connection and try again." } };
  }
}

// { authenticated, testMode, clock, user? } where user has id, email, isStaff, isVerifiedFaculty,
// publicProfileChoice (true, false or null if not chosen yet) and publiclyVisible, and clock is
// { today, simulated, label }: the date deadlines are evaluated against (R3-08).
async function getSession() {
  const res = await api("/api/auth/me");
  return res.ok ? res.data : { authenticated: false, testMode: false };
}

// Add links for new pages here. `show` decides visibility from the session.
const NAV_LINKS = [
  { href: "index.html", label: "Home" },
  { href: "faculty.html", label: "Faculty" },
  { href: "projects.html", label: "Projects" },
  { href: "partner.html", label: "Propose a project (organisations)" },
  { href: "profile.html", label: "Your faculty profile", show: (s) => s.user?.isVerifiedFaculty },
  { href: "my-projects.html", label: "Your projects", show: (s) => s.user?.isVerifiedFaculty },
  { href: "submissions.html", label: "Industry opportunities (faculty)", show: (s) => s.user?.isVerifiedFaculty || s.user?.isStaff },
  { href: "notifications.html", label: "Notifications", show: (s) => s.user?.isVerifiedFaculty },
  { href: "lifecycle.html", label: "Terms and deadlines", show: (s) => s.user?.isVerifiedFaculty || s.user?.isStaff },
  { href: "matches.html", label: "Matches", show: (s) => s.user && (s.user.isVerifiedFaculty || !s.user.isStaff) },
  { href: "student-profile.html", label: "Your student profile", show: (s) => s.user && !s.user.isVerifiedFaculty && !s.user.isStaff },
  { href: "admin.html", label: "Staff: faculty verification", show: (s) => s.user?.isStaff },
  { href: "operator.html", label: "Operator console (test mode)", show: (s) => s.testMode },
];

function renderNav(session) {
  const nav = document.getElementById("site-nav");
  if (!nav) return;
  renderClockNote(session);
  const current = location.pathname.split("/").pop() || "index.html";
  nav.innerHTML =
    "<ul>" +
    NAV_LINKS.filter((link) => !link.show || link.show(session))
      .map((link) => {
        const here = link.href === current ? ' aria-current="page"' : "";
        return `<li><a href="${link.href}"${here}>${escapeHtml(link.label)}</a></li>`;
      })
      .join("") +
    "</ul>";
}

// R3_PLAN.md D3: when the server's clock is set to a fixed date (for evaluating the R3 fixture),
// every page says so, so nobody mistakes "expired" for a real-world fact.
function renderClockNote(session) {
  if (!session.clock?.simulated || document.getElementById("clock-note")) return;
  const note = document.createElement("p");
  note.id = "clock-note";
  note.className = "clock-note";
  note.textContent = `Deadlines are evaluated as of ${session.clock.label} (a simulated date, set for evaluation).`;
  document.querySelector("header")?.prepend(note);
}

// "2026-10-20" -> "20 October 2026", without letting a time zone shift the day.
function formatDay(isoDate) {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${day} ${months[month - 1]} ${year}`;
}

// The not-found section of a detail page. R3-19: a record that is no longer listed says why,
// e.g. "Expired: the deadline, 20 October 2026, passed without a confirmed match."
function showNotFound(res, session) {
  const removed = res.data?.removed;
  const heading = document.querySelector("#not-found h1");
  const text = document.getElementById("not-found-text");
  if (removed) {
    heading.textContent = `No longer listed: ${removed.title}`;
    text.textContent = removed.lifecycle.reason;
  } else {
    text.textContent = session.authenticated
      ? "This project doesn't exist or is no longer available."
      : "This project doesn't exist or isn't available publicly. Signing in may let you see it.";
  }
  document.getElementById("not-found").hidden = false;
}

// Plain-language project status, for the owner's pages.
const PROJECT_STATUS_LABELS = {
  draft: "Draft: only you can see it",
  published: "Published",
  closed: "Closed: withdrawn from students",
};

// Shows a message in a role="status" element; errors are styled and announced the same way.
function showStatus(element, message, { error = false } = {}) {
  element.textContent = message;
  element.classList.toggle("error", error);
}

// API errors with a `code` the user can fix themselves get a link to where they fix it.
const ERROR_FIX_LINKS = {
  faculty_profile_required: { href: "profile.html", label: "Write your faculty profile" },
  public_profile_choice_required: { href: "index.html", label: "Choose on the home page" },
};

function showApiError(element, res, fallback) {
  showStatus(element, res.data.error || fallback, { error: true });
  const fix = ERROR_FIX_LINKS[res.data.code];
  if (fix) {
    const link = document.createElement("a");
    link.href = fix.href;
    link.textContent = fix.label;
    element.append(" ", link);
  }
}
