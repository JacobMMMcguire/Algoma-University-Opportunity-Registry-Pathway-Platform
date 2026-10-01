// Fixed vocabularies shared by forms, validation, filters and the fixture. Fixed lists keep
// filtering consistent (R1-20): the same area or level is always spelled the same way.

// Covers Algoma University's programs plus the R1 fixture's areas (which must stay spelled
// exactly as they are here). Add new areas to the right group; never rename an existing one,
// since stored profiles and projects refer to areas by name.
const RESEARCH_AREA_GROUPS = [
  {
    group: "Computing and technology",
    areas: [
      "Artificial Intelligence",
      "Computer Graphics and Game Development",
      "Computer Networks and Distributed Systems",
      "Cybersecurity",
      "Data Science",
      "Human-Computer Interaction",
      "Software Engineering",
      "Theoretical Computer Science",
    ],
  },
  {
    group: "Mathematics and statistics",
    areas: ["Applied Mathematics", "Mathematics", "Statistics"],
  },
  {
    group: "Natural and environmental sciences",
    areas: [
      "Biology",
      "Chemistry",
      "Climate Change",
      "Ecology",
      "Environmental Science",
      "Forestry and Natural Resources",
      "Freshwater and Great Lakes Science",
      "Geographic Information Systems",
      "Physics",
    ],
  },
  {
    group: "Health and psychology",
    areas: [
      "Clinical and Counselling Psychology",
      "Cognitive Science",
      "Health and Wellness",
      "Neuroscience",
      "Psychology",
      "Public Health",
    ],
  },
  {
    group: "Social sciences",
    areas: [
      "Community Economic and Social Development",
      "Criminology",
      "Economics",
      "Geography",
      "Law and Justice",
      "Political Science",
      "Public Policy",
      "Social Work",
      "Sociology",
    ],
  },
  {
    group: "Indigenous studies",
    areas: [
      "Anishinaabe Studies",
      "Indigenous Knowledge and Land-Based Learning",
      "Indigenous Languages",
      "Residential School History and Reconciliation",
    ],
  },
  {
    group: "Business",
    areas: [
      "Accounting",
      "Business Analytics",
      "Entrepreneurship and Innovation",
      "Finance",
      "Human Resources Management",
      "Management and Organizational Behaviour",
      "Marketing",
    ],
  },
  {
    group: "Humanities",
    areas: [
      "Communication and Media Studies",
      "English Literature",
      "History",
      "Languages and Linguistics",
      "Philosophy",
    ],
  },
  {
    group: "Arts",
    areas: ["Digital Media and Design", "Music", "Performing Arts", "Visual Arts"],
  },
  {
    group: "Education and interdisciplinary",
    areas: ["Community-Engaged Research", "Education", "Northern and Rural Studies", "Sustainability"],
  },
];

const RESEARCH_AREAS = RESEARCH_AREA_GROUPS.flatMap((g) => g.areas);
const AREA_BY_LOWERCASE = new Map(RESEARCH_AREAS.map((area) => [area.toLowerCase(), area]));

// The canonical spelling of an area, or null if it isn't on the list.
function canonicalArea(value) {
  return typeof value === "string" ? AREA_BY_LOWERCASE.get(value.trim().replace(/\s+/g, " ").toLowerCase()) || null : null;
}

// R1-11 "intended student level where relevant": one of these, or none.
const STUDENT_LEVELS = ["Undergraduate", "Graduate", "Undergraduate or Graduate"];

// R1-20: the level filter asks "is this project open to undergraduates / graduate students?",
// so "Undergraduate or Graduate" projects match both.
const LEVEL_FILTERS = [
  { value: "undergraduate", label: "Undergraduate students", matches: ["Undergraduate", "Undergraduate or Graduate"] },
  { value: "graduate", label: "Graduate students", matches: ["Graduate", "Undergraduate or Graduate"] },
];

// Target terms are "<Season> <Year>", e.g. "Winter 2027", in academic-calendar order.
const TERM_SEASONS = ["Winter", "Spring", "Summer", "Fall"];
const TERM_PATTERN = /^(Winter|Spring|Summer|Fall) (\d{4})$/;

// "winter  2027" -> "Winter 2027"; null unless it is a season and a year from 2000 to 2100.
function canonicalTerm(value) {
  if (typeof value !== "string") return null;
  const match = /^(winter|spring|summer|fall) (\d{4})$/i.exec(value.trim().replace(/\s+/g, " "));
  if (!match || Number(match[2]) < 2000 || Number(match[2]) > 2100) return null;
  return `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()} ${match[2]}`;
}

// The years offered in the term picker: this year and the next three.
function termYears(now = new Date()) {
  const year = now.getFullYear();
  return [year, year + 1, year + 2, year + 3];
}

// R1-09: the stored codes are internal. Students only ever see the label and explanation.
const INQUIRY_PREFERENCES = [
  {
    value: "open",
    label: "Open to general student inquiries",
    explanation: "Students are welcome to email about this faculty member's research, including ideas that aren't listed as projects.",
  },
  {
    value: "projects_only",
    label: "Inquiries about listed projects only",
    explanation: "Please get in touch only about the projects listed for this faculty member.",
  },
  {
    value: "not_accepting",
    label: "Not currently accepting new inquiries",
    explanation: "This faculty member isn't taking new student inquiries right now.",
  },
];

function describeInquiryPreference(code) {
  const option = INQUIRY_PREFERENCES.find((o) => o.value === code) || INQUIRY_PREFERENCES.at(-1);
  return { label: option.label, explanation: option.explanation };
}

// Sorts terms chronologically; anything not in "<Season> <Year>" form goes last, alphabetically.
function compareTerms(a, b) {
  const key = (term) => {
    const match = TERM_PATTERN.exec(term);
    return match ? Number(match[2]) * 10 + TERM_SEASONS.indexOf(match[1]) : Infinity;
  };
  return key(a) - key(b) || a.localeCompare(b);
}

module.exports = {
  RESEARCH_AREA_GROUPS,
  RESEARCH_AREAS,
  canonicalArea,
  STUDENT_LEVELS,
  LEVEL_FILTERS,
  TERM_SEASONS,
  canonicalTerm,
  termYears,
  compareTerms,
  INQUIRY_PREFERENCES,
  describeInquiryPreference,
};
