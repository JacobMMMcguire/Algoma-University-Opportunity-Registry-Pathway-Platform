// R3-08 to R3-13: faculty manage the term, deadline and state of their own projects and the
// industry opportunities they supervise; staff manage all of them and set Centre deadlines.
// The server decides who may change what; this page only offers what the API says is allowed.
const $ = (id) => document.getElementById(id);
const statusEl = $("status");

let options = null; // /api/options, for the term picker
let openKey = null; // the card whose controls are open, kept across reloads

const ACTION_LABELS = {
  withdraw: "Withdraw",
  complete: "Mark completed",
  archive: "Archive",
};

const ACTION_DONE = { withdraw: "withdrawn.", complete: "marked completed.", archive: "archived." };

const keyOf = (item) => `${item.kind}-${item.id}`;
const pathOf = (item) => `/api/lifecycle/${item.kind}/${encodeURIComponent(item.id)}`;
const studentLink = (item) => (item.kind === "industry" ? `opportunity.html?id=${item.id}` : `projects.html?id=${item.id}`);

// One date input with its label; `id` must be unique on the page.
function dateField(id, label, value = "") {
  return `<label for="${id}">${escapeHtml(label)}<input type="date" id="${id}" name="deadline" value="${escapeHtml(value || "")}"></label>`;
}

function termFields(prefix) {
  return `<label for="${prefix}-season">Season<select id="${prefix}-season" name="season"></select></label>
    <label for="${prefix}-year">Year<select id="${prefix}-year" name="year"></select></label>`;
}

function controls(item) {
  const k = keyOf(item);
  const l = item.lifecycle;
  const parts = [];
  if (item.actions.includes("schedule")) {
    parts.push(`<form class="inline-form" data-form="schedule" aria-label="Term and deadline">
      ${termFields(`${k}-schedule`)}
      ${dateField(`${k}-deadline`, "Faculty deadline", l.deadline)}
      <button type="submit">Save term and deadline</button>
    </form>`);
  }
  const buttons = item.actions
    .filter((a) => ACTION_LABELS[a])
    .map((a) => `<button type="button" data-action="${a}">${escapeHtml(ACTION_LABELS[a])}</button>`)
    .join("");
  if (buttons) parts.push(`<div class="actions">${buttons}</div>`);
  if (item.actions.includes("reopen")) {
    parts.push(`<form class="inline-form" data-form="reopen" aria-label="Reopen">
      ${dateField(`${k}-reopen`, "New deadline (needed if it has passed)")}
      <button type="submit">Reopen</button>
    </form>`);
  }
  if (item.actions.includes("renew")) {
    parts.push(`<form class="inline-form" data-form="renew" aria-label="Renew for a later term">
      ${termFields(`${k}-renew`)}
      ${dateField(`${k}-renew-deadline`, "Deadline")}
      <button type="submit">Renew for this term</button>
    </form>`);
  }
  if (item.canSetCentreDeadline) {
    parts.push(`<form class="inline-form" data-form="centre" aria-label="Centre deadline">
      ${dateField(`${k}-centre`, "Centre deadline (overrides the faculty deadline)", l.centreDeadline)}
      <button type="submit">Save Centre deadline</button>
      ${l.centreDeadline ? '<button type="button" data-action="clear-centre">Remove Centre deadline</button>' : ""}
    </form>`);
  }
  return parts.join("");
}

function card(item) {
  const l = item.lifecycle;
  const kind = item.kind === "industry" ? "Industry project" : "Faculty project";
  const dates = [
    l.term || "No term set",
    l.deadline ? `Faculty deadline ${formatDay(l.deadline)}` : "No faculty deadline",
    l.centreDeadline && `Centre deadline ${formatDay(l.centreDeadline)}`,
    l.runNumber > 1 && `Run ${l.runNumber}`,
  ].filter(Boolean);
  return `<li class="card" data-key="${escapeHtml(keyOf(item))}">
    <p class="kind">${escapeHtml(kind)}${item.managedBy ? ` · ${escapeHtml(item.managedBy)}` : ""}${item.draft ? " · Draft" : ""}</p>
    <h2><a href="${studentLink(item)}"></a></h2>
    <p><strong>${escapeHtml(l.label)}</strong> · ${escapeHtml(dates.join(" · "))}</p>
    <p class="hint">${escapeHtml(l.reason)}</p>
    <details${openKey === keyOf(item) ? " open" : ""}>
      <summary>Change term, deadline or state</summary>
      ${controls(item)}
      <h3>History</h3>
      <ol class="history" data-history><li>Loading…</li></ol>
    </details>
  </li>`;
}

function renderHistory(list, history) {
  const runs = history.map((run) => {
    const changes = run.changes
      .map((c) => `<li>${escapeHtml(new Date(c.at).toLocaleDateString())}: ${escapeHtml(c.change)} (${escapeHtml(c.detail)})${c.by ? ` by ${escapeHtml(c.by)}` : ""}${c.byStaff ? " (staff)" : ""}</li>`)
      .join("");
    return `<li>Run ${run.runNumber}: ${escapeHtml(run.term || "no term")}, ${escapeHtml(run.label)}${changes ? `<ul>${changes}</ul>` : ""}</li>`;
  });
  list.innerHTML = runs.join("");
}

async function loadHistory(cardEl, item) {
  const res = await api(pathOf(item));
  if (res.ok) renderHistory(cardEl.querySelector("[data-history]"), res.data.history);
}

let items = [];

function render() {
  const list = $("items");
  if (items.length === 0) {
    list.innerHTML = "<li>You have no opportunities to manage yet.</li>";
    return;
  }
  list.innerHTML = items.map(card).join("");
  for (const item of items) {
    const el = list.querySelector(`[data-key="${CSS.escape(keyOf(item))}"]`);
    // Industry titles are partner text: set as text, never as HTML (R2-03).
    el.querySelector("h2 a").textContent = item.title;
    const termOptions = { seasons: options.termSeasons, years: options.termYears };
    const schedule = el.querySelector('[data-form="schedule"]');
    if (schedule) renderTermPicker(schedule.elements.season, schedule.elements.year, termOptions, item.lifecycle.term);
    const renew = el.querySelector('[data-form="renew"]');
    if (renew) renderTermPicker(renew.elements.season, renew.elements.year, termOptions, "");
    const details = el.querySelector("details");
    details.addEventListener("toggle", () => {
      if (details.open) {
        openKey = keyOf(item);
        loadHistory(el, item);
      }
    });
    if (details.open) loadHistory(el, item);
  }
}

async function load() {
  const res = await api("/api/lifecycle");
  if (!res.ok) {
    showStatus(statusEl, res.data.error || "Could not load your opportunities.", { error: true });
    return false;
  }
  items = res.data.items;
  render();
  return true;
}

async function send(item, path, method, body, done, focusEl) {
  const res = await api(`${pathOf(item)}${path}`, { method, body });
  if (!res.ok) {
    showApiError(statusEl, res, "Could not save that change.");
    focusEl?.focus();
    return;
  }
  openKey = keyOf(item);
  await load();
  showStatus(statusEl, `"${item.title}": ${done} Now ${res.data.item.lifecycle.label.toLowerCase()}.`);
  document.querySelector(`[data-key="${CSS.escape(openKey)}"] summary`)?.focus();
}

$("items").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  const item = items.find((i) => keyOf(i) === form.closest("[data-key]").dataset.key);
  const term = () => readTerm(form.elements.season, form.elements.year);
  const deadline = () => form.elements.deadline.value || null;
  const first = form.querySelector("select, input");
  switch (form.dataset.form) {
    case "schedule":
      return send(item, "/schedule", "PUT", { targetTerm: term(), deadline: deadline() }, "term and deadline saved.", first);
    case "reopen": {
      const body = { action: "reopen" };
      if (deadline()) body.deadline = deadline();
      return send(item, "/state", "POST", body, "reopened.", first);
    }
    case "renew":
      return send(item, "/renew", "POST", { targetTerm: term(), deadline: deadline() }, "renewed for a new term.", first);
    case "centre":
      if (!deadline()) {
        showStatus(statusEl, "Choose a date, or use Remove Centre deadline.", { error: true });
        return first.focus();
      }
      return send(item, "/centre-deadline", "PUT", { centreDeadline: deadline() }, "Centre deadline saved.", first);
  }
});

$("items").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const item = items.find((i) => keyOf(i) === button.closest("[data-key]").dataset.key);
  const action = button.dataset.action;
  if (action === "clear-centre") {
    return send(item, "/centre-deadline", "PUT", { centreDeadline: null }, "Centre deadline removed.", button);
  }
  if (action === "withdraw" && !confirm(`Withdraw "${item.title}"? Students will no longer see it. You can reopen it later.`)) return;
  return send(item, "/state", "POST", { action }, ACTION_DONE[action], button);
});

(async () => {
  const session = await getSession();
  renderNav(session);
  if (!session.authenticated) {
    $("denied").innerHTML = 'Please <a href="index.html">sign in</a> first.';
    $("denied").hidden = false;
    return;
  }
  if (!session.user.isVerifiedFaculty && !session.user.isStaff) {
    $("denied").textContent = "Only verified faculty and Centre staff manage opportunity terms and deadlines.";
    $("denied").hidden = false;
    return;
  }
  $("intro").textContent = session.user.isStaff
    ? "As Centre staff you can manage every published opportunity. A Centre deadline overrides the faculty member's deadline."
    : "Your projects and the industry opportunities you supervise. Students only see opportunities that are open.";
  const optionsRes = await api("/api/options");
  if (!optionsRes.ok) return showStatus(statusEl, "Could not load the form options.", { error: true });
  options = optionsRes.data;
  if (await load()) $("panel").hidden = false;
})();
