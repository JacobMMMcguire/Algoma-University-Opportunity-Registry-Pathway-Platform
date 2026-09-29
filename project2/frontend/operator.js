const API = window.API_BASE_URL;
const $ = (id) => document.getElementById(id);

async function load() {
  $("status").textContent = "Loading…";
  try {
    const r = await fetch(`${API}/api/auth/pending-challenges`);
    const rows = await r.json();
    $("rows").innerHTML = rows
      .map((row) => `<tr><td>${row.email}</td><td><code>${row.code}</code></td><td>${new Date(row.expiresAt).toLocaleTimeString()}</td></tr>`)
      .join("");
    $("status").textContent = rows.length === 0 ? "No pending codes." : "";
  } catch {
    $("status").textContent = "Could not reach the backend.";
  }
}

$("refresh").addEventListener("click", load);
load();
