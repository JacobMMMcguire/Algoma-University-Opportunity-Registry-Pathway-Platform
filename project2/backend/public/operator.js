const $ = (id) => document.getElementById(id);
const statusEl = $("status");

async function load() {
  showStatus(statusEl, "Loading…");
  const res = await api("/api/auth/pending-challenges");
  if (res.status === 404) {
    $("rows").innerHTML = "";
    showStatus(statusEl, "Test mode is off: sign-in codes are delivered by email only.");
    return;
  }
  if (!res.ok) {
    showStatus(statusEl, res.data.error || "Could not load codes.", { error: true });
    return;
  }
  $("rows").innerHTML = res.data
    .map((row) => `<tr><td>${escapeHtml(row.email)}</td><td><code>${escapeHtml(row.code)}</code></td>` +
      `<td>${escapeHtml(new Date(row.expiresAt).toLocaleTimeString())}</td></tr>`)
    .join("");
  showStatus(statusEl, res.data.length === 0 ? "No unused codes right now." : "");
}

$("refresh").addEventListener("click", load);
getSession().then(renderNav);
load();
