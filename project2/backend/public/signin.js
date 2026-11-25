// R1-01 to R1-03: the two sign-in steps, on a page of their own (no site menu).
const $ = (id) => document.getElementById(id);
const statusEl = $("status");

// Where to go after signing in: ?next=<page>.html on this site, or the home page. Only a bare page
// name is accepted, so the link can't send anyone to another site.
function nextPage() {
  const next = new URLSearchParams(location.search).get("next") || "";
  return /^[a-z0-9-]+\.html(\?[^#]*)?$/i.test(next) ? next : "index.html";
}

function showStep(step) {
  $("request-step").hidden = step !== "request";
  $("verify-step").hidden = step !== "verify";
  $("already").hidden = step !== "already";
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
  $("code").value = "";
  showStep("verify");
  $("code").focus();
  showStatus(
    statusEl,
    res.data.emailSent
      ? "Check your email for a 6-digit code. It can take a minute to arrive; check junk mail too."
      : "This is a test account: an authorised tester can read its code on the operator console.",
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
  location.href = nextPage();
});

$("restart").addEventListener("click", () => {
  showStep("request");
  showStatus(statusEl, "");
  $("email").focus();
});

(async () => {
  const session = await getSession();
  renderNav(session);
  $("test-mode-hint").hidden = !session.testMode;
  if (session.authenticated) {
    $("already-email").textContent = session.user.email;
    showStep("already");
  } else {
    showStep("request");
  }
})();
