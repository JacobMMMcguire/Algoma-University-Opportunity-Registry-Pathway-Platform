const $ = (id) => document.getElementById(id);
const statusEl = $("status");

// What each status lets the owner do next. A closed project can be reopened by publishing.
const ACTIONS = {
  draft: [
    { action: "publish", label: "Publish" },
    { action: "close", label: "Close" },
  ],
  published: [{ action: "close", label: "Close" }],
  closed: [{ action: "publish", label: "Reopen and publish" }],
};

function renderVisibilityNote(user) {
  const note = $("visibility-note");
  if (user.publicProfileChoice === null) {
    note.innerHTML =
      'You can save drafts now. Before you can publish, choose whether your profile and projects may be shown publicly on the <a href="index.html">home page</a>. Either answer is fine.';
  } else if (user.publiclyVisible) {
    note.textContent = "Your published projects are public: anyone can see them, including people who are not signed in.";
  } else {
    note.textContent = "Your published projects are shown only to people signed in with an Algoma account.";
  }
}

function renderProjects(projects) {
  const list = $("project-list");
  if (projects.length === 0) {
    list.innerHTML = "<li>You haven't created any projects yet.</li>";
    return;
  }
  list.innerHTML = projects
    .map((p) => {
      const id = encodeURIComponent(p.id);
      const buttons = ACTIONS[p.status]
        .map(
          (a) =>
            `<button type="button" data-id="${escapeHtml(p.id)}" data-action="${a.action}"
               aria-label="${escapeHtml(`${a.label}: ${p.title}`)}">${escapeHtml(a.label)}</button>`,
        )
        .join("");
      return `<li class="card" data-project="${escapeHtml(p.id)}">
        <h2>${escapeHtml(p.title)}</h2>
        <p><strong>${escapeHtml(PROJECT_STATUS_LABELS[p.status])}</strong> · ${escapeHtml(p.targetTerm)}</p>
        <div class="actions">
          <a class="button-link" href="project-edit.html?id=${id}" aria-label="${escapeHtml(`Edit: ${p.title}`)}">Edit</a>
          <a class="button-link" href="projects.html?id=${id}" aria-label="${escapeHtml(`View: ${p.title}`)}">View</a>
          ${buttons}
        </div>
      </li>`;
    })
    .join("");
}

async function load() {
  const res = await api("/api/projects/mine");
  if (!res.ok) {
    showStatus(statusEl, res.data.error || "Could not load your projects.", { error: true });
    return false;
  }
  renderProjects(res.data.projects);
  return true;
}

$("project-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { id, action } = button.dataset;
  button.disabled = true;
  const res = await api(`/api/projects/${encodeURIComponent(id)}/${action}`, { method: "POST" });
  if (!res.ok) {
    button.disabled = false;
    showApiError(statusEl, res, "Could not update the project.");
    button.focus();
    return;
  }
  const { project } = res.data;
  await load();
  showStatus(
    statusEl,
    project.status === "published" ? `"${project.title}" is published.` : `"${project.title}" is closed.`,
  );
  // Keep keyboard users on the same card: its buttons were re-rendered.
  document.querySelector(`[data-project="${CSS.escape(String(project.id))}"] button`)?.focus();
});

(async () => {
  const session = await getSession();
  renderNav(session);
  if (!session.authenticated) {
    $("denied").innerHTML = 'Please <a href="index.html">sign in</a> first.';
    $("denied").hidden = false;
    return;
  }
  if (!session.user.isVerifiedFaculty) {
    $("denied").textContent =
      "Only verified faculty can create projects. Faculty member? Ask Centre staff to verify your account.";
    $("denied").hidden = false;
    return;
  }
  renderVisibilityNote(session.user);
  if (await load()) $("panel").hidden = false;
})();
