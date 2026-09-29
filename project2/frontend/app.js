const API = window.API_BASE_URL;
const $ = (id) => document.getElementById(id);

async function health() {
  try {
    const r = await fetch(`${API}/api/health`);
    const d = await r.json();
    $("health").textContent = d.ok ? "Backend reachable." : "Backend unhealthy.";
  } catch {
    $("health").textContent = `Cannot reach the backend at ${API}.`;
  }
}

health();
