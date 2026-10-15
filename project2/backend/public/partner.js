// R2-01: the public intake form. No sign-in; works for anyone with the link.
const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const FIELDS = ["organisation", "contactName", "contactEmail", "title", "description"];

function renderCapacityOptions(capacities) {
  $("capacity-options").replaceChildren(
    ...capacities.map((o) => {
      const label = document.createElement("label");
      label.className = "choice";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "capacity";
      input.value = o.value;
      input.id = `capacity-${o.value}`;
      const text = document.createElement("span");
      text.textContent = o.label;
      label.append(input, text);
      return label;
    }),
  );
}

function focusField(field) {
  if (field === "researchAreas") return focusAreaPicker($("researchAreas-picker"));
  if (field === "capacity") return $("capacity").querySelector("input")?.focus();
  $(field)?.focus();
}

// R2-04: every problem at once, each a link to its field, then focus on the first one.
function showErrors(errors) {
  for (const field of FIELDS) {
    if (errors.some((e) => e.field === field)) $(field).setAttribute("aria-invalid", "true");
    else $(field).removeAttribute("aria-invalid");
  }
  statusEl.replaceChildren();
  statusEl.classList.add("error");
  const intro = document.createElement("p");
  intro.textContent = "Your project idea wasn't sent yet. Please fix:";
  const list = document.createElement("ul");
  for (const e of errors) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = e.message;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      focusField(e.field);
    });
    item.append(link);
    list.append(item);
  }
  statusEl.append(intro, list);
  focusField(errors[0].field);
}

$("intake-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(FIELDS.map((field) => [field, $(field).value]));
  body.researchAreas = readAreaPicker($("researchAreas-picker"));
  body.capacity = $("intake-form").querySelector('input[name="capacity"]:checked')?.value || "";

  $("submit").disabled = true;
  const res = await api("/api/partner-submissions", { method: "POST", body });
  $("submit").disabled = false;
  if (res.status === 400 && Array.isArray(res.data.errors)) return showErrors(res.data.errors);
  if (!res.ok) return showStatus(statusEl, res.data.error || "Could not send your project idea. Please try again.", { error: true });

  showStatus(statusEl, "");
  $("intake-form").hidden = true;
  $("intro").hidden = true;
  $("done-title").textContent = res.data.submission.title;
  $("done").hidden = false;
  $("done-heading").focus();
});

(async () => {
  const [session, optionsRes] = await Promise.all([getSession(), api("/api/options")]);
  renderNav(session);
  if (!optionsRes.ok) {
    showStatus(statusEl, optionsRes.data.error || "Could not load the form. Please refresh the page.", { error: true });
    return;
  }
  renderAreaPicker($("researchAreas-picker"), optionsRes.data.researchAreaGroups, [], {
    max: 10,
    countEl: $("researchAreas-count"),
  });
  renderCapacityOptions(optionsRes.data.partnerCapacities);
})();
