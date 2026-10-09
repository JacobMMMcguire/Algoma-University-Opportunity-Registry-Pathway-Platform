const $ = (id) => document.getElementById(id);
const statusEl = $("status");

// Held only in this page's memory: never stored, never put in a URL.
let operatorSecret = "";

async function load() {
  showStatus(statusEl, "Loading…");
  const headers = operatorSecret ? { "X-Operator-Secret": operatorSecret } : {};
  const res = await api("/api/auth/pending-challenges", { headers });
  if (res.status === 404) {
    $("access-form").hidden = true;
    $("codes").hidden = true;
    showStatus(statusEl, "Test mode is off: sign-in codes are delivered by email only.");
    return;
  }
  if (res.status === 401 || res.status === 403) {
    $("codes").hidden = true;
    $("access-form").hidden = false;
    if (operatorSecret) {
      operatorSecret = "";
      showStatus(statusEl, "That operator access code isn't valid.", { error: true });
      $("operator-secret").focus();
    } else {
      showStatus(statusEl, "");
    }
    return;
  }
  if (!res.ok) {
    showStatus(statusEl, res.data.error || "Could not load codes.", { error: true });
    return;
  }
  $("access-form").hidden = true;
  $("codes").hidden = false;
  $("rows").innerHTML = res.data
    .map((row) => `<tr><td>${escapeHtml(row.email)}</td><td><code>${escapeHtml(row.code)}</code></td>` +
      `<td>${escapeHtml(new Date(row.expiresAt).toLocaleTimeString())}</td></tr>`)
    .join("");
  showStatus(statusEl, res.data.length === 0 ? "No unused test-account codes right now." : "");
}

$("access-form").addEventListener("submit", (event) => {
  event.preventDefault();
  operatorSecret = $("operator-secret").value.trim();
  $("operator-secret").value = "";
  if (!operatorSecret) {
    showStatus(statusEl, "Enter the operator access code.", { error: true });
    $("operator-secret").focus();
    return;
  }
  load();
});

$("refresh").addEventListener("click", load);
getSession().then(renderNav);
load();
