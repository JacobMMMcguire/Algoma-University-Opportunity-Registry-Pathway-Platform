const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const FILTER_KEYS = ["q", "area", "level", "term", "facultyId"];

// Keeps a filter that's in the URL selectable even if it has no results right now (an old link).
function withSelected(options, selected, label) {
  if (!selected || options.some((o) => String(o.value) === selected)) return options;
  return [...options, { value: selected, label: `${label(selected)} (0)` }];
}

// R1-19, R1-20: the project list, with filters taken from (and kept in) the URL.
function renderList(data, session, query) {
  const { projects, filters } = data;
  $("list-note").textContent = session.authenticated
    ? "Showing every published project, including those visible only to signed-in users."
    : "Showing published projects from faculty who have chosen to share them publicly. Sign in to see more.";

  $("filter-q").value = query.get("q") || "";
  fillGroupedSelect($("filter-area"), filters.areas, query.get("area") || "", "Any research area");
  const levelNames = { undergraduate: "Undergraduate students", graduate: "Graduate students" };
  fillSelect(
    $("filter-level"),
    withSelected(
      filters.levels.map((l) => ({ value: l.value, label: `${l.label} (${l.count})` })),
      query.get("level"),
      (v) => levelNames[v] || v,
    ),
    query.get("level") || "",
    "Any student level",
  );
  fillSelect(
    $("filter-term"),
    withSelected(
      filters.terms.map((t) => ({ value: t.value, label: `${t.value} (${t.count})` })),
      query.get("term"),
      (v) => v,
    ),
    query.get("term") || "",
    "Any term",
  );
  fillSelect(
    $("filter-faculty"),
    withSelected(
      filters.faculty.map((f) => ({ value: String(f.id), label: `${f.displayName} (${f.count})` })),
      query.get("facultyId"),
      () => "Selected faculty member",
    ),
    query.get("facultyId") || "",
    "Any faculty member",
  );

  $("project-list").innerHTML = projects
    .map((p) => {
      const details = [p.faculty.displayName, p.targetTerm, p.studentLevel].filter(Boolean);
      return `<li class="card">
        <h2><a href="projects.html?id=${encodeURIComponent(p.id)}">${escapeHtml(p.title)}</a></h2>
        <p>${escapeHtml(details.join(" · "))}</p>
        <p class="hint">${escapeHtml(p.researchAreas.join(" · "))}</p>
      </li>`;
    })
    .join("");
  $("list-view").hidden = false;
  const filtered = FILTER_KEYS.some((key) => query.get(key));
  showResultCount($("result-count"), projects.length, { noun: "project", plural: "projects", filtered });
}

function renderProject(project, session) {
  document.title = `${project.title} — Opportunity Registry`;
  $("project-title").textContent = project.title;

  // Owners can open their own drafts and closed projects; say clearly that students can't.
  const isOwner = session.user?.id === project.faculty.id;
  if (isOwner) {
    const note = $("owner-note");
    note.textContent =
      project.status === "published"
        ? "This is your project. "
        : `This is your project and it isn't shown to students (${PROJECT_STATUS_LABELS[project.status]}). `;
    const edit = document.createElement("a");
    edit.href = `project-edit.html?id=${encodeURIComponent(project.id)}`;
    edit.textContent = "Edit it";
    note.append(edit, document.createTextNode(" or manage it from "));
    const mine = document.createElement("a");
    mine.href = "my-projects.html";
    mine.textContent = "your projects";
    note.append(mine, document.createTextNode("."));
    note.hidden = false;
  }

  // R1-21: the project names its faculty member and links to their profile.
  if (project.faculty.displayName) {
    const link = $("project-faculty").querySelector("a");
    link.href = `faculty.html?id=${encodeURIComponent(project.faculty.id)}`;
    link.textContent = project.faculty.displayName;
    $("project-faculty").hidden = false;
  }
  $("project-audience").hidden = project.publiclyVisible || project.status !== "published";
  $("project-term").textContent = project.targetTerm;
  $("project-level").textContent = project.studentLevel || "";
  $("level-row").hidden = !project.studentLevel;
  $("project-description").textContent = project.description;
  $("about-section").hidden = !project.description;
  $("project-areas").replaceChildren(
    ...project.researchAreas.map((area) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = `projects.html?area=${encodeURIComponent(area)}`;
      a.textContent = area;
      a.title = `Projects in ${area}`;
      li.append(a);
      return li;
    }),
  );
  $("project-prereq").textContent = project.prerequisites || "";
  $("prereq-section").hidden = !project.prerequisites;

  // R1-22: Contact, unless the faculty member isn't accepting inquiries.
  if (project.contact) {
    renderContactPanel($("contact-section"), {
      email: project.contact.email,
      facultyName: project.faculty.displayName,
      subject: `Student inquiry: ${project.title} (${project.targetTerm})`,
      body:
        `Dear ${project.faculty.displayName},\n\n` +
        `I'm a student at Algoma University and I'm interested in your project "${project.title}" for ${project.targetTerm}.\n\n` +
        "[A sentence or two about you: your program, your year, and why this project interests you.]\n\n" +
        "Would you be open to talking about whether I could get involved?\n\n" +
        "Thank you,\n[Your name]",
      session,
    });
  } else if (project.status === "published" && !isOwner && project.faculty.inquiryPreference) {
    $("no-contact-text").textContent = project.faculty.inquiryPreference.explanation;
    $("no-contact").hidden = false;
  }
  $("project-view").hidden = false;
}

function renderNotFound(session) {
  $("not-found-text").textContent = session.authenticated
    ? "This project doesn't exist or is no longer available."
    : "This project doesn't exist or isn't available publicly. Signing in may let you see it.";
  $("not-found").hidden = false;
}

submitFiltersAsUrl($("filters"), "projects.html");

(async () => {
  const session = await getSession();
  renderNav(session);
  const query = new URLSearchParams(location.search);
  const id = query.get("id");

  if (id === null) {
    const params = new URLSearchParams();
    for (const key of FILTER_KEYS) if (query.get(key)) params.set(key, query.get(key));
    const res = await api(`/api/projects${params.size ? `?${params}` : ""}`);
    if (res.status === 400) {
      showStatus(statusEl, res.data.error, { error: true });
      const clear = document.createElement("a");
      clear.href = "projects.html";
      clear.textContent = "Clear the filters";
      return statusEl.append(" ", clear);
    }
    if (!res.ok) return showStatus(statusEl, res.data.error || "Could not load projects.", { error: true });
    renderList(res.data, session, query);
    return;
  }

  const res = await api(`/api/projects/${encodeURIComponent(id)}`);
  if (res.status === 404 || res.status === 400) return renderNotFound(session);
  if (!res.ok) return showStatus(statusEl, res.data.error || "Could not load this project.", { error: true });
  renderProject(res.data.project, session);
})();
