const $ = (id) => document.getElementById(id);
const statusEl = $("status");

function roleLabel(user) {
  const roles = [];
  if (user.isStaff) roles.push("Staff");
  if (user.isVerifiedFaculty) roles.push("Verified faculty");
  return roles.length ? roles.join(", ") : "Signed-in user";
}

function renderRows(users) {
  $("rows").innerHTML = users
    .map((user) => {
      const action = user.isVerifiedFaculty ? "revoke" : "grant";
      const label = user.isVerifiedFaculty ? "Revoke faculty" : "Grant faculty";
      return `<tr>
        <td>${escapeHtml(user.email)}</td>
        <td>${escapeHtml(roleLabel(user))}</td>
        <td><button type="button" data-id="${user.id}" data-action="${action}"
          aria-label="${label}: ${escapeHtml(user.email)}">${label}</button></td>
      </tr>`;
    })
    .join("");
}

async function loadUsers() {
  const res = await api("/api/admin/users");
  if (!res.ok) {
    showStatus(statusEl, res.data.error || "Could not load users.", { error: true });
    return;
  }
  renderRows(res.data);
}

$("rows").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { id, action } = button.dataset;
  const email = button.closest("tr").cells[0].textContent;
  if (action === "revoke" && !confirm(`Revoke verified-faculty status for ${email}? Their account is kept.`)) return;

  button.disabled = true;
  const path = action === "grant" ? "verify-faculty" : "revoke-faculty";
  const res = await api(`/api/admin/users/${id}/${path}`, { method: "POST" });
  if (!res.ok) {
    showStatus(statusEl, res.data.error || "Could not update that user.", { error: true });
    button.disabled = false;
    return;
  }
  showStatus(statusEl, `${email} is ${action === "grant" ? "now verified faculty" : "no longer verified faculty"}.`);
  await loadUsers();
  $("rows").querySelector(`button[data-id="${id}"]`)?.focus();
});

(async () => {
  const session = await getSession();
  renderNav(session);
  if (!session.authenticated) {
    $("denied").innerHTML = 'Please <a href="index.html">sign in</a> first.';
    $("denied").hidden = false;
  } else if (!session.user.isStaff) {
    $("denied").textContent = "Staff access is required to view this page.";
    $("denied").hidden = false;
  } else {
    $("panel").hidden = false;
    await loadUsers();
  }
})();
