// R2-18: the in-product notification list. Partner text is set with textContent (R2-03).
const $ = (id) => document.getElementById(id);
const statusEl = $("status");

function formatDate(value) {
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

(async () => {
  const session = await getSession();
  renderNav(session);
  if (!session.authenticated) {
    $("denied").innerHTML = 'Please <a href="index.html">sign in</a> first.';
    $("denied").hidden = false;
    return;
  }
  if (!session.user.isVerifiedFaculty) {
    $("denied").textContent = "Notifications are for verified faculty.";
    $("denied").hidden = false;
    return;
  }

  const res = await api("/api/notifications");
  if (!res.ok) return showStatus(statusEl, res.data.error || "Could not load your notifications.", { error: true });
  const { notifications } = res.data;
  $("notification-list").replaceChildren(
    ...notifications.map((n) => {
      const heading = el("h2");
      const link = el("a", n.opportunity.title);
      link.href = `submissions.html?id=${encodeURIComponent(n.opportunity.id)}`;
      heading.append(link);
      const card = el("li", undefined, "card");
      card.append(
        heading,
        el("p", `New industry opportunity from ${n.opportunity.organisation} · ${formatDate(n.createdAt)}`),
        el("p", n.opportunity.researchAreas.join(" · ") || "No areas chosen", "hint"),
      );
      return card;
    }),
  );
  $("result-count").textContent =
    notifications.length === 0
      ? "No notifications yet."
      : `${notifications.length} notification${notifications.length === 1 ? "" : "s"}.`;
  $("panel").hidden = false;
})();
