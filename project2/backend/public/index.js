const $ = (id) => document.getElementById(id);
const statusEl = $("status");

// Visitors see the landing page; signing in happens on signin.html.
function showSignedOut() {
  $("signed-out").hidden = false;
  $("signed-in").hidden = true;
  showLanding();
}

// "Open now" and the research-area tiles, from the same public lists Discover uses, so they never
// show anything a visitor couldn't already find there. Titles and partner names stay text (h()).
async function showLanding() {
  const [projects, industry, external] = await Promise.all([
    api("/api/projects"),
    api("/api/opportunities"),
    api("/api/external-opportunities"),
  ]);
  const byTitle = (a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase());
  const local = [
    ...(projects.ok ? projects.data.projects : []).map((p) => ({
      title: p.title,
      href: `projects.html?id=${encodeURIComponent(p.id)}`,
      line: ["Faculty project", p.faculty.displayName, p.targetTerm].filter(Boolean).join(" · "),
      areas: p.researchAreas,
    })),
    ...(industry.ok ? industry.data.opportunities : []).map((o) => ({
      title: o.title,
      href: `opportunity.html?id=${encodeURIComponent(o.id)}`,
      line: `Industry project · ${o.organisation}`,
      areas: o.researchAreas,
    })),
  ].sort(byTitle);
  const externals = (external.ok ? external.data.opportunities : [])
    .map((o) => ({
      title: o.title,
      href: `external.html?id=${encodeURIComponent(o.id)}`,
      line: `External · ${o.wording.ownership}`,
      external: true,
      areas: o.researchAreas,
    }))
    .sort(byTitle);
  const all = [...local, ...externals];
  if (!all.length) return;

  const openNow = [...local.slice(0, externals.length ? 2 : 3), ...externals.slice(0, 1)].slice(0, 3);
  setChildren(
    $("open-now-list"),
    ...openNow.map((item) =>
      h("li", {}, h("a", { href: item.href, text: item.title }), h("p", { class: item.external ? "external-line" : "", text: item.line })),
    ),
  );
  $("see-all").textContent = all.length === 1 ? "See the 1 project" : `See all ${all.length} projects`;
  $("open-now").hidden = false;

  const counts = new Map();
  for (const item of all) for (const area of item.areas) counts.set(area, (counts.get(area) || 0) + 1);
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
