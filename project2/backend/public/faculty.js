const $ = (id) => document.getElementById(id);
const statusEl = $("status");

function renderList(faculty, session) {
  $("list-note").textContent = session.authenticated
    ? "Showing every faculty member with a profile, including those visible only to signed-in users."
    : "Showing faculty who have chosen to share their profile publicly. Sign in to see more.";
  $("faculty-list").innerHTML = faculty.length
    ? faculty
        .map(
          (p) => `<li class="card">
            <h2><a href="faculty.html?id=${encodeURIComponent(p.id)}">${escapeHtml(p.displayName)}</a></h2>
            <p>${escapeHtml(p.researchAreas.join(" · "))}</p>
            <p class="hint">${escapeHtml(p.inquiryPreference.label)}</p>
          </li>`,
        )
        .join("")
    : "<li>No faculty profiles to show yet.</li>";
  $("list-view").hidden = false;
}

function renderProfile(profile) {
  document.title = `${profile.displayName} — Opportunity Registry`;
  $("profile-name").textContent = profile.displayName;
  $("profile-audience").hidden = profile.publiclyVisible;
  $("inquiry-label").textContent = profile.inquiryPreference.label;
  $("inquiry-explanation").textContent = profile.inquiryPreference.explanation;
  $("profile-description").textContent = profile.description;

  $("profile-areas").replaceChildren(
    ...profile.researchAreas.map((area) => {
      const li = document.createElement("li");
      li.textContent = area;
      return li;
    }),
  );

  // Links were checked server-side to be http(s), so they can't run script.
  $("profile-links").replaceChildren(
    ...profile.externalLinks.map((href) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = href;
      a.rel = "noopener noreferrer";
      a.textContent = href;
      li.append(a);
      return li;
    }),
  );
  $("links-section").hidden = profile.externalLinks.length === 0;
  $("profile-view").hidden = false;
}

// Their published projects, filtered by the same visibility rule as the projects page.
async function renderProjects(facultyId) {
  const res = await api(`/api/projects?facultyId=${encodeURIComponent(facultyId)}`);
  if (!res.ok || res.data.projects.length === 0) return;
  $("profile-projects").replaceChildren(
    ...res.data.projects.map((project) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = `projects.html?id=${encodeURIComponent(project.id)}`;
      a.textContent = project.title;
      li.append(a, document.createTextNode(` (${project.targetTerm})`));
      return li;
    }),
  );
  $("projects-section").hidden = false;
}

function renderNotFound(session) {
  $("not-found-text").textContent = session.authenticated
    ? "This faculty profile doesn't exist or is no longer available."
    : "This faculty profile doesn't exist or isn't available publicly. Signing in may let you see it.";
  $("not-found").hidden = false;
}

(async () => {
  const session = await getSession();
  renderNav(session);
  const id = new URLSearchParams(location.search).get("id");

  if (id === null) {
    const res = await api("/api/faculty");
    if (!res.ok) return showStatus(statusEl, res.data.error || "Could not load faculty.", { error: true });
    renderList(res.data.faculty, session);
    return;
  }

  const res = await api(`/api/faculty/${encodeURIComponent(id)}`);
  if (res.status === 404 || res.status === 400) return renderNotFound(session);
  if (!res.ok) return showStatus(statusEl, res.data.error || "Could not load this profile.", { error: true });
  renderProfile(res.data.profile);
  await renderProjects(res.data.profile.id);
})();
