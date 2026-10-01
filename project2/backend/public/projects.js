const $ = (id) => document.getElementById(id);
const statusEl = $("status");

function renderList(projects, session) {
  $("list-note").textContent = session.authenticated
    ? "Showing every published project, including those visible only to signed-in users."
    : "Showing published projects from faculty who have chosen to share them publicly. Sign in to see more.";
  $("project-list").innerHTML = projects.length
    ? projects
        .map((p) => {
          const details = [p.faculty.displayName, p.targetTerm, p.studentLevel].filter(Boolean);
          return `<li class="card">
            <h2><a href="projects.html?id=${encodeURIComponent(p.id)}">${escapeHtml(p.title)}</a></h2>
            <p>${escapeHtml(details.join(" · "))}</p>
            <p class="hint">${escapeHtml(p.researchAreas.join(" · "))}</p>
          </li>`;
        })
        .join("")
    : "<li>No projects to show yet.</li>";
  $("list-view").hidden = false;
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
  $("project-areas").replaceChildren(
    ...project.researchAreas.map((area) => {
      const li = document.createElement("li");
      li.textContent = area;
      return li;
    }),
  );
  $("project-prereq").textContent = project.prerequisites || "";
  $("prereq-section").hidden = !project.prerequisites;
  $("project-view").hidden = false;
}

function renderNotFound(session) {
  $("not-found-text").textContent = session.authenticated
    ? "This project doesn't exist or is no longer available."
    : "This project doesn't exist or isn't available publicly. Signing in may let you see it.";
  $("not-found").hidden = false;
}

(async () => {
  const session = await getSession();
  renderNav(session);
  const id = new URLSearchParams(location.search).get("id");

  if (id === null) {
    const res = await api("/api/projects");
    if (!res.ok) return showStatus(statusEl, res.data.error || "Could not load projects.", { error: true });
    renderList(res.data.projects, session);
    return;
  }

  const res = await api(`/api/projects/${encodeURIComponent(id)}`);
  if (res.status === 404 || res.status === 400) return renderNotFound(session);
  if (!res.ok) return showStatus(statusEl, res.data.error || "Could not load this project.", { error: true });
  renderProject(res.data.project, session);
})();
