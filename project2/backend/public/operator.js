const API = window.API_BASE_URL;
const $ = (id) => document.getElementById(id);
const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function load() {
  $("status").textContent = "Loading…";
  try {
    const r = await fetch(`${API}/api/auth/pending-challenges`);
    if (r.status === 404) {
      $("rows").innerHTML = "";
      $("status").textContent = "Test mode is off: sign-in codes are delivered by email only.";
      return;
    }
    const rows = await r.json();
    $("rows").innerHTML = rows
      .map((row) => `<tr><td>${escapeHtml(row.email)}</td><td><code>${escapeHtml(row.code)}</code></td><td>${new Date(row.expiresAt).toLocaleTimeString()}</td></tr>`)
      .join("");
    $("status").textContent = rows.length === 0 ? "No pending codes." : "";
  } catch {
    $("status").textContent = "Could not reach the backend.";
  }
}

$("refresh").addEventListener("click", load);
load();
