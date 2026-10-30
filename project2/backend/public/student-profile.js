// R3_PLAN.md D5: a student's display name (shown on matches) and their public-display choice.
const $ = (id) => document.getElementById(id);
const statusEl = $("status");

function fill(profile) {
  $("displayName").value = profile?.displayName || "";
  for (const radio of document.querySelectorAll('input[name="allow"]')) {
    radio.checked = profile !== null && profile.publicProfileChoice !== null && radio.value === String(profile.publicProfileChoice);
  }
}

$("profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const selected = document.querySelector('input[name="allow"]:checked');
  const res = await api("/api/account/student-profile", {
    method: "PUT",
    body: { displayName: $("displayName").value, allowPublicProfile: selected ? selected.value === "true" : null },
  });
  if (!res.ok) {
    showStatus(statusEl, res.data.error || "Could not save your profile.", { error: true });
    if (res.data.field === "allowPublicProfile") document.querySelector('input[name="allow"]').focus();
    else $("displayName").focus();
    return;
  }
  fill(res.data.profile);
  showStatus(statusEl, "Profile saved.");
});

(async () => {
  const session = await getSession();
  renderNav(session);
  const denied = $("denied");
  if (!session.authenticated) {
    denied.innerHTML = 'Please <a href="index.html">sign in</a> first.';
    denied.hidden = false;
    return;
  }
  const res = await api("/api/account/student-profile");
  if (res.status === 403) {
    denied.innerHTML = 'Verified faculty use their <a href="profile.html">faculty profile</a> instead.';
    denied.hidden = false;
    return;
  }
  if (!res.ok) return showStatus(statusEl, res.data.error || "Could not load your profile.", { error: true });
  fill(res.data.profile);
  $("profile-form").hidden = false;
})();
