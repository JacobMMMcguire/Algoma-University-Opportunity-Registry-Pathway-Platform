const $ = (id) => document.getElementById(id);
const statusEl = $("status");

function showSignedOut(session) {
  $("signed-out").hidden = false;
  $("signed-in").hidden = true;
  $("verify-form").hidden = true;
  $("request-form").hidden = false;
  $("test-mode-hint").hidden = !session.testMode;
}

function showSignedIn(user) {
  $("signed-out").hidden = true;
  $("signed-in").hidden = false;
  $("who").textContent = user.email;

  const roleNote = $("role-note");
  if (user.isStaff) {
    roleNote.innerHTML = 'You have staff access. <a href="admin.html">Manage faculty verification</a>.';
  } else if (user.isVerifiedFaculty) {
    roleNote.textContent = "Your account is verified as faculty.";
  } else {
    roleNote.textContent = "Faculty member? Ask Centre staff to verify your account to get faculty features.";
  }
  if (user.isStaff && user.isVerifiedFaculty) roleNote.append(" Your account is also verified as faculty.");

  $("public-profile").hidden = !user.isVerifiedFaculty;
  if (user.isVerifiedFaculty) renderPublicProfileChoice(user);
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
  else showSignedOut(session);
}

$("request-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = $("email").value.trim();
  if (!email) {
    showStatus(statusEl, "Enter your Algoma University email address.", { error: true });
    $("email").focus();
    return;
  }
  const res = await api("/api/auth/request-challenge", { method: "POST", body: { email } });
  if (!res.ok) {
    showStatus(statusEl, res.data.error || "Could not send a sign-in code.", { error: true });
    $("email").focus();
    return;
  }
  $("code-email").textContent = email;
  $("request-form").hidden = true;
  $("verify-form").hidden = false;
  $("code").value = "";
  $("code").focus();
  showStatus(
    statusEl,
    res.data.emailSent
      ? "Check your email for a 6-digit code. It can take a minute to arrive; check junk mail too."
      : "Code created. Look it up on the operator console.",
  );
});

$("verify-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = $("code").value.trim();
  if (!/^\d{6}$/.test(code)) {
    showStatus(statusEl, "Enter the 6-digit code from your email.", { error: true });
    $("code").focus();
    return;
  }
  const res = await api("/api/auth/verify", { method: "POST", body: { email: $("email").value.trim(), code } });
  if (!res.ok) {
    showStatus(statusEl, res.data.error || "Could not verify that code.", { error: true });
    $("code").focus();
    return;
  }
  showStatus(statusEl, "");
  await load();
  $("account-heading").focus();
});

$("restart").addEventListener("click", () => {
  $("verify-form").hidden = true;
  $("request-form").hidden = false;
  showStatus(statusEl, "");
  $("email").focus();
});

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

$("account-heading").tabIndex = -1;
load();
