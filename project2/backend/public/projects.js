const $ = (id) => document.getElementById(id);
const statusEl = $("status");
// Sent to both APIs. `type` (faculty or industry) is applied here, in the page.
const API_FILTER_KEYS = ["q", "area", "level", "term", "facultyId"];
const FILTER_KEYS = [...API_FILTER_KEYS, "type"];
const TYPES = [
  { value: "faculty", label: "Faculty projects" },
  { value: "industry", label: "Industry projects (with an outside organisation)" },
];

// Keeps a filter that's in the URL selectable even if it has no results right now (an old link).
function withSelected(options, selected, label) {
  if (!selected || options.some((o) => String(o.value) === selected)) return options;
  return [...options, { value: selected, label: `${label(selected)} (0)` }];
}

// R2-21: one set of filter choices for both lists, with their counts added together.
function mergeFilters(a, b) {
  const groups = new Map();
  for (const g of [...a.areas, ...b.areas]) {
    const areas = groups.get(g.group) || new Map();
    for (const item of g.areas) areas.set(item.value, (areas.get(item.value) || 0) + item.count);
    groups.set(g.group, areas);
  }
  const faculty = new Map();
  for (const f of [...a.faculty, ...b.faculty]) {
    faculty.set(f.id, { ...f, count: (faculty.get(f.id)?.count || 0) + f.count });
  }
  return {
    areas: [...groups].map(([group, areas]) => ({
      group,
      areas: [...areas].sort(([x], [y]) => x.localeCompare(y)).map(([value, count]) => ({ value, count })),
    })),
    levels: a.levels,
    terms: a.terms,
    faculty: [...faculty.values()].sort((x, y) => x.displayName.localeCompare(y.displayName)),
  };
}

// R2-21: each card says which kind it is. Industry projects name their partner organisation and
// supervising faculty, and open on their own page.
function projectCard(p) {
  const details = [p.faculty.displayName, p.targetTerm, p.studentLevel].filter(Boolean);
  return `<li class="card">
    <p class="kind">Faculty project</p>
    <h2><a href="projects.html?id=${encodeURIComponent(p.id)}">${escapeHtml(p.title)}</a></h2>
    <p>${escapeHtml(details.join(" · "))}</p>
    <p class="hint">${escapeHtml(p.researchAreas.join(" · "))}</p>
  </li>`;
}

function opportunityCard(o) {
  const supervisors = o.supervisors.map((s) => s.displayName).join(", ");
  return `<li class="card">
    <p class="kind kind-industry">Industry project · proposed by ${escapeHtml(o.organisation)}</p>
    <h2><a href="opportunity.html?id=${encodeURIComponent(o.id)}">${escapeHtml(o.title)}</a></h2>
    <p>Supervised by ${escapeHtml(supervisors)}</p>
    <p class="hint">${escapeHtml(o.researchAreas.join(" · "))}</p>
  </li>`;
}

// R1-19, R1-20, R2-21: faculty projects and supervised industry projects in one list, with
// filters taken from (and kept in) the URL.
function renderList(data, industryData, session, query) {
  const { projects } = data;
  const { opportunities } = industryData;
  const filters = mergeFilters(data.filters, industryData.filters);
  $("list-note").textContent = session.authenticated
    ? "Showing every published faculty project and every industry project a faculty member has agreed to supervise, including those visible only to signed-in users."
    : "Showing faculty projects and supervised industry projects from faculty who have chosen to share them publicly. Sign in to see more.";

  const type = query.get("type") || "";
  fillSelect($("filter-type"), TYPES, type, "Any type");
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

  const items = [
    ...(type === "industry" ? [] : projects.map((p) => ({ title: p.title, html: projectCard(p) }))),
    ...(type === "faculty" ? [] : opportunities.map((o) => ({ title: o.title, html: opportunityCard(o) }))),
  ].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  $("project-list").innerHTML = items.map((item) => item.html).join("");
  $("list-view").hidden = false;
  const filtered = FILTER_KEYS.some((key) => query.get(key));
  showResultCount($("result-count"), items.length, { noun: "project", plural: "projects", filtered });
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
    for (const key of API_FILTER_KEYS) if (query.get(key)) params.set(key, query.get(key));
    const suffix = params.size ? `?${params}` : "";
    const [res, industryRes] = await Promise.all([api(`/api/projects${suffix}`), api(`/api/opportunities${suffix}`)]);
    if (res.status === 400) {
      showStatus(statusEl, res.data.error, { error: true });
      const clear = document.createElement("a");
      clear.href = "projects.html";
      clear.textContent = "Clear the filters";
      return statusEl.append(" ", clear);
    }
    if (!res.ok || !industryRes.ok) {
      return showStatus(statusEl, res.data.error || industryRes.data.error || "Could not load projects.", { error: true });
    }
    renderList(res.data, industryRes.data, session, query);
    return;
  }

  const res = await api(`/api/projects/${encodeURIComponent(id)}`);
  if (res.status === 404 || res.status === 400) return renderNotFound(session);
  if (!res.ok) return showStatus(statusEl, res.data.error || "Could not load this project.", { error: true });
  renderProject(res.data.project, session);
})();
