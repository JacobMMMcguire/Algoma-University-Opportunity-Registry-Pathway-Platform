const API = window.API_BASE_URL;
const $ = (id) => document.getElementById(id);

function showSignedIn(user) {
  $("signed-out").hidden = true;
  $("signed-in").hidden = false;
  $("who").textContent = `${user.email}${user.isStaff ? " · staff" : ""}${user.isVerifiedFaculty ? " · verified faculty" : ""}`;
}

function showSignedOut() {
  $("signed-out").hidden = false;
  $("signed-in").hidden = true;
  $("verify-form").hidden = true;
}

async function health() {
  try {
    const r = await fetch(`${API}/api/health`);
    const d = await r.json();
    $("health").textContent = d.ok ? "Backend reachable." : "Backend unhealthy.";
  } catch {
    $("health").textContent = `Cannot reach the backend at ${API}.`;
  }
}

async function loadSession() {
  try {
    const r = await fetch(`${API}/api/auth/me`, { credentials: "include" });
    const d = await r.json();
    if (d.authenticated) showSignedIn(d.user);
    else showSignedOut();
  } catch {
    $("status").textContent = "Could not check sign-in status.";
  }
}

$("request-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("status").textContent = "";
  const email = $("email").value;
  try {
    const r = await fetch(`${API}/api/auth/request-challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const d = await r.json();
    if (!r.ok) {
      $("status").textContent = d.error || "Could not request a sign-in code.";
      return;
    }
    $("verify-form").hidden = false;
    $("status").textContent = "Code requested. Look it up on the operator console.";
  } catch {
    $("status").textContent = "Could not reach the backend.";
  }
});

$("verify-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("status").textContent = "";
  const email = $("email").value;
  const code = $("code").value;
  try {
    const r = await fetch(`${API}/api/auth/verify`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    const d = await r.json();
    if (!r.ok) {
      $("status").textContent = d.error || "Could not verify that code.";
      return;
    }
    showSignedIn(d.user);
  } catch {
    $("status").textContent = "Could not reach the backend.";
  }
});

$("sign-out").addEventListener("click", async () => {
  try {
    await fetch(`${API}/api/auth/logout`, { method: "POST", credentials: "include" });
  } finally {
    showSignedOut();
  }
});

health();
loadSession();
