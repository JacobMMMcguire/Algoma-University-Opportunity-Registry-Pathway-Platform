// R2-02 to R2-14: industry opportunities, for verified faculty and staff only. Verified faculty
// also record willingness to supervise and partner engagement; staff only read.
// R2-03: every partner-written value is set with textContent, never parsed as HTML.
const $ = (id) => document.getElementById(id);
const statusEl = $("status");

let session = null;
let current = null; // the opportunity on the detail view

function formatDate(value) {
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function willingText(count) {
  return count === 0
    ? "No verified faculty member has said they're willing to supervise yet."
    : `${count} verified faculty member${count === 1 ? " has" : "s have"} said they're willing to supervise.`;
}

// R2-13: what's happening with the partner, and who recorded it.
function engagementText(engagement) {
  if (!engagement.by) return `${engagement.label}.`;
  return `${engagement.label}, recorded by ${engagement.by.displayName} on ${formatDate(engagement.updatedAt)}.`;
}

function renderList(submissions) {
  $("submission-list").replaceChildren(
    ...submissions.map((s) => {
      const heading = el("h2");
      const link = el("a", s.title);
      link.href = `submissions.html?id=${encodeURIComponent(s.id)}`;
      heading.append(link);
      const card = el("li", undefined, "card");
      card.append(
        heading,
        el("p", `${s.state.label} · ${s.supervisorCount} willing to supervise · Engagement: ${s.engagement.label}`),
        el("p", `${s.organisation} · ${s.capacity.label} · received ${formatDate(s.createdAt)}`),
        el("p", s.researchAreas.join(" · ") || "No areas chosen", "hint"),
      );
      return card;
    }),
  );
  const n = submissions.length;
  const awaiting = submissions.filter((s) => s.state.value === "awaiting_supervisor").length;
  $("result-count").textContent =
    n === 0 ? "No industry opportunities yet." : `${n} opportunit${n === 1 ? "y" : "ies"}, ${awaiting} awaiting a faculty supervisor.`;
  $("list-view").hidden = false;
}

function renderSubmission(s) {
  current = s;
  document.title = `${s.title} — Industry opportunities — Opportunity Registry`;
  $("submission-title").textContent = s.title;

  // R2-08: the state, and what it means for students.
  $("submission-state").textContent = `${s.state.label}.`;
  $("submission-state-hint").textContent =
    s.state.value === "awaiting_supervisor"
      ? "Students can't see it until a verified faculty member says they're willing to supervise it."
      : s.supervisors.some((x) => x.publiclyVisible)
        ? "Students and visitors can find it under Projects."
        : "Signed-in students can find it under Projects. It isn't public, because none of its supervisors has allowed public display.";
  $("student-link").hidden = s.state.value !== "supervised";
  $("student-link").querySelector("a").href = `opportunity.html?id=${encodeURIComponent(s.id)}`;

  $("submission-organisation").textContent = s.organisation;
  $("submission-capacity").textContent = s.capacity.label;
  $("submission-received").textContent = formatDate(s.createdAt);
  $("submission-description").textContent = s.description;
  $("submission-areas").replaceChildren(...s.researchAreas.map((area) => el("li", area)));
  $("no-areas").hidden = s.researchAreas.length > 0;

  // R2-09, R2-11: how many are willing, and who.
  $("supervisor-count").textContent = willingText(s.supervisorCount);
  $("supervisor-list").replaceChildren(
    ...s.supervisors.map((x) => {
      const item = el("li");
      const link = el("a", x.displayName);
      link.href = `faculty.html?id=${encodeURIComponent(x.id)}`;
      item.append(link);
      if (x.id === session.user.id) item.append(" (you)");
      return item;
    }),
  );
  const isFaculty = session.user.isVerifiedFaculty;
  $("willingness-actions").hidden = !isFaculty;
  $("willing").hidden = s.viewerIsSupervisor;
  $("withdraw").hidden = !s.viewerIsSupervisor;

  // R2-12 to R2-14.
  $("engagement-current").textContent = engagementText(s.engagement);
  $("engagement-form").hidden = !isFaculty;
  $("engagement-state").value = s.engagement.value;

  $("contact-name").textContent = s.contact.name;
  // The server only accepts addresses without spaces, quotes or angle brackets.
  $("contact-email").href = `mailto:${s.contact.email}`;
  $("contact-email").textContent = s.contact.email;
  $("submission-view").hidden = false;
}

async function changeWillingness(method, button, message) {
  const res = await api(`/api/partner-submissions/${encodeURIComponent(current.id)}/willingness`, { method });
  if (!res.ok) {
    showApiError(statusEl, res, "Could not save that. Please try again.");
    button.focus();
    return;
  }
  renderSubmission(res.data.submission);
  showStatus(statusEl, message(res.data.submission));
  // The button pressed is now hidden; move focus to the one that replaced it.
  ($("willing").hidden ? $("withdraw") : $("willing")).focus();
}

$("willing").addEventListener("click", (event) =>
  changeWillingness("PUT", event.currentTarget, () => "Recorded: you're willing to supervise this. Students can now see it."),
);
$("withdraw").addEventListener("click", (event) =>
  changeWillingness("DELETE", event.currentTarget, (s) =>
    s.state.value === "supervised"
      ? "Your willingness is withdrawn. Other faculty are still willing, so students can still see it."
      : "Your willingness is withdrawn. It is awaiting a faculty supervisor again, and students can no longer see it.",
  ),
);

$("engagement-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const res = await api(`/api/partner-submissions/${encodeURIComponent(current.id)}/engagement`, {
    method: "PUT",
    body: { state: $("engagement-state").value },
  });
  if (!res.ok) {
    showStatus(statusEl, res.data.error || "Could not save the engagement state.", { error: true });
    $("engagement-state").focus();
    return;
  }
  renderSubmission(res.data.submission);
  showStatus(statusEl, "Engagement state saved.");
});

(async () => {
  session = await getSession();
  renderNav(session);
  if (!session.authenticated) {
    $("denied").innerHTML = 'Please <a href="index.html">sign in</a> first.';
    $("denied").hidden = false;
    return;
  }
  if (!session.user.isVerifiedFaculty && !session.user.isStaff) {
    $("denied").textContent = "Industry opportunity reviews are for verified faculty and staff only.";
    $("denied").hidden = false;
    return;
  }

  const id = new URLSearchParams(location.search).get("id");
  if (id === null) {
    const res = await api("/api/partner-submissions");
    if (!res.ok) return showStatus(statusEl, res.data.error || "Could not load industry opportunities.", { error: true });
    renderList(res.data.submissions);
    return;
  }
  const res = await api(`/api/partner-submissions/${encodeURIComponent(id)}`);
  if (res.status === 404 || res.status === 400) {
    $("not-found").hidden = false;
    return;
  }
  if (!res.ok) return showStatus(statusEl, res.data.error || "Could not load this opportunity.", { error: true });
  fillSelect($("engagement-state"), res.data.engagementStates, res.data.submission.engagement.value);
  renderSubmission(res.data.submission);
})();
