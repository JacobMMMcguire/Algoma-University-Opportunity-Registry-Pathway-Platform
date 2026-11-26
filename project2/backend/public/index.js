const $ = (id) => document.getElementById(id);
const statusEl = $("status");

// Visitors see the landing page; signing in happens on signin.html.
function showSignedOut() {
  $("signed-out").hidden = false;
  $("signed-in").hidden = true;
  showLanding();
}

// "Open now" and the research-area tiles, from the same discovery list the Projects page uses, so
// they never show anything a visitor couldn't already find there. Titles and partner names stay
// text (h()). F-18: only a few cards and the area counts are fetched, never every record.
const LANDING_LINE = {
  faculty: (p) => ["Faculty project", p.faculty.displayName, p.targetTerm].filter(Boolean).join(" · "),
  industry: (o) => `Industry project · ${o.organisation}`,
  external: (o) => `External · ${o.wording.ownership}`,
};
const LANDING_PAGE = { faculty: "projects.html", industry: "opportunity.html", external: "external.html" };

async function showLanding() {
  const [first, external] = await Promise.all([api("/api/discovery?limit=6"), api("/api/discovery?type=external&limit=1")]);
  if (!first.ok || first.data.total === 0) return;
  const toItem = ({ kind, record }) => ({
    title: record.title,
    href: `${LANDING_PAGE[kind]}?id=${encodeURIComponent(record.id)}`,
    line: LANDING_LINE[kind](record),
    external: kind === "external",
  });
  const local = first.data.items.filter((i) => i.kind !== "external").map(toItem);
  const externals = (external.ok ? external.data.items : []).map(toItem);
  const openNow = [...local.slice(0, externals.length ? 2 : 3), ...externals.slice(0, 1)].slice(0, 3);
  setChildren(
    $("open-now-list"),
    ...openNow.map((item) =>
      h("li", {}, h("a", { href: item.href, text: item.title }), h("p", { class: item.external ? "external-line" : "", text: item.line })),
    ),
  );
  const total = first.data.total;
  $("see-all").textContent = total === 1 ? "See the 1 project" : `See all ${total} projects`;
  $("open-now").hidden = false;

  const counts = new Map();
  for (const facets of Object.values(first.data.filters)) {
    for (const group of facets.areas) for (const a of group.areas) counts.set(a.value, (counts.get(a.value) || 0) + a.count);
  }
  const areas = [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  setChildren(
    $("area-tiles"),
    ...areas.map(([area, count]) =>
      h(
        "li",
        {},
        h(
          "a",
          { href: `projects.html?area=${encodeURIComponent(area)}`, "aria-label": `${area}: ${count} ${count === 1 ? "project" : "projects"}` },
          h("span", { text: area }),
          h("span", { class: "area-count", "aria-hidden": "true", text: String(count) }),
        ),
      ),
    ),
  );
  $("areas").hidden = areas.length === 0;
}

function showSignedIn(user) {
  $("signed-out").hidden = true;
  $("signed-in").hidden = false;
  $("who").textContent = user.email;

  const roleNote = $("role-note");
  if (user.isStaff) {
    roleNote.innerHTML = 'You have staff access. <a href="admin.html">Manage faculty verification</a>.';
  } else if (user.isVerifiedFaculty) {
    roleNote.innerHTML = 'Your account is verified as faculty. <a href="profile.html">Edit your faculty profile</a>.';
  } else {
    roleNote.textContent = "Faculty member? Ask Centre staff to verify your account to get faculty features.";
  }
  if (user.isStaff && user.isVerifiedFaculty) {
    roleNote.insertAdjacentHTML("beforeend", ' Your account is also verified as faculty. <a href="profile.html">Edit your faculty profile</a>.');
  }

  $("public-profile").hidden = !user.isVerifiedFaculty;
  if (user.isVerifiedFaculty) renderPublicProfileChoice(user);
  if (!user.isVerifiedFaculty && !user.isStaff) showWaitingMatches();
  if (user.isVerifiedFaculty) showFacultyWorkspace(user);
  else greet(user.email.split("@")[0]);
  showShortcuts(user);
}

function greet(name) {
  $("account-heading").textContent = name ? `Welcome back, ${name}` : "Welcome back";
}

// One row of "Waiting on you": what it is, the record's name, a line of detail, and where to act.
function todoItem({ kind, title, detail, href, action }) {
  return h(
    "li",
    {},
    h(
      "div",
      { class: "todo-text" },
      h("p", { class: "todo-kind", text: kind }),
      h("p", { class: "todo-title", text: title }),
      detail ? h("p", { class: "todo-detail", text: detail }) : null,
    ),
    h("a", { class: "button-link", href, text: action }),
  );
}

// The faculty workspace: the things that need them, then their projects. Built from the same
// routes the other pages use, so it can never show more than those pages do. Titles and partner
// names are always text (h()).
async function showFacultyWorkspace(user) {
  $("new-project").hidden = false;
  const [profileRes, mineRes, subsRes, manageRes] = await Promise.all([
    api("/api/faculty/me/profile"),
    api("/api/projects/mine"),
    api("/api/partner-submissions"),
    api("/api/matches/manage"),
  ]);
  const profile = profileRes.ok ? profileRes.data.profile : null;
  greet(profile?.displayName || user.email.split("@")[0]);

  const todos = [];
  if (user.publicProfileChoice === null) {
    todos.push({ kind: "Before you publish", title: "Choose whether your profile is public", detail: "Either answer is fine; you keep every faculty feature.", href: "#public-profile", action: "Choose" });
  }
  if (profileRes.ok && !profile) {
    todos.push({ kind: "Profile", title: "Write your faculty profile", detail: "Students see it next to your projects.", href: "profile.html", action: "Write profile" });
  }
  for (const s of subsRes.ok ? subsRes.data.submissions : []) {
    if (s.state.value !== "awaiting_supervisor" || !s.lifecycle.available) continue;
    todos.push({
      kind: "Industry proposal",
      title: s.title,
      detail: `${s.organisation} · no supervisor yet${s.researchAreas.length ? ` · ${s.researchAreas.join(", ")}` : ""}`,
      href: "submissions.html",
      action: "Review",
    });
  }
  for (const o of manageRes.ok ? manageRes.data.opportunities : []) {
    for (const m of o.matches) {
      if (m.state !== "proposed" && m.state !== "partly_confirmed") continue;
      const students = m.students || [];
      const confirmed = students.filter((s) => (s.response || s.status) === "confirmed").length;
      todos.push({
        kind: "Match in progress",
        title: o.title,
        detail: `${confirmed} of ${students.length} ${students.length === 1 ? "student has" : "students have"} confirmed`,
        href: "matches.html",
        action: "View match",
      });
    }
  }
  const projects = mineRes.ok ? mineRes.data.projects : [];
  for (const p of projects) {
    if (p.status === "draft") {
      todos.push({ kind: "Unpublished draft", title: p.title, detail: "Only you can see it until you publish.", href: `project-edit.html?id=${encodeURIComponent(p.id)}`, action: "Finish draft" });
    } else if (p.lifecycle.state === "expired") {
      todos.push({ kind: "Expired", title: p.title, detail: p.lifecycle.reason, href: "lifecycle.html", action: "Renew or close" });
    }
  }
  setChildren($("todo-list"), ...todos.map(todoItem));
  $("todo").hidden = todos.length === 0;

  setChildren(
    $("my-projects-rows"),
    ...projects.map((p) =>
      h(
        "tr",
        {},
        h("td", {}, h("a", { href: `projects.html?id=${encodeURIComponent(p.id)}`, text: p.title })),
        h("td", {}, h("span", { class: `status-pill status-${p.status}`, text: PROJECT_STATUS_LABELS[p.status] || p.status })),
        h("td", { text: p.targetTerm || "" }),
        h("td", { text: p.status === "published" ? p.lifecycle.label : "Not listed" }),
      ),
    ),
  );
  $("my-projects-panel").hidden = projects.length === 0;
}

// The pages each role uses most, as large links. Same visibility rules as the menu.
function showShortcuts(user) {
  const links = user.isStaff
    ? [
        ["admin.html", "Faculty verification", "Grant or revoke faculty access"],
        ["sync.html", "External sync health", "Mitacs feed runs and freshness"],
        ["submissions.html", "Industry opportunities", "Every partner proposal and its supervisors"],
        ["lifecycle.html", "Terms and deadlines", "Centre deadlines and lifecycle states"],
      ]
    : user.isVerifiedFaculty
      ? [
          ["submissions.html", "Industry opportunities", "Offer to supervise partner proposals"],
          ["lifecycle.html", "Terms and deadlines", "Deadlines, renewals and withdrawals"],
          ["outcomes.html", "Your outcomes", "Record and confirm completed work"],
          ["notifications.html", "Notifications", "New proposals in your areas"],
        ]
      : [
          ["projects.html", "Discover projects", "Faculty, industry and external opportunities"],
          ["matches.html", "Matches", "Proposals from faculty to you"],
          ["external.html", "Your external opportunities", "Your private record of Mitacs and others"],
          ["student-profile.html", "Your student profile", "The name faculty and visitors see"],
        ];
  setChildren(
    $("shortcut-list"),
    ...links.map(([href, label, desc]) =>
      h("li", {}, h("a", { href }, h("span", { class: "shortcut-label", text: label }), h("span", { class: "shortcut-desc", text: desc }))),
    ),
  );
  $("shortcuts").hidden = false;
}

// R3-05: "Has faculty proposed something to me, and what do I do?" answered on arrival.
async function showWaitingMatches() {
  const note = $("matches-note");
  const res = await api("/api/matches");
  const waiting = res.ok ? res.data.matches.filter((m) => m.you.canConfirm).length : 0;
  note.hidden = waiting === 0;
  if (waiting === 0) return;
  note.textContent = waiting === 1
    ? "A faculty member has proposed a match to you. "
    : `Faculty have proposed ${waiting} matches to you. `;
  const link = document.createElement("a");
  link.href = "matches.html";
  link.textContent = "Confirm or decline";
  note.append(link);
}

// R1-05 and R1-07: the choice is explicit (nothing preselected until made) and can be changed.
function renderPublicProfileChoice(user) {
  const current = $("public-profile-current");
  const choice = user.publicProfileChoice;
  if (choice === null) {
    current.innerHTML =
      "<strong>Please choose before you publish anything.</strong> Until you do, your profile and projects stay private and can't be published.";
  } else {
    current.textContent = choice
      ? "Currently: public. Anyone can see your profile and published projects."
      : "Currently: signed-in Algoma users only.";
  }
  for (const radio of document.querySelectorAll('input[name="allow"]')) {
    radio.checked = choice !== null && radio.value === String(choice);
  }
}

async function load() {
  const session = await getSession();
  renderNav(session);
  if (session.authenticated) showSignedIn(session.user);
  else showSignedOut();
}

$("public-profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const selected = document.querySelector('input[name="allow"]:checked');
  if (!selected) {
    showStatus(statusEl, "Choose Yes or No before saving.", { error: true });
    document.querySelector('input[name="allow"]').focus();
    return;
  }
  const res = await api("/api/account/public-profile", {
    method: "PUT",
    body: { allowPublicProfile: selected.value === "true" },
  });
  if (!res.ok) {
    showStatus(statusEl, res.data.error || "Could not save your choice.", { error: true });
    return;
  }
  renderPublicProfileChoice(res.data.user);
  showStatus(statusEl, "Choice saved.");
});

$("sign-out").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  showStatus(statusEl, "You have signed out.");
  await load();
});

load();
