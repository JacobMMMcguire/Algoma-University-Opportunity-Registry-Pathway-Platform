const $ = (id) => document.getElementById(id);
const statusEl = $("status");

// R1-17, R1-18, R1-20: the faculty list, with filters taken from (and kept in) the URL.
function renderList(data, session, query) {
  const { faculty, filters } = data;
  $("list-note").textContent = session.authenticated
    ? "Showing every faculty member with a profile, including those visible only to signed-in users."
    : "Showing faculty who have chosen to share their profile publicly. Sign in to see more.";

  $("filter-q").value = query.get("q") || "";
  fillGroupedSelect($("filter-area"), filters.areas, query.get("area") || "", "Any research area");
  fillSelect(
    $("filter-inquiry"),
    filters.inquiry.map((o) => ({ value: o.value, label: `${o.label} (${o.count})` })),
    query.get("inquiry") || "",
    "Any inquiry preference",
  );

  $("faculty-list").innerHTML = faculty
    .map(
      (p) => `<li class="card">
        <h2><a href="faculty.html?id=${encodeURIComponent(p.id)}">${escapeHtml(p.displayName)}</a></h2>
        <p>${escapeHtml(p.researchAreas.join(" · "))}</p>
        <p class="hint">${escapeHtml(p.inquiryPreference.label)}</p>
      </li>`,
    )
    .join("");
  $("list-view").hidden = false;
  const filtered = ["q", "area", "inquiry"].some((key) => query.get(key));
  showResultCount($("result-count"), faculty.length, { noun: "faculty member", plural: "faculty members", filtered });
}

function renderProfile(profile, session) {
  document.title = `${profile.displayName} — Opportunity Registry`;
  $("profile-name").textContent = profile.displayName;
  $("profile-audience").hidden = profile.publiclyVisible;
  $("inquiry-label").textContent = profile.inquiryPreference.label;
  $("inquiry-explanation").textContent = profile.inquiryPreference.explanation;
  $("profile-description").textContent = profile.description;

  $("profile-areas").replaceChildren(
    ...profile.researchAreas.map((area) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = `faculty.html?area=${encodeURIComponent(area)}`;
      a.textContent = area;
      a.title = `Faculty working in ${area}`;
      li.append(a);
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

  // R1-22: only faculty open to general inquiries are contacted from their profile.
  if (profile.contact) {
    renderContactPanel($("contact-section"), {
      email: profile.contact.email,
      facultyName: profile.displayName,
      subject: "Student inquiry about your research",
      body:
        `Dear ${profile.displayName},\n\n` +
        `I'm a student at Algoma University and I'm interested in your work in ${profile.researchAreas.join(", ")}.\n\n` +
        "[A sentence or two about you: your program, your year, and what interests you about their research.]\n\n" +
        "Would you be open to talking about research opportunities in your group?\n\n" +
        "Thank you,\n[Your name]",
      session,
    });
  }
  $("profile-view").hidden = false;
  return profile.contactViaProjects;
}

// Their published projects, filtered by the same visibility rule as the projects page.
async function renderProjects(facultyId, contactViaProjects) {
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
  $("contact-via-projects").hidden = !contactViaProjects;
}

function renderNotFound(session) {
  $("not-found-text").textContent = session.authenticated
    ? "This faculty profile doesn't exist or is no longer available."
    : "This faculty profile doesn't exist or isn't available publicly. Signing in may let you see it.";
  $("not-found").hidden = false;
}

submitFiltersAsUrl($("filters"), "faculty.html");

(async () => {
  const session = await getSession();
  renderNav(session);
  const query = new URLSearchParams(location.search);
  const id = query.get("id");

  if (id === null) {
    const params = new URLSearchParams();
    for (const key of ["q", "area", "inquiry"]) if (query.get(key)) params.set(key, query.get(key));
    const res = await api(`/api/faculty${params.size ? `?${params}` : ""}`);
    if (res.status === 400) {
      showStatus(statusEl, res.data.error, { error: true });
      const clear = document.createElement("a");
      clear.href = "faculty.html";
      clear.textContent = "Clear the filters";
      return statusEl.append(" ", clear);
    }
    if (!res.ok) return showStatus(statusEl, res.data.error || "Could not load faculty.", { error: true });
    renderList(res.data, session, query);
    return;
  }

  const res = await api(`/api/faculty/${encodeURIComponent(id)}`);
  if (res.status === 404 || res.status === 400) return renderNotFound(session);
  if (!res.ok) return showStatus(statusEl, res.data.error || "Could not load this profile.", { error: true });
  const contactViaProjects = renderProfile(res.data.profile, session);
  await renderProjects(res.data.profile.id, contactViaProjects);
})();
