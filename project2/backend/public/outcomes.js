// R3-14, R3-15, R3-18: participants record and edit outcomes, faculty confirm them, and students
// choose whether each appears on their own profile. The server decides who may do what (the
// `you` flags) and checks again on every request.
const $ = (id) => document.getElementById(id);
const statusEl = $("status");

let data = null; // GET /api/outcomes/mine
let focusAfterLoad = null;

const lines = (text) => text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);

function checkbox(name, value, label, { checked = true, disabled = false } = {}) {
  return h("label", { class: "choice" }, h("input", { type: "checkbox", name, value: String(value), checked, disabled }), h("span", { text: label }));
}

// One labelled URL input per kind of link, ids prefixed so several forms can share a page.
function linkInputs(prefix, values = {}) {
  return data.linkKinds.map(({ kind, label }) =>
    h(
      "div",
      { class: "field" },
      h("label", { htmlFor: `${prefix}-${kind}`, text: label }),
      h("input", { id: `${prefix}-${kind}`, name: `link-${kind}`, type: "url", inputMode: "url", value: values[kind] || "" }),
    ),
  );
}

function readLinks(form) {
  return Object.fromEntries(data.linkKinds.map(({ kind }) => [kind, form.elements[`link-${kind}`].value.trim()]));
}

// The record form's student and faculty choices follow the chosen match.
function renderChoices() {
  const match = data.recordable.find((m) => String(m.matchId) === $("match").value);
  $("student-options").replaceChildren(...match.students.map((s) => checkbox("student", s.email, s.name)));
  $("faculty-options").replaceChildren(
    ...(match.faculty.length
      ? match.faculty.map((f) => checkbox("faculty", f.id, f.isYou ? `${f.name} (you)` : f.name, { checked: true, disabled: f.isYou }))
      : [h("p", { class: "hint", text: "No faculty profile is linked to this opportunity. Name faculty below." })]),
  );
}

function renderRecordForm() {
  $("record-section").hidden = data.recordable.length === 0;
  if (data.recordable.length === 0) return;
  const wanted = new URLSearchParams(location.search).get("match");
  $("match").replaceChildren(
    ...data.recordable.map((m) =>
      h("option", {
        value: String(m.matchId),
        selected: String(m.matchId) === wanted,
        text: [m.opportunity.title, m.opportunity.term, m.students.map((s) => s.name).join(", ")].filter(Boolean).join(" · "),
      }),
    ),
  );
  $("completedOn").max = data.today;
  if (!$("record-links").querySelector("input")) $("record-links").append(...linkInputs("record"));
  renderChoices();
}

function editForm(outcome) {
  const prefix = `edit-${outcome.id}`;
  return h(
    "details",
    {},
    h("summary", { text: "Edit summary, date and links" }),
    h(
      "form",
      // Two outcomes can share an opportunity (R-501 and R-503), so the date tells them apart.
      { "data-form": "edit", "aria-label": `Edit outcome for ${outcome.opportunity.title}, completed ${outcome.completedOn}`, noValidate: true },
      h("div", { class: "field" }, h("label", { htmlFor: `${prefix}-summary`, text: "Summary" }),
        h("textarea", { id: `${prefix}-summary`, name: "summary", rows: 4, maxLength: data.limits.summary, value: outcome.summary })),
      h("div", { class: "field" }, h("label", { htmlFor: `${prefix}-date`, text: "Completion date" }),
        h("input", { id: `${prefix}-date`, name: "completedOn", type: "date", max: data.today, value: outcome.completedOn })),
      h("fieldset", {}, h("legend", { text: "Links" }), ...linkInputs(prefix, outcome.linkValues)),
      outcome.confirmed ? h("p", { class: "hint", text: "Saving takes it out of public view until a faculty member on it confirms it again." }) : null,
      h("button", { type: "submit", text: "Save changes" }),
    ),
  );
}

function ownCard(outcome) {
  const you = outcome.you;
  const controls = [];
  if (you.canConfirm) controls.push(h("button", { type: "button", class: "primary", "data-action": "confirm", text: "Confirm this outcome" }));
  if (you.canUnconfirm) controls.push(h("button", { type: "button", "data-action": "unconfirm", text: "Take back confirmation" }));
  const extra = [
    h("p", {}, h("strong", { text: outcome.confirmed ? "Confirmed" : "Awaiting faculty confirmation" }), `. ${outcome.publicStatus}`),
    h(
      "p",
      { class: "hint" },
      `On it: ${outcome.participants.map((p) => `${p.name}${p.isYou ? " (you)" : ""}, ${p.role}`).join("; ")}`,
    ),
    controls.length ? h("div", { class: "actions" }, ...controls) : null,
    you.role === "student"
      ? h(
          "label",
          { class: "choice" },
          h("input", { type: "checkbox", "data-action": "profile", checked: you.showOnProfile }),
          h("span", { text: "Show on my student profile (when it is public)" }),
        )
      : null,
    editForm(outcome),
  ];
  return outcomeCard(outcome, { level: 3, extra });
}

async function load() {
  const res = await api("/api/outcomes/mine");
  if (!res.ok) return showStatus(statusEl, res.data.error || "Could not load your outcomes.", { error: true });
  data = res.data;
  renderRecordForm();
  $("outcomes").replaceChildren(
    ...(data.outcomes.length ? data.outcomes.map(ownCard) : [h("li", { text: "You aren't on any outcomes yet." })]),
  );
  $("panel").hidden = false;
  focusElement(focusAfterLoad);
  focusAfterLoad = null;
}

async function send(path, method, body, done, focus) {
  const res = await api(path, { method, body });
  if (!res.ok) {
    showStatus(statusEl, res.data.error || "Could not save that.", { error: true });
    return res;
  }
  focusAfterLoad = focus(res.data.outcome);
  await load();
  showStatus(statusEl, done(res.data.outcome));
  return res;
}

$("match").addEventListener("change", renderChoices);

$("record-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const checked = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
  const res = await send(
    "/api/outcomes",
    "POST",
    {
      matchId: Number($("match").value),
      students: checked("student"),
      faculty: checked("faculty").map(Number),
      otherFacultyEmails: lines($("otherFaculty").value),
      summary: $("summary").value,
      completedOn: $("completedOn").value,
      links: readLinks(form),
    },
    (o) => `Outcome recorded for "${o.opportunity.title}". It stays private until a faculty member on it confirms it.`,
    (o) => `[data-outcome="${o.id}"] h3`,
  );
  if (res.ok) {
    form.reset();
    renderChoices();
    return;
  }
  const field = res.data.field;
  const target =
    { students: form.querySelector('input[name="student"]'), faculty: $("otherFaculty"), summary: $("summary"), completedOn: $("completedOn") }[field] ||
    form.elements[`link-${field}`];
  target?.focus();
});

$("outcomes").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  const id = form.closest("[data-outcome]").dataset.outcome;
  send(
    `/api/outcomes/${id}`,
    "PUT",
    { summary: form.elements.summary.value, completedOn: form.elements.completedOn.value, links: readLinks(form) },
    (o) => (o.confirmed ? "Changes saved." : "Changes saved. A faculty member on it needs to confirm it before it can be public."),
    () => `[data-outcome="${id}"] h3`,
  ).then((res) => {
    if (!res.ok) document.querySelector(`[data-outcome="${id}"] [name="${res.data.field}"], [data-outcome="${id}"] textarea`)?.focus();
  });
});

$("outcomes").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const id = button.closest("[data-outcome]").dataset.outcome;
  const action = button.dataset.action;
  send(
    `/api/outcomes/${id}/${action}`,
    "POST",
    undefined,
    (o) => (action === "confirm" ? `Confirmed. ${o.publicStatus}` : "Confirmation taken back. Only the people on it can see it now."),
    () => `[data-outcome="${id}"] h3`,
  );
});

$("outcomes").addEventListener("change", (event) => {
  const box = event.target.closest('input[data-action="profile"]');
  if (!box) return;
  const id = box.closest("[data-outcome]").dataset.outcome;
  send(
    `/api/outcomes/${id}/show-on-profile`,
    "PUT",
    { show: box.checked },
    (o) => (o.you.showOnProfile ? "It will show on your student profile." : "Hidden from your student profile. It still shows on the faculty profile and in Completed work if public."),
    () => `[data-outcome="${id}"] input[data-action="profile"]`,
  );
});

(async () => {
  const session = await getSession();
  renderNav(session);
  if (!session.authenticated) {
    $("denied").innerHTML = 'Please <a href="index.html">sign in</a> to see your outcomes.';
    $("denied").hidden = false;
    return;
  }
  await load();
})();
