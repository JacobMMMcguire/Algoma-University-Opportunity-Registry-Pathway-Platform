const $ = (id) => document.getElementById(id);
const statusEl = $("status");

let project = null; // the saved version, or null for a new project
let unsaved = false;
let options = null; // fixed lists from /api/options

const STATE_HINTS = {
  draft: "Students can't see this project until you publish it.",
  published: "Students can see this project. Closing it withdraws it without deleting anything.",
  closed: "Students can no longer see this project. You can publish it again at any time.",
};

// Research areas aren't refilled here: the checkboxes already show what was saved.
function fillForm(p) {
  $("title").value = p.title;
  $("description").value = p.description;
  fillSelect($("studentLevel"), options.studentLevels, p.studentLevel || "", "Not specified");
  renderTermPicker($("targetTerm"), $("targetTerm-year"), { seasons: options.termSeasons, years: options.termYears }, p.targetTerm);
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
  if (field === "researchAreas") focusAreaPicker($("researchAreas-picker"));
  else if (field && $(field)) $(field).focus();
}

$("project-form").addEventListener("input", () => {
  unsaved = true;
});

$("project-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = {
    title: $("title").value,
    description: $("description").value,
    researchAreas: readAreaPicker($("researchAreas-picker")),
    studentLevel: $("studentLevel").value,
    targetTerm: readTerm($("targetTerm"), $("targetTerm-year")),
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
    showApiError(statusEl, res, "Could not update the project.");
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

  const [res, optionsRes] = await Promise.all([api("/api/projects/mine"), api("/api/options")]);
  if (!res.ok || !optionsRes.ok) {
    showStatus(statusEl, res.data.error || optionsRes.data.error || "Could not load your projects.", { error: true });
    return;
  }
  options = optionsRes.data;

  const id = new URLSearchParams(location.search).get("id");
  if (id !== null) {
    project = res.data.projects.find((p) => String(p.id) === id) || null;
    if (!project) {
      $("heading").textContent = "Project not found";
      $("not-found").hidden = false;
      return;
    }
    fillForm(project);
  } else {
    fillSelect($("studentLevel"), options.studentLevels, "", "Not specified");
    renderTermPicker($("targetTerm"), $("targetTerm-year"), { seasons: options.termSeasons, years: options.termYears }, "");
  }
  renderAreaPicker($("researchAreas-picker"), options.researchAreaGroups, project?.researchAreas || [], {
    max: res.data.limits.researchAreas,
    countEl: $("researchAreas-count"),
  });
  renderState();
  $("panel").hidden = false;
})();
