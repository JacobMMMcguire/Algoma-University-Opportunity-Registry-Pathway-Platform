// R3-17, R3-18, R3-20: a student's profile and the confirmed outcomes they chose to show on it.
(async () => {
  const session = await getSession();
  renderNav(session);
  const id = new URLSearchParams(location.search).get("id") || "";
  const res = await api(`/api/students/${encodeURIComponent(id)}`);
  if (!res.ok) {
    document.getElementById("not-found-text").textContent = session.authenticated
      ? "This student profile doesn't exist."
      : "This student profile doesn't exist or isn't shown publicly. Signing in may let you see it.";
    document.getElementById("not-found").hidden = false;
    return;
  }
  const { student } = res.data;
  document.title = `${student.displayName} — Opportunity Registry`;
  document.getElementById("student-name").textContent = student.displayName;
  document.getElementById("audience").hidden = student.publiclyVisible;
  const work = await api(`/api/outcomes/showcase?studentId=${encodeURIComponent(student.id)}`);
  const outcomes = work.ok ? work.data.outcomes : [];
  document.getElementById("outcomes").replaceChildren(
    ...(outcomes.length ? outcomes.map((o) => outcomeCard(o, { level: 3 })) : [h("li", { text: "No completed work shown yet." })]),
  );
  document.getElementById("profile-view").hidden = false;
})();
