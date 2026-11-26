const $ = (id) => document.getElementById(id);
const statusEl = $("status");

const DEPARTURE_LABELS = { left: "Left Algoma", graduated: "Graduated" };

function roleLabel(user) {
  const roles = [];
  if (user.isStaff) roles.push("Staff");
  if (user.isVerifiedFaculty) roles.push("Verified faculty");
  if (!roles.length) roles.push("Signed-in user");
  if (user.departure) roles.push(DEPARTURE_LABELS[user.departure]);
  return roles.join(", ");
}

// F-09, F-10: recording that someone has left keeps their account and work, and stops them being
// offered to students. It can be taken back.
function departureButton(user) {
  let action;
  let label;
  if (user.departure) [action, label] = ["return", "Undo: still at Algoma"];
  else if (user.isVerifiedFaculty) [action, label] = ["left", "Record as left Algoma"];
  else if (!user.isStaff) [action, label] = ["graduated", "Record as graduated"];
  else return "";
  return `<button type="button" data-id="${user.id}" data-action="${action}"
    aria-label="${label}: ${escapeHtml(user.email)}">${label}</button>`;
}

function renderRows(users) {
  $("rows").innerHTML = users
    .map((user) => {
      const action = user.isVerifiedFaculty ? "revoke" : "grant";
      const label = user.isVerifiedFaculty ? "Revoke faculty" : "Grant faculty";
      return `<tr>
        <td>${escapeHtml(user.email)}</td>
        <td>${escapeHtml(roleLabel(user))}</td>
        <td class="actions"><button type="button" data-id="${user.id}" data-action="${action}"
          aria-label="${label}: ${escapeHtml(user.email)}">${label}</button>${departureButton(user)}</td>
      </tr>`;
    })
    .join("");
}

// F-19: 20 at a time, newest first, searchable by email. After a change the rows already shown
// are reloaded (up to 50), so the person just changed stays on screen.
let shownUsers = [];
let search = "";

async function loadUsers({ offset = 0, keep = false } = {}) {
  const limit = keep ? Math.min(Math.max(shownUsers.length, 20), 50) : 20;
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (search) params.set("q", search);
  const res = await api(`/api/admin/users?${params}`);
  if (!res.ok) {
    showStatus(statusEl, res.data.error || "Could not load users.", { error: true });
    return;
  }
  const first = offset ? shownUsers.length : 0;
  shownUsers = offset ? [...shownUsers, ...res.data.users] : res.data.users;
  renderRows(shownUsers);
  $("result-count").textContent = res.data.total === 0 ? "No one matches that search." : "";
  if (offset) $("rows").rows[first]?.querySelector("button")?.focus();
  showMoreButton($("show-more"), $("shown-count"), shownUsers.length, res.data, (next) => loadUsers({ offset: next }));
}

$("search").addEventListener("submit", (event) => {
  event.preventDefault();
  search = $("search-q").value.trim();
  loadUsers();
});

$("rows").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { id, action } = button.dataset;
  const email = button.closest("tr").cells[0].textContent;
  if (action === "revoke" && !confirm(`Revoke verified-faculty status for ${email}? Their account is kept.`)) return;
  if (["left", "graduated", "return"].includes(action)) return recordDeparture(button, id, action, email);

  button.disabled = true;
  const path = action === "grant" ? "verify-faculty" : "revoke-faculty";
  const res = await api(`/api/admin/users/${id}/${path}`, { method: "POST" });
  if (!res.ok) {
    showStatus(statusEl, res.data.error || "Could not update that user.", { error: true });
    button.disabled = false;
    return;
  }
  showStatus(statusEl, `${email} is ${action === "grant" ? "now verified faculty" : "no longer verified faculty"}.`);
  await loadUsers({ keep: true });
  $("rows").querySelector(`button[data-id="${id}"]`)?.focus();
});

const DEPARTURE_QUESTIONS = {
  left: (email) =>
    `Record ${email} as having left Algoma? Their profile will say so and they won't be offered to students or act as faculty. Their past work is kept, and any opportunity only they managed will need a new supervisor.`,
  graduated: (email) => `Record ${email} as graduated? Their profile will show them as an alumnus and they won't be proposed new matches. Their past work is kept.`,
  return: (email) => `Record ${email} as still at Algoma?`,
};
const DEPARTURE_DONE = {
  left: "is recorded as having left Algoma",
  graduated: "is recorded as graduated",
  return: "is recorded as still at Algoma",
};

async function recordDeparture(button, id, action, email) {
  if (!confirm(DEPARTURE_QUESTIONS[action](email))) return;
  button.disabled = true;
  const res = await api(`/api/admin/users/${id}/departure`, { method: "POST", body: { departure: action === "return" ? null : action } });
  if (!res.ok) {
    showStatus(statusEl, res.data.error || "Could not update that user.", { error: true });
    button.disabled = false;
    return;
  }
  showStatus(statusEl, `${email} ${DEPARTURE_DONE[action]}.`);
  await loadUsers({ keep: true });
  $("rows").querySelector(`button[data-id="${id}"]`)?.focus();
}

(async () => {
  const session = await getSession();
  renderNav(session);
  if (!session.authenticated) {
    $("denied").innerHTML = 'Please <a href="signin.html">sign in</a> first.';
    $("denied").hidden = false;
  } else if (!session.user.isStaff) {
    $("denied").textContent = "Staff access is required to view this page.";
    $("denied").hidden = false;
  } else {
    $("panel").hidden = false;
    await loadUsers();
  }
})();
