// Shared by every page: <script src="common.js"></script> before the page's own script.

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Calls the API on this same origin. Never throws: network failures come back as status 0.
async function api(path, { method = "GET", body } = {}) {
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "Could not reach the server. Check your connection and try again." } };
  }
}

// { authenticated, testMode, user? } where user has id, email, isStaff, isVerifiedFaculty,
// publicProfileChoice (true, false or null if not chosen yet) and publiclyVisible.
async function getSession() {
  const res = await api("/api/auth/me");
  return res.ok ? res.data : { authenticated: false, testMode: false };
}

// Add links for new pages here. `show` decides visibility from the session.
const NAV_LINKS = [
  { href: "index.html", label: "Home" },
  { href: "faculty.html", label: "Faculty" },
  { href: "projects.html", label: "Projects" },
  { href: "profile.html", label: "Your faculty profile", show: (s) => s.user?.isVerifiedFaculty },
  { href: "my-projects.html", label: "Your projects", show: (s) => s.user?.isVerifiedFaculty },
  { href: "admin.html", label: "Staff: faculty verification", show: (s) => s.user?.isStaff },
  { href: "operator.html", label: "Operator console (test mode)", show: (s) => s.testMode },
];

function renderNav(session) {
  const nav = document.getElementById("site-nav");
  if (!nav) return;
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
