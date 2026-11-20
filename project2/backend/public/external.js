// R4: one externally owned opportunity (external.html?id=N), or, with no id, the signed-in user's
// own external opportunities. Everything from the source is set with textContent through h()
// (R4-07): imported text is shown as text and never becomes markup, a script or an instruction.
const $ = (id) => document.getElementById(id);
const statusEl = $("status");

// "2026-11-20T20:15:00Z" -> "Nov 20, 2026, 3:15 p.m." in Algoma's time zone.
function formatTime(iso) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-CA", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" });
}

function fact(label, ...value) {
  return h("div", {}, h("dt", { text: label }), h("dd", {}, ...value));
}

// R4-10, R4-13: whether the copy is current, said plainly and above everything else.
function warningsFor(o) {
  const items = [];
  if (o.sourceState.value !== "listed") {
    items.push(
      h(
        "div",
        { class: "warning", role: "note" },
        h("p", {}, h("strong", { text: o.sourceState.label + (o.sourceState.since ? ` (since ${formatTime(o.sourceState.since)})` : "") })),
        h("p", { text: o.sourceState.text }),
      ),
    );
  }
  if (o.freshness.stale) {
    items.push(
      h(
        "div",
        { class: "warning", role: "note" },
        h("p", {}, h("strong", { text: "This information may be out of date." })),
        h("p", { text: o.freshness.staleReason }),
        h("p", { text: `Last successful update from ${o.source.ownerName}: ${formatTime(o.freshness.lastSuccessfulSyncAt)}.` }),
      ),
    );
  }
  return items;
}

function renderSupport(o, session, reload) {
  $("support-explainer").textContent = o.wording.interest;
  setChildren($("support-list"), 
    ...(o.interestedFaculty.length
      ? o.interestedFaculty.map((f) =>
          h(
            "li",
            {},
            h("a", { href: `faculty.html?id=${encodeURIComponent(f.id)}`, text: f.displayName }),
            ` — offering support since ${formatTime(f.since)}`,
            f.note ? h("p", { class: "hint", text: `Their note (local to Algoma): ${f.note}` }) : null,
          ),
        )
      : [h("li", { text: "No Algoma faculty member has offered support yet." })]),
  );

  const controls = $("support-controls");
  controls.replaceChildren();
  if (!o.you.canExpressInterest) return;
  const mine = o.you.interest;
  if (mine?.changedSinceInterest.length) {
    controls.append(
      h(
        "div",
        { class: "warning", role: "note" },
        h("p", {}, h("strong", { text: `${o.source.ownerName} changed this after you offered support:` })),
        h("ul", {}, ...mine.changedSinceInterest.map((text) => h("li", { text }))),
      ),
    );
  }
  const note = h("textarea", { id: "interest-note", name: "note", maxLength: 500, rows: 3, value: mine?.note || "" });
  const form = h(
    "form",
    { id: "interest-form" },
    h("h3", { text: mine ? "You are offering support" : "Offer support to students" }),
    h(
      "div",
      { class: "field" },
      h("label", { htmlFor: "interest-note", text: "Note for students (optional; stored locally, never sent to the provider)" }),
      note,
    ),
    h(
      "div",
      { class: "actions" },
      h("button", { type: "submit", class: "primary", text: mine ? "Update my note" : "I'm willing to support students pursuing this" }),
      mine ? h("button", { type: "button", id: "interest-withdraw", text: "Withdraw my support" }) : null,
    ),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const res = await api(`/api/external-opportunities/${o.id}/interest`, { method: "PUT", body: { note: note.value } });
    if (!res.ok) return showApiError(statusEl, res, "Could not save your support.");
    await reload("Saved: you are listed as offering support.");
  });
  controls.append(form);
  $("interest-withdraw")?.addEventListener("click", async () => {
    const res = await api(`/api/external-opportunities/${o.id}/interest`, { method: "DELETE" });
    if (!res.ok) return showApiError(statusEl, res, "Could not withdraw your support.");
    await reload("Withdrawn: you are no longer listed.");
  });
}

// R4-21 to R4-24: what the suggestion is based on, and that it never blocks.
function renderReadiness(o) {
  const r = o.readiness;
  $("readiness-section").hidden = !r;
  if (!r) return;
  setChildren($("readiness-body"), 
    r.suggestion ? h("p", { text: r.suggestion }) : null,
    r.basedOn ? h("p", { class: "hint", text: r.basedOn }) : null,
    r.note ? h("p", { text: `Note from Algoma faculty: ${r.note}` }) : null,
    r.you
      ? h(
          "div",
          { class: "note" },
          h("p", { text: r.you.text }),
          r.you.confirmedOutcomes.length
            ? h(
                "ul",
                {},
                ...r.you.confirmedOutcomes.map((x) => h("li", {}, h("a", { href: `outcomes.html#outcome-${x.id}`, text: x.summary }), ` (completed ${formatDay(x.completedOn)})`)),
              )
            : null,
        )
      : null,
    h("p", {}, h("strong", { text: r.reminder })),
  );
}

function renderGuidanceControls(o, reload) {
  const box = $("guidance-controls");
  box.replaceChildren();
  if (!o.you.canEditGuidance) return;
  const suggest = h("input", { type: "checkbox", id: "guidance-suggest", checked: o.you.guidance.suggestPriorOutcome });
  const note = h("textarea", { id: "guidance-note", maxLength: 500, rows: 2, value: o.you.guidance.note });
  const form = h(
    "form",
    { class: "note" },
    h("h3", { text: "Readiness guidance (faculty and staff)" }),
    h("p", { class: "hint", text: "Local guidance shown to students. It is a suggestion only and never stops anyone viewing or applying." }),
    h("div", { class: "field" }, h("label", {}, suggest, " Suggest completing substantial project work (a confirmed outcome) first")),
    h("div", { class: "field" }, h("label", { htmlFor: "guidance-note", text: "Guidance note (optional)" }), note),
    h("div", { class: "actions" }, h("button", { type: "submit", text: "Save guidance" })),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const res = await api(`/api/external-opportunities/${o.id}/guidance`, {
      method: "PUT",
      body: { suggestPriorOutcome: suggest.checked, note: note.value },
    });
    if (!res.ok) return showApiError(statusEl, res, "Could not save the guidance.");
    await reload("Guidance saved.");
  });
  box.append(form);
}

function renderTracking(o, reload) {
  const t = o.you.tracking;
  $("tracking-section").hidden = !t;
  if (!t) return;
  const select = h("select", { id: "tracking-status" }, h("option", { value: "", text: "Choose…" }), ...t.statuses.map((s) => h("option", { value: s.value, text: s.label, selected: s.value === t.status })));
  const form = h(
    "form",
    {},
    h("p", { class: "hint", text: t.privacy }),
    h("div", { class: "field" }, h("label", { htmlFor: "tracking-status", text: "Where you are with it" }), select),
    h("div", { class: "actions" }, h("button", { type: "submit", text: "Save" })),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!select.value) return showStatus(statusEl, "Choose an option first.", { error: true });
    const res = await api(`/api/external-opportunities/${o.id}/my-status`, { method: "PUT", body: { status: select.value } });
    if (!res.ok) return showApiError(statusEl, res, "Could not save.");
    await reload("Saved to your own record.");
  });
  setChildren($("tracking-body"), 
    form,
    t.history.length ? h("h3", { text: "Your history" }) : null,
    t.history.length ? h("ul", {}, ...t.history.map((x) => h("li", { text: `${formatTime(x.at)}: ${x.label}` }))) : null,
  );
}

function renderExternal(o, session, reload) {
  document.title = `${o.title} — Opportunity Registry`;
  $("external-owner-badge").textContent = `External opportunity · ${o.wording.ownership}`;
  $("external-title").textContent = o.title;
  setChildren($("external-warnings"), ...warningsFor(o));
  $("external-authority").textContent = o.wording.authority;
  const apply = $("external-apply");
  apply.href = o.authoritativeUrl;
  apply.textContent = `${o.wording.apply} (opens the ${o.source.ownerName} site)`;
  $("external-apply-note").textContent = o.wording.applyNote;

  const closing = o.closing.closesOn ? `${formatDay(o.closing.closesOn)}. ${o.closing.text}` : o.closing.text;
  setChildren($("external-facts"), 
    fact("Owned by", `${o.source.ownerName} (source: ${o.source.name})`),
    fact(`${o.source.ownerName} reference`, o.source.externalId),
    fact(`Closing date listed by ${o.source.ownerName}`, closing),
    fact(`Last successful update from ${o.source.ownerName}`, formatTime(o.freshness.lastSuccessfulSyncAt)),
    fact("Last changed by the source", o.freshness.lastChangedBySourceAt ? formatTime(o.freshness.lastChangedBySourceAt) : "No changes since it was first copied"),
    fact("Original record", h("a", { href: o.authoritativeUrl, target: "_blank", rel: "noopener noreferrer external", text: o.authoritativeUrl })),
  );

  $("external-description-source").textContent = `As provided by ${o.source.ownerName}; shown exactly as text.`;
  $("external-description").textContent = o.description || "No description was provided.";
  setChildren($("external-areas"), 
    ...o.researchAreas.map((area) => h("li", {}, h("a", { href: `projects.html?area=${encodeURIComponent(area)}`, text: area }))),
  );
  $("areas-section").hidden = o.researchAreas.length === 0;

  renderSupport(o, session, reload);
  renderReadiness(o);
  renderGuidanceControls(o, reload);
  renderTracking(o, reload);

  setChildren($("history-list"), 
    ...(o.sourceHistory.length
      ? o.sourceHistory.map((e) =>
          h(
            "li",
            {},
            `${formatTime(e.at)}: ${e.text}`,
            e.previousTitle ? h("span", { class: "hint", text: ` Previously titled “${e.previousTitle}”.` }) : null,
            e.previousClosesOn ? h("span", { class: "hint", text: ` Previous closing date ${formatDay(e.previousClosesOn)}.` }) : null,
          ),
        )
      : [h("li", { text: `No changes recorded since it was first copied from ${o.source.ownerName}.` })]),
  );
  $("external-view").hidden = false;
}

function externalLink(o, extra) {
  return h(
    "li",
    { class: "card" },
    h("p", { class: "kind kind-external" }, h("span", { class: "owner-badge", text: `External · ${o.wording.ownership}` })),
    h("h2", {}, h("a", { href: `external.html?id=${encodeURIComponent(o.id)}`, text: o.title })),
    o.sourceState.value !== "listed" ? h("p", {}, h("strong", { text: o.sourceState.label })) : null,
    ...extra,
  );
}

async function renderMine(session) {
  $("mine-view").hidden = false;
  if (!session.authenticated) {
    setChildren($("mine-body"), h("p", {}, "Sign in to see the external opportunities you follow. ", h("a", { href: "index.html", text: "Sign in" })));
    return;
  }
  const res = await api("/api/external-opportunities/mine");
  if (!res.ok) return showStatus(statusEl, res.data.error || "Could not load your external opportunities.", { error: true });
  const { interests, tracking } = res.data;
  const body = [];
  if (session.user.isVerifiedFaculty) {
    body.push(h("h2", { text: "Where you offer support" }));
    body.push(
      interests.length
        ? h(
            "ul",
            { class: "cards" },
            ...interests.map((o) =>
              externalLink(o, [
                o.changedSinceInterest
                  ? h("p", { class: "warning", text: `${o.source.ownerName} changed this after you offered support${o.fieldsChangedSinceInterest.length ? ` (${o.fieldsChangedSinceInterest.join(", ")})` : ""}. Open it to see what moved.` })
                  : h("p", { class: "hint", text: "No change by the source since you offered support." }),
              ]),
            ),
          )
        : h("p", { text: "You haven't offered support on any external opportunity yet." }),
    );
  } else {
    body.push(h("h2", { text: "Your own records" }));
    body.push(
      tracking.length
        ? h("ul", { class: "cards" }, ...tracking.map((o) => externalLink(o, [h("p", { text: `You recorded: ${o.myStatus.label}` })])))
        : h("p", { text: "You haven't recorded anything on an external opportunity yet." }),
    );
  }
  setChildren($("mine-body"), ...body);
}

(async () => {
  const session = await getSession();
  renderNav(session);
  const id = new URLSearchParams(location.search).get("id");
  if (id === null) return renderMine(session);

  const load = async (message) => {
    const res = await api(`/api/external-opportunities/${encodeURIComponent(id)}`);
    if (res.status === 404 || res.status === 400) {
      $("not-found").hidden = false;
      return;
    }
    if (!res.ok) return showStatus(statusEl, res.data.error || "Could not load this opportunity.", { error: true });
    renderExternal(res.data.opportunity, session, load);
    if (message) {
      showStatus(statusEl, message);
      focusElement("#status");
    }
  };
  await load();
})();
