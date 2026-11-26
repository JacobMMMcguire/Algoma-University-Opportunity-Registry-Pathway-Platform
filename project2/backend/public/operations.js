// F-23, F-24 (FINAL_PLAN.md D8): the one page an operator needs: service health, failed
// notifications, opportunities needing attention and who changed what. Staff only; built with
// h() so record titles stay text.
const $ = (id) => document.getElementById(id);
const statusEl = $("status");

// Plain words for the history's action codes (F-22).
const ACTIONS = {
  "faculty.verify": "verified as faculty",
  "faculty.revoke": "faculty status revoked",
  "person.left": "recorded as having left Algoma",
  "person.graduated": "recorded as graduated",
  "person.returned": "recorded as still at Algoma",
  "consent.faculty_public_profile": "changed their public-display choice",
  "consent.student_public_profile": "changed their public-display choice",
  "consent.outcome_on_profile": "changed whether an outcome shows on their profile",
  "project.publish": "published",
  "project.close": "closed",
  "project.unpublish": "moved back to a draft",
  "supervisor.add": "a faculty member agreed to supervise",
  "supervisor.remove": "a faculty member stopped supervising",
  "engagement.set": "engagement with the organisation changed",
  "match.propose": "match proposed",
  "match.confirm": "a student confirmed",
  "match.decline": "a student declined",
  "match.withdraw": "proposal withdrawn",
  "match.undo_confirmation": "a confirmation was undone",
  "outcome.confirm": "outcome confirmed",
  "outcome.unconfirm": "outcome confirmation taken back",
  "outcome.edit": "outcome edited",
  "external.support_add": "a faculty member offered support",
  "external.support_remove": "a faculty member withdrew support",
  "external.guidance_set": "readiness guidance changed",
  "opportunity.reassign": "given to a new supervisor",
  "notification.retry": "notifications retried",
  "setting.simulate_notification_failure": "simulated notification failure switched",
};
const SUBJECTS = {
  user: "Person",
  project: "Faculty project",
  partner_submission: "Industry opportunity",
  match: "Match",
  outcome: "Outcome",
  external_opportunity: "External opportunity",
  setting: "Setting",
};
const VALUE_WORDS = { true: "yes", false: "no", null: "none", not_contacted: "not contacted", discussion_underway: "discussion underway", partner_confirmed: "partner agreed in principle", no_longer_pursuing: "no longer pursuing" };

const when = (iso) => new Date(iso).toLocaleString("en-CA", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" });
const word = (value) => VALUE_WORDS[String(value)] ?? String(value);

// The before and after values, where the action alone doesn't already say it.
function changeLine(action, detail) {
  if (action.startsWith("person.") || action.startsWith("faculty.") || action.startsWith("project.")) return "";
  if (detail && "from" in detail && "to" in detail && typeof detail.to !== "object") return `from ${word(detail.from)} to ${word(detail.to)}`;
  if (detail?.studentEmail) return `for ${detail.studentEmail}`;
  return "";
}

async function showSummary() {
  const [health, sync, notify, lifecycle] = await Promise.all([
    api("/api/health"),
    api("/api/external-sync/health"),
    api("/api/operations/notifications?limit=1"),
    api("/api/operations/lifecycle?limit=1"),
  ]);
  const items = [
    health.ok ? "Database: reachable." : "Database: not reachable. Pages that need data will show an error until it is back.",
    ...(sync.ok ? sync.data.sources.map((s) => `${s.ownerName} sync: ${s.health.summary}`) : ["External sync: couldn't be checked."]),
    notify.ok ? `Notifications: ${notify.data.counts.failed} failed, ${notify.data.counts.delivered} delivered.` : "Notifications: couldn't be checked.",
    lifecycle.ok
      ? `Opportunities: ${lifecycle.data.counts.needsSupervisor} need a new supervisor, ${lifecycle.data.counts.noDeadline} open with no deadline.`
      : "Opportunities: couldn't be checked.",
  ];
  setChildren($("summary"), ...items.map((text) => h("li", { text })));
  if (sync.ok) showSync(sync.data.sources);
}

function showSync(sources) {
  setChildren(
    $("sync"),
    ...sources.map((s) => {
      const last = s.lastSuccessfulRun;
      const stored = Object.entries(s.storedByState).map(([state, n]) => `${n} ${state.replace(/_/g, " ")}`).join(", ");
      return h(
        "div",
        { class: "card" },
        h("h3", { text: s.ownerName }),
        h("p", { text: s.health.summary }),
        h("p", { class: "hint", text: last ? `Last successful sync: ${when(last.finishedAt || last.startedAt)}.` : "No successful sync yet." }),
        s.lastFailedRun ? h("p", { class: "hint", text: `Last failure: ${s.lastFailedRun.failureReason || "no reason recorded"}` }) : null,
        stored ? h("p", { class: "hint", text: `Records held: ${stored}.` }) : null,
      );
    }),
  );
}

let notifyShown = [];
async function loadNotifications(before = null) {
  const res = await api(`/api/operations/notifications?status=failed${before ? `&before=${before}` : ""}`);
  if (!res.ok) return showStatus(statusEl, res.data.error || "Could not load notifications.", { error: true });
  const { counts, deliveries, next, simulationAvailable, simulatingFailure } = res.data;
  notifyShown = before ? [...notifyShown, ...deliveries] : deliveries;
  $("notify-counts").textContent = counts.failed
    ? `${counts.failed} proposal${counts.failed === 1 ? "'s" : "s'"} notifications failed.`
    : "No failed notifications.";
  setChildren(
    $("notify-list"),
    ...notifyShown.map((d) =>
      h(
        "li",
        { class: "card", "data-submission": d.submissionId },
        h("h3", {}, h("a", { href: `submissions.html?id=${encodeURIComponent(d.submissionId)}`, text: d.title })),
        h("p", { text: `Failed ${d.attempts} time${d.attempts === 1 ? "" : "s"}, last at ${when(d.lastAttemptAt)}: ${d.lastError || "no reason recorded"}` }),
        h("button", { type: "button", "data-retry": d.submissionId, "aria-label": `Retry notifications for ${d.title}`, text: "Retry" }),
      ),
    ),
  );
  $("notify-more").hidden = next === null;
  $("notify-more").onclick = () => loadNotifications(next);
  $("simulate").hidden = !simulationAvailable;
  $("simulate-state").textContent = simulatingFailure ? "On: new proposals' notifications will fail." : "Off.";
  $("simulate-toggle").textContent = simulatingFailure ? "Turn the simulated failure off" : "Turn the simulated failure on";
  $("simulate-toggle").dataset.enabled = String(!simulatingFailure);
}

$("notify-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-retry]");
  if (!button) return;
  button.disabled = true;
  const res = await api(`/api/operations/notifications/${button.dataset.retry}/retry`, { method: "POST" });
  button.disabled = false;
  if (!res.ok) return showStatus(statusEl, res.data.error || "Could not retry.", { error: true });
  showStatus(statusEl, res.data.delivered ? `Delivered: ${res.data.notified} faculty member${res.data.notified === 1 ? "" : "s"} notified.` : `Still failing: ${res.data.error}`, {
    error: !res.data.delivered,
  });
  await Promise.all([loadNotifications(), showSummary(), loadHistory()]);
  $("notify-heading").focus?.();
});

$("simulate-toggle").addEventListener("click", async () => {
  const enabled = $("simulate-toggle").dataset.enabled === "true";
  const res = await api("/api/operations/settings/simulate-notification-failure", { method: "PUT", body: { enabled } });
  if (!res.ok) return showStatus(statusEl, res.data.error || "Could not change that.", { error: true });
  showStatus(statusEl, enabled ? "Simulated notification failure is on." : "Simulated notification failure is off.");
  await Promise.all([loadNotifications(), loadHistory()]);
  $("simulate-toggle").focus();
});

let lifecycleShown = [];
async function loadLifecycle(before = null) {
  const res = await api(`/api/operations/lifecycle${before ? `?before=${before}` : ""}`);
  if (!res.ok) return showStatus(statusEl, res.data.error || "Could not load opportunities.", { error: true });
  const { counts, problems, next } = res.data;
  lifecycleShown = before ? [...lifecycleShown, ...problems] : problems;
  $("lifecycle-counts").textContent =
    `${counts.needsSupervisor} need a new supervisor; ${counts.noDeadline} are open with no deadline. ` +
    `${counts.left} faculty member${counts.left === 1 ? " has" : "s have"} left Algoma and ${counts.graduated} student${counts.graduated === 1 ? " has" : "s have"} graduated.`;
  setChildren(
    $("lifecycle-list"),
    ...(lifecycleShown.length
      ? lifecycleShown.map((p) =>
          h(
            "li",
            { class: "card" },
            h("p", { class: "kind", text: `${p.kind === "industry" ? "Industry opportunity" : "Faculty project"} · ${p.lifecycle.label}` }),
            h("h3", {}, h("a", { href: `lifecycle.html?q=${encodeURIComponent(p.title)}`, text: p.title })),
            h("p", { text: p.explanation }),
          ),
        )
      : [h("li", { text: "Nothing needs attention." })]),
  );
  $("lifecycle-more").hidden = next === null;
  $("lifecycle-more").onclick = () => loadLifecycle(next);
}

let historyShown = [];
let historyFilter = new URLSearchParams();
async function loadHistory(before = null) {
  const params = new URLSearchParams(historyFilter);
  if (before) params.set("before", before);
  const res = await api(`/api/operations/history?${params}`);
  if (!res.ok) return showStatus(statusEl, res.data.error || "Could not load the history.", { error: true });
  historyShown = before ? [...historyShown, ...res.data.events] : res.data.events;
  setChildren(
    $("history-list"),
    ...(historyShown.length
      ? historyShown.map((e) =>
          h(
            "li",
            {},
            h("strong", { text: `${SUBJECTS[e.subject.type] || e.subject.type} ${e.subject.id}: ` }),
            `${ACTIONS[e.action] || e.action} ${changeLine(e.action, e.detail)}`.trim(),
            h("span", { class: "hint", text: ` — ${e.by || "someone no longer listed"}, ${when(e.at)}` }),
          ),
        )
      : [h("li", { text: "No changes recorded for that." })]),
  );
  $("history-more").hidden = res.data.next === null;
  $("history-more").onclick = () => loadHistory(res.data.next);
}

$("history-filter").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  historyFilter = new URLSearchParams();
  if (form.elements.subjectType.value) historyFilter.set("subjectType", form.elements.subjectType.value);
  const id = form.elements.subjectId.value.trim();
  if (id && !/^\d+$/.test(id)) {
    showStatus(statusEl, "The record number is digits only, for example 12.", { error: true });
    return form.elements.subjectId.focus();
  }
  if (id) historyFilter.set("subjectId", id);
  loadHistory().then(() => $("history-list").querySelector("li")?.setAttribute("tabindex", "-1"));
});

(async () => {
  const session = await getSession();
  renderNav(session);
  if (!session.authenticated) {
    $("denied").innerHTML = 'Please <a href="signin.html?next=operations.html">sign in</a> first.';
    $("denied").hidden = false;
    return;
  }
  if (!session.user.isStaff) {
    $("denied").textContent = "This page is for Algoma staff.";
    $("denied").hidden = false;
    return;
  }
  $("panel").hidden = false;
  await Promise.all([showSummary(), loadNotifications(), loadLifecycle(), loadHistory()]);
})();
