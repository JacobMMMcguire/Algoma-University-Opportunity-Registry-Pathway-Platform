// R3-20: the public showcase of confirmed, consented outcomes.
(async () => {
  const session = await getSession();
  renderNav(session);
  const res = await api("/api/outcomes/showcase");
  if (!res.ok) return showStatus(document.getElementById("status"), res.data.error || "Could not load completed work.", { error: true });
  const { outcomes } = res.data;
  document.getElementById("result-count").textContent =
    outcomes.length === 1 ? "1 completed project" : `${outcomes.length} completed projects`;
  document.getElementById("outcomes").replaceChildren(
    ...(outcomes.length ? outcomes.map((o) => outcomeCard(o)) : [h("li", { text: "Nothing has been shared here yet." })]),
  );
})();
