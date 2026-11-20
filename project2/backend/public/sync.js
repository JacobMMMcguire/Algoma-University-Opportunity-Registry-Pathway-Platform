// R4-08 to R4-14: staff trigger a sync of an external source and see whether syncing is healthy:
// the last successful run, the last failure and its reason, and counts by classification.
const $ = (id) => document.getElementById(id);
const statusEl = $("status");

const COUNT_LABELS = {
  new: "New",
  unchanged: "Unchanged",
  changed: "Changed",
  reappeared: "Reappeared",
  withdrawn: "Withdrawn by source",
  not_seen: "Not seen (newly missing)",
  still_not_seen: "Still not seen",
  malformed: "Malformed (skipped)",
};

function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-CA", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "medium" });
}

function countsText(counts) {
  const parts = Object.entries(COUNT_LABELS)
    .filter(([key]) => counts && counts[key])
    .map(([key, label]) => `${label}: ${counts[key]}`);
  return parts.length ? parts.join(" · ") : "—";
}

function runSummary(run, heading) {
  if (!run) return h("p", {}, h("strong", { text: `${heading}: ` }), "none yet.");
  return h(
    "div",
    {},
    h("p", {}, h("strong", { text: `${heading}: ` }), `${formatTime(run.finishedAt)} (${run.feed}, run #${run.id})`),
    run.failureReason ? h("p", { text: `Reason: ${run.failureReason}` }) : null,
    run.status === "succeeded" ? h("p", { text: `Counts: ${countsText(run.counts)}` }) : null,
  );
}

async function showRun(id) {
  const res = await api(`/api/external-sync/runs/${id}`);
  if (!res.ok) return showStatus(statusEl, res.data.error || "Could not load the run.", { error: true });
  const { run, items } = res.data;
  setChildren($("run-detail-body"), 
    h("p", { text: `Run #${run.id}: ${run.feed}. ${run.status === "succeeded" ? "Succeeded" : `Failed: ${run.failureReason}`}. Finished ${formatTime(run.finishedAt)}.` }),
    run.feedSyncedAt ? h("p", { text: `The feed says it was produced on ${formatDay(run.feedSyncedAt)}.` }) : null,
    items.length
      ? h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            {},
            h("caption", { text: "How each record was classified" }),
            h("thead", {}, h("tr", {}, h("th", { scope: "col", text: "Source id" }), h("th", { scope: "col", text: "Classification" }), h("th", { scope: "col", text: "Changed fields" }))),
            h(
              "tbody",
              {},
              ...items.map((i) =>
                h(
                  "tr",
                  {},
                  h("td", {}, i.opportunityId ? h("a", { href: `external.html?id=${i.opportunityId}`, text: i.externalId }) : i.externalId),
                  h("td", { text: COUNT_LABELS[i.classification] || i.classification }),
                  h("td", { text: i.changedFields.join(", ") || "—" }),
                ),
              ),
            ),
          ),
        )
      : h("p", { text: "No records were classified (the run failed before reading any)." }),
    run.malformed.length
      ? h(
          "div",
          {},
          h("h3", { text: "Malformed records (reported and skipped)" }),
          h("ul", {}, ...run.malformed.map((m) => h("li", { text: `Record ${m.position}${m.externalId ? ` (${m.externalId})` : ""}: ${m.reasons.join("; ")}` }))),
        )
      : null,
  );
  $("run-detail").hidden = false;
  focusElement("#run-detail-heading");
}

function renderSource(source, resetAvailable) {
  const feedSelect = h(
    "select",
    { id: `feed-${source.id}` },
    ...source.feeds.map((f) => h("option", { value: f.value, text: f.label })),
  );
  const runForm = h(
    "form",
    {},
    h("div", { class: "field" }, h("label", { htmlFor: `feed-${source.id}`, text: "What the provider returns for this run" }), feedSelect),
    h("div", { class: "actions" }, h("button", { type: "submit", class: "primary", text: "Run sync now" })),
  );
  runForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showStatus(statusEl, "Syncing…");
    const res = await api("/api/external-sync/run", { method: "POST", body: { sourceId: source.id, feed: feedSelect.value } });
    if (!res.ok) {
      return showStatus(statusEl, res.data.error || "Could not run the sync.", { error: true });
    }
    await load();
    showStatus(
      statusEl,
      res.data.status === "succeeded"
        ? `Sync succeeded. ${countsText(res.data.counts)}.`
        : `Sync failed: ${res.data.failureReason} Nothing was changed.`,
      { error: res.data.status !== "succeeded" },
    );
    await showRun(res.data.runId);
  });

  const total = Object.values(source.storedByState).reduce((a, b) => a + b, 0);
  const section = h(
    "section",
    { class: "card", "aria-labelledby": `source-${source.id}` },
    h("h2", { id: `source-${source.id}`, text: `${source.name}` }),
    h("p", {}, h("span", { class: source.health.healthy ? "health-ok" : "health-bad", text: source.health.summary })),
    runSummary(source.lastSuccessfulRun, "Last successful sync"),
    runSummary(source.lastFailedRun, "Last failed sync"),
    h(
      "p",
      { text: `Stored copies: ${total} (listed ${source.storedByState.listed || 0}, not seen ${source.storedByState.not_seen || 0}, withdrawn ${source.storedByState.withdrawn || 0}).` },
    ),
    runForm,
    h("h3", { text: "Recent runs" }),
    source.recentRuns.length
      ? h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            {},
            h("thead", {}, h("tr", {}, h("th", { scope: "col", text: "Run" }), h("th", { scope: "col", text: "Result" }))),
            h(
              "tbody",
              {},
              ...source.recentRuns.map((run) => {
                const button = h("button", { type: "button", text: `Run #${run.id}`, "aria-label": `Show details of run ${run.id}` });
                button.addEventListener("click", () => showRun(run.id));
                return h(
                  "tr",
                  {},
                  h("td", {}, button, h("p", { class: "hint", text: `${run.feed}. ${formatTime(run.finishedAt)}` })),
                  h("td", { text: run.status === "failed" ? `Failed: ${run.failureReason}` : run.status === "succeeded" ? `Succeeded. ${countsText(run.counts)}` : run.status }),
                );
              }),
            ),
          ),
        )
      : h("p", { text: "No runs yet." }),
  );

  if (resetAvailable) {
    const confirm = h("input", { type: "checkbox", id: `reset-confirm-${source.id}` });
    const resetForm = h(
      "form",
      { class: "warning" },
      h("h3", { text: "Evaluation only: reset this demonstration source" }),
      h("p", {
        text: "Returns this synthetic source to \"never synced\" so a reviewer can run v1 then v2 from the start. It removes this source's copies, its sync history and the local notes attached to them. A normal sync never deletes anything. Only available in test mode.",
      }),
      h("div", { class: "field" }, h("label", {}, confirm, " I understand this removes this source's data")),
      h("div", { class: "actions" }, h("button", { type: "submit", text: "Reset source" })),
    );
    resetForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!confirm.checked) {
        showStatus(statusEl, "Tick the box to confirm the reset.", { error: true });
        return confirm.focus();
      }
      const res = await api("/api/external-sync/reset", { method: "POST", body: { sourceId: source.id, confirm: true } });
      if (!res.ok) return showStatus(statusEl, res.data.error || "Could not reset.", { error: true });
      $("run-detail").hidden = true;
      await load();
      showStatus(statusEl, "Reset: the source has never been synced. Run v1, then v2.");
    });
    section.append(resetForm);
  }
  return section;
}

async function load() {
  const res = await api("/api/external-sync/health");
  if (res.status === 401) return showStatus(statusEl, "Sign in as staff to see sync health.", { error: true });
  if (res.status === 403) return showStatus(statusEl, "Only staff can see sync health.", { error: true });
  if (!res.ok) return showStatus(statusEl, res.data.error || "Could not load sync health.", { error: true });
  setChildren($("sources"), ...res.data.sources.map((s) => renderSource(s, res.data.resetAvailable)));
}

(async () => {
  const session = await getSession();
  renderNav(session);
  await load();
})();
