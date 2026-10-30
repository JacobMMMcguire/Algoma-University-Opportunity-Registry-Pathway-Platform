// R3-01 to R3-07: students answer the matches proposed to them; faculty propose and withdraw
// matches on the opportunities they manage and record partner agreement. The server decides
// who may do what (the `you` flags); this page only offers those actions. Titles of industry
// opportunities are partner text, so everything here is built with textContent (R2-03).
const $ = (id) => document.getElementById(id);
const statusEl = $("status");

let session = null;
let focusAfterLoad = null; // a selector to focus once the lists are redrawn

// Builds an element. `props.text` sets textContent; children may be strings or elements.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("data-") || key.startsWith("aria-")) node.setAttribute(key, value);
    else node[key] = value;
  }
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

const longDate = (timestamp) =>
  new Date(timestamp).toLocaleDateString("en-CA", { day: "numeric", month: "long", year: "numeric" });

const kindLabel = (kind) => (kind === "industry" ? "Industry project" : "Faculty project");

function studentList(match) {
  return el(
    "ul",
    { class: "responses", "aria-label": "Students and their answers" },
    ...match.students.map((s) =>
      el("li", {}, el("span", { text: s.isYou ? `${s.name} (you)` : s.name }), `: ${s.responseLabel}`),
    ),
  );
}

function partnerLine(agreement) {
  if (!agreement) return null;
  return el(
    "p",
    { class: "hint" },
    el("strong", { text: agreement.text }),
    agreement.note ? ` Note: ${agreement.note}` : "",
    ` ${agreement.explanation}`,
  );
}

function matchHeader(match) {
  return [
    el("p", {}, el("strong", { text: match.label }), `: ${match.summary}`),
    el("p", { class: "hint", text: `Proposed by ${match.proposedBy || "a faculty member"} on ${longDate(match.proposedAt)}.` }),
    match.withdrawnAt &&
      el("p", { class: "hint", text: `Withdrawn by ${match.withdrawnBy || "a faculty member"} on ${longDate(match.withdrawnAt)}.` }),
    studentList(match),
  ];
}

// What a student should do next, in words (usability question: "what do I do?").
function nextStep(match) {
  const you = match.you;
  if (you.canConfirm) return "If you intend to take part, confirm. If not, decline. The faculty member sees your answer.";
  if (you.confirmBlockedReason) return you.confirmBlockedReason;
  if (match.state === "partly_confirmed" && you.response === "confirmed") {
    return "You have confirmed. It is waiting for the other students. Until they all confirm, you can still decline.";
  }
  if (match.state === "confirmed") return "Everyone has confirmed. Contact the faculty member to plan the work.";
  return "";
}

function studentCard(match) {
  const card = el(
    "li",
    { class: "card", "data-match": match.id },
    el("p", { class: "kind", text: [kindLabel(match.opportunity.kind), match.run.term].filter(Boolean).join(" · ") }),
    el("h3", {}, el("a", { href: match.opportunity.link, text: match.opportunity.title })),
    ...matchHeader(match),
    partnerLine(match.partnerAgreement),
  );
  const step = nextStep(match);
  if (step) card.append(el("p", { text: step }));
  const buttons = [];
  if (match.you.canConfirm) buttons.push(el("button", { type: "button", class: "primary", "data-action": "confirm", text: "Confirm" }));
  if (match.you.canDecline) buttons.push(el("button", { type: "button", "data-action": "decline", text: "Decline" }));
  if (buttons.length) card.append(el("div", { class: "actions" }, ...buttons));
  return card;
}

function facultyMatch(match) {
  const item = el(
    "li",
    { "data-match": match.id },
    match.run.current ? null : el("p", { class: "kind", text: `Earlier run ${match.run.runNumber}${match.run.term ? `, ${match.run.term}` : ""}` }),
    ...matchHeader(match),
  );
  if (match.you.canWithdraw) {
    item.append(el("div", { class: "actions" }, el("button", { type: "button", "data-action": "withdraw", text: "Withdraw proposal" })));
  }
  return item;
}

function proposeForm(item, limits) {
  const id = `propose-${item.kind}-${item.id}`;
  return el(
    "form",
    { class: "propose", "data-form": "propose", "aria-label": `Propose a match for ${item.title}` },
    el("label", { htmlFor: id, text: "Students' Algoma email addresses" }),
    el("textarea", { id, name: "students", rows: 3, "aria-describedby": `${id}-hint` }),
    el("p", { id: `${id}-hint`, class: "hint", text: `One per line, up to ${limits.students}. Each student confirms for themselves.` }),
    el("button", { type: "submit", class: "primary", text: "Propose match" }),
  );
}

function partnerForm(item, limits) {
  const id = `partner-${item.id}`;
  const agreed = item.partnerAgreement?.agreed;
  return el(
    "form",
    { class: "inline-form", "data-form": "partner", "aria-label": `Partner agreement for ${item.title}` },
    el("label", { htmlFor: id, text: "Note (optional)" }, el("input", { id, name: "note", maxLength: limits.note })),
    el("button", { type: "submit", "data-agreed": "true", text: agreed ? "Record again: partner agreed" : "Record: partner agreed in principle" }),
    agreed ? el("button", { type: "submit", "data-agreed": "false", text: "Retract the record" }) : null,
  );
}

function opportunityCard(item, limits) {
  const card = el(
    "li",
    { class: "card", "data-key": `${item.kind}-${item.id}` },
    el("p", { class: "kind", text: [kindLabel(item.kind), item.lifecycle.term].filter(Boolean).join(" · ") }),
    el("h3", {}, el("a", { href: item.link, text: item.title })),
    // The reason starts with the state, e.g. "Expired: the deadline ... passed".
    el("p", { class: "lifecycle", text: item.lifecycle.reason }),
  );
  if (item.canRecordPartnerAgreement) {
    card.append(
      el("h4", { text: "Partner agreement" }),
      partnerLine(item.partnerAgreement) ||
        el("p", { class: "hint", text: "Not recorded for this term. Record it when the partner tells you they agree in principle." }),
      partnerForm(item, limits),
    );
  }
  card.append(el("h4", { text: "Matches" }));
  card.append(item.matches.length ? el("ul", { class: "match-list" }, ...item.matches.map(facultyMatch)) : el("p", { class: "hint", text: "None yet." }));
  if (item.canPropose) card.append(proposeForm(item, limits));
  else card.append(el("p", { class: "hint", text: "New matches can be proposed only while the opportunity is open." }));
  return card;
}

let studentMatches = [];
let managed = null;

async function load() {
  const tasks = [
    api("/api/matches").then((res) => {
      if (!res.ok) throw new Error(res.data.error);
      studentMatches = res.data.matches;
      $("student-notice").textContent = res.data.notice;
    }),
  ];
  if (session.user.isVerifiedFaculty) {
    tasks.push(
      api("/api/matches/manage").then((res) => {
        if (!res.ok) throw new Error(res.data.error);
        managed = res.data;
        $("faculty-notice").textContent = res.data.notice;
      }),
    );
  }
  try {
    await Promise.all(tasks);
  } catch (error) {
    showStatus(statusEl, error.message || "Could not load your matches.", { error: true });
    return;
  }
  render();
}

function render() {
  // Faculty see the student list only if someone has proposed a match to them.
  const showStudent = !session.user.isVerifiedFaculty || studentMatches.length > 0;
  $("student-section").hidden = !showStudent;
  if (showStudent) {
    $("student-matches").replaceChildren(
      ...(studentMatches.length
        ? studentMatches.map(studentCard)
        : [el("li", { text: "No faculty member has proposed a match to you yet. When one does, it appears here." })]),
    );
  }
  if (managed) {
    $("faculty-section").hidden = false;
    $("opportunities").replaceChildren(
      ...(managed.opportunities.length
        ? managed.opportunities.map((item) => opportunityCard(item, managed.limits))
        : [el("li", { text: "You have no published projects or supervised industry opportunities yet." })]),
    );
  }
  if (focusAfterLoad) {
    document.querySelector(focusAfterLoad)?.focus();
    focusAfterLoad = null;
  }
}

async function send(path, body, done, focusSelector) {
  const res = await api(path, { method: "POST", body });
  if (!res.ok) {
    showStatus(statusEl, res.data.error || "Could not save that.", { error: true });
    return false;
  }
  focusAfterLoad = focusSelector;
  await load();
  showStatus(statusEl, done(res.data));
  return true;
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const id = Number(button.closest("[data-match]").dataset.match);
  const match = studentMatches.find((m) => m.id === id) || managed?.opportunities.flatMap((o) => o.matches).find((m) => m.id === id);
  const action = button.dataset.action;
  const title = match.opportunity.title;
  if (action === "decline" && !confirm(`Decline the match for "${title}"? The faculty member will see that you declined. This can't be undone.`)) return;
  if (action === "withdraw" && !confirm(`Withdraw this proposal for "${title}"? The students will see that it was withdrawn.`)) return;
  const done = {
    confirm: (d) => `You confirmed the match for "${title}". It is now ${d.match.label.toLowerCase()}.`,
    decline: () => `You declined the match for "${title}".`,
    withdraw: () => `Proposal for "${title}" withdrawn.`,
  }[action];
  send(`/api/matches/${id}/${action}`, undefined, done, `[data-match="${id}"]`);
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const [kind, id] = form.closest("[data-key]").dataset.key.split("-");
  const item = managed.opportunities.find((o) => o.kind === kind && String(o.id) === id);
  const cardSelector = `[data-key="${kind}-${id}"] h3 a`;
  if (form.dataset.form === "propose") {
    const students = form.elements.students.value.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    const ok = await send(
      "/api/matches",
      { kind, opportunityId: Number(id), students },
      (d) => `Match proposed for "${item.title}" to ${d.match.students.length === 1 ? "1 student" : `${d.match.students.length} students`}.`,
      cardSelector,
    );
    if (!ok) form.elements.students.focus();
  } else if (form.dataset.form === "partner") {
    const agreed = event.submitter?.dataset.agreed !== "false";
    await send(
      `/api/matches/partner-agreements/${id}`,
      { agreed, note: form.elements.note.value },
      () => (agreed ? `Recorded that the partner agreed in principle to "${item.title}".` : `Partner agreement record for "${item.title}" retracted.`),
      cardSelector,
    );
  }
});

(async () => {
  session = await getSession();
  renderNav(session);
  if (!session.authenticated) {
    $("denied").innerHTML = 'Please <a href="index.html">sign in</a> to see matches proposed to you.';
    $("denied").hidden = false;
    return;
  }
  if (session.user.isStaff && !session.user.isVerifiedFaculty) {
    $("denied").textContent = "Matches are private to the students and faculty involved, so staff don't see them here.";
    $("denied").hidden = false;
    return;
  }
  if (!session.user.isVerifiedFaculty) {
    const profile = await api("/api/account/student-profile");
    $("profile-hint").hidden = !profile.ok || profile.data.profile !== null;
  }
  await load();
})();
