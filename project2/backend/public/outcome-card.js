// One outcome as a card, for the showcase, faculty and student profiles, and "Your outcomes".
// Load after common.js. Opportunity titles can be partner text, so this uses h() (textContent).

function outcomeKind(opportunity) {
  if (opportunity.kind !== "industry") return "Faculty project";
  return opportunity.organisation ? `Industry project · proposed by ${opportunity.organisation}` : "Industry project";
}

// Names joined with links to their profiles (R3-20: visitors can reach the people involved).
function peopleLine(label, people, href, others = 0) {
  if (people.length === 0 && others === 0) return null;
  const line = h("p", {}, h("strong", { text: `${label}: ` }));
  people.forEach((person, i) => {
    if (i > 0) line.append(", ");
    line.append(h("a", { href: href(person.id), text: person.displayName }));
  });
  if (others > 0) {
    const text = others === 1 ? "1 student who hasn't chosen public display" : `${others} students who haven't chosen public display`;
    line.append(people.length ? `, and ${text}` : text);
  }
  return line;
}

// `level` is the heading level for the title (2 on a list page, 3 under a section heading).
function outcomeCard(outcome, { level = 2, extra = [] } = {}) {
  const o = outcome.opportunity;
  return h(
    "li",
    { class: "card", "data-outcome": outcome.id },
    h("p", { class: "kind", text: [outcomeKind(o), o.term].filter(Boolean).join(" · ") }),
    h(`h${level}`, { text: o.title }),
    h("p", { class: "prewrap", text: outcome.summary }),
    h("p", { class: "hint", text: `Completed ${formatDay(outcome.completedOn)}` }),
    outcome.links.length
      ? h(
          "ul",
          { class: "tags", "aria-label": "Links" },
          // Checked on the server to be http(s), so they can't run script.
          ...outcome.links.map((l) => h("li", {}, h("a", { href: l.url, rel: "noopener noreferrer", text: l.label }))),
        )
      : null,
    peopleLine("Faculty", outcome.faculty, (id) => `faculty.html?id=${encodeURIComponent(id)}`),
    peopleLine("Students", outcome.students, (id) => `student.html?id=${encodeURIComponent(id)}`, outcome.otherStudents),
    ...extra,
  );
}
