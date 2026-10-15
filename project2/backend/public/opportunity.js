// R2-21 to R2-23: one supervised industry project, as students see it. Partner text is set with
// textContent (R2-03). There are no partner contact details here (R2-05): Contact goes to a
// supervising faculty member's university email.
const $ = (id) => document.getElementById(id);
const statusEl = $("status");

function renderContact(opportunity, supervisor, session) {
  renderContactPanel($("contact-section"), {
    email: supervisor.contact.email,
    facultyName: supervisor.displayName,
    subject: `Student inquiry: ${opportunity.title} (industry project)`,
    body:
      `Dear ${supervisor.displayName},\n\n` +
      `I'm a student at Algoma University and I'm interested in the industry project "${opportunity.title}", ` +
      `proposed by ${opportunity.organisation}, which you're supervising.\n\n` +
      "[A sentence or two about you: your program, your year, and why this project interests you.]\n\n" +
      "Would you be open to talking about whether I could get involved?\n\n" +
      "Thank you,\n[Your name]",
    session,
  });
}

function renderOpportunity(opportunity, session) {
  document.title = `${opportunity.title} — Opportunity Registry`;
  $("opportunity-title").textContent = opportunity.title;
  $("opportunity-organisation").textContent = opportunity.organisation;
  $("opportunity-audience").hidden = opportunity.publiclyVisible;
  $("opportunity-description").textContent = opportunity.description;

  // R2-22: every supervisor this viewer may see, each linking to their profile.
  $("opportunity-supervisors").replaceChildren(
    ...opportunity.supervisors.map((s) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = `faculty.html?id=${encodeURIComponent(s.id)}`;
      link.textContent = s.displayName;
      item.append(link);
      return item;
    }),
  );

  $("opportunity-areas").replaceChildren(
    ...opportunity.researchAreas.map((area) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = `projects.html?area=${encodeURIComponent(area)}`;
      a.textContent = area;
      a.title = `Projects in ${area}`;
      li.append(a);
      return li;
    }),
  );
  $("areas-section").hidden = opportunity.researchAreas.length === 0;

  // R2-23: Contact goes to a supervising faculty member who takes inquiries; with several,
  // the student picks one.
  const contactable = opportunity.supervisors.filter((s) => s.contact);
  if (contactable.length === 0) {
    $("no-contact-text").textContent =
      opportunity.supervisors.length === 1
        ? opportunity.supervisors[0].inquiryPreference.explanation
        : "The supervising faculty aren't taking new student inquiries right now.";
    $("no-contact").hidden = false;
  } else {
    if (contactable.length > 1) {
      fillSelect(
        $("contact-faculty"),
        contactable.map((s) => ({ value: String(s.id), label: s.displayName })),
        String(contactable[0].id),
      );
      $("contact-faculty").addEventListener("change", () => {
        const chosen = contactable.find((s) => String(s.id) === $("contact-faculty").value);
        renderContact(opportunity, chosen, session);
      });
      $("contact-choice").hidden = false;
    }
    renderContact(opportunity, contactable[0], session);
  }
  $("opportunity-view").hidden = false;
}

(async () => {
  const session = await getSession();
  renderNav(session);
  const id = new URLSearchParams(location.search).get("id");
  const res = id === null ? { status: 404 } : await api(`/api/opportunities/${encodeURIComponent(id)}`);
  if (res.status === 404 || res.status === 400) {
    $("not-found-text").textContent = session.authenticated
      ? "This project doesn't exist or is no longer available."
      : "This project doesn't exist or isn't available publicly. Signing in may let you see it.";
    $("not-found").hidden = false;
    return;
  }
  if (!res.ok) return showStatus(statusEl, res.data.error || "Could not load this project.", { error: true });
  renderOpportunity(res.data.opportunity, session);
})();
