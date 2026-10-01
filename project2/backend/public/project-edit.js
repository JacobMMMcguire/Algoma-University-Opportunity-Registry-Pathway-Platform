const $ = (id) => document.getElementById(id);
const statusEl = $("status");

let project = null; // the saved version, or null for a new project
let unsaved = false;

function lines(value) {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

const STATE_HINTS = {
  draft: "Students can't see this project until you publish it.",
  published: "Students can see this project. Closing it withdraws it without deleting anything.",
  closed: "Students can no longer see this project. You can publish it again at any time.",
};

function fillForm(p) {
  $("title").value = p.title;
  $("description").value = p.description;
  $("researchAreas").value = p.researchAreas.join("\n");
  $("studentLevel").value = p.studentLevel || "";
  $("targetTerm").value = p.targetTerm;
  $("prerequisites").value = p.prerequisites || "";
}

function renderState() {
  const isNew = project === null;
  $("heading").textContent = isNew ? "New project" : "Edit project";
  document.title = `${isNew ? "New project" : "Edit project"} — Opportunity Registry`;
  $("new-hint").hidden = !isNew;
  $("state").hidden = isNew;
  $("save").textContent = isNew || project.status === "draft" ? "Save draft" : "Save changes";
  if (isNew) return;
  $("state-label").textContent = PROJECT_STATUS_LABELS[project.status];
  $("state-hint").textContent = STATE_HINTS[project.status];
  $("view-link").href = `projects.html?id=${encodeURIComponent(project.id)}`;
  $("publish").hidden = project.status === "published";
  $("publish").textContent = project.status === "closed" ? "Reopen and publish" : "Publish";
  $("close").hidden = project.status === "closed";
}

function focusField(field) {
  if (field && $(field)) $(field).focus();
}

$("project-form").addEventListener("input", () => {
  unsaved = true;
});

$("project-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = {
    title: $("title").value,
    description: $("description").value,
    researchAreas: lines($("researchAreas").value),
    studentLevel: $("studentLevel").value,
    targetTerm: $("targetTerm").value,
    prerequisites: $("prerequisites").value,
  };
  const res = project
    ? await api(`/api/projects/${encodeURIComponent(project.id)}`, { method: "PUT", body })
    : await api("/api/projects", { method: "POST", body });
  if (!res.ok) {
    showStatus(statusEl, res.data.error || "Could not save the project.", { error: true });
    focusField(res.data.field);
    return;
  }
  const created = project === null;
  project = res.data.project;
  unsaved = false;
  // Give the new draft its own address so refreshing or bookmarking keeps editing it.
  if (created) history.replaceState(null, "", `project-edit.html?id=${encodeURIComponent(project.id)}`);
  fillForm(project);
  renderState();
  showStatus(statusEl, created ? "Draft saved. Students can't see it until you publish it." : "Changes saved.");
});

async function changeStatus(action, button) {
  // Publishing shows the saved version, so don't let unsaved edits go unnoticed.
  if (action === "publish" && unsaved) {
    showStatus(statusEl, "Save your changes before publishing.", { error: true });
    $("save").focus();
    return;
  }
  const res = await api(`/api/projects/${encodeURIComponent(project.id)}/${action}`, { method: "POST" });
  if (!res.ok) {
    showStatus(statusEl, res.data.error || "Could not update the project.", { error: true });
    button.focus();
    return;
  }
  project = res.data.project;
  renderState();
  showStatus(statusEl, action === "publish" ? "Project published." : "Project closed.");
  // The button pressed may now be hidden; keep focus on the status controls.
  ($("publish").hidden ? $("close") : $("publish")).focus();
}

$("publish").addEventListener("click", (event) => changeStatus("publish", event.currentTarget));
$("close").addEventListener("click", (event) => changeStatus("close", event.currentTarget));

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

  const res = await api("/api/projects/mine");
  if (!res.ok) {
    showStatus(statusEl, res.data.error || "Could not load your projects.", { error: true });
    return;
  }
  $("studentLevel-options").replaceChildren(
    ...res.data.studentLevelSuggestions.map((level) => {
      const option = document.createElement("option");
      option.value = level;
      return option;
    }),
  );

  const id = new URLSearchParams(location.search).get("id");
  if (id !== null) {
    project = res.data.projects.find((p) => String(p.id) === id) || null;
    if (!project) {
      $("heading").textContent = "Project not found";
      $("not-found").hidden = false;
      return;
    }
    fillForm(project);
  }
  renderState();
  $("panel").hidden = false;
})();
