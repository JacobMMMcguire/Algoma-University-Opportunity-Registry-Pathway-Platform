// The guided tour: one walk through the whole platform, in four chapters (visitor, student, faculty,
// staff). common.js loads this on every page with the site navigation.
//
// - It is offered once per build and per person (TOUR_VERSION), and "Take the tour" in the menu
//   always starts it.
// - On a local presentation build (`npm run dev:local`), the server says `demoTour` and the tour
//   switches the browser between the chapters' fixture accounts itself (src/routes/demo.js).
//   Anywhere else, a step for a role you don't have is shown as a description, without leaving
//   the page, so the tour never sends anyone to a page they can't use.
// - The card is non-modal: you can use the page while it is open. Esc ends the tour, and focus
//   moves to each step's title so screen readers announce it.
// - Everything is built with h() and textContent; there is no raw HTML here.

const TOUR_VERSION = "final-1";
const TOUR_STATE_KEY = "tour.state";

const TOUR_CHAPTERS = {
  visitor: { title: "Visitor", who: "anyone, without signing in", account: null },
  student: { title: "Student", who: "S01, a student", account: "S01" },
  faculty: { title: "Faculty", who: "Dr. Jordan Lee (F-JORDAN), verified faculty", account: "F-JORDAN" },
  staff: { title: "Centre staff", who: "the test staff account", account: "test staff" },
};

// Finds a record to show on a detail page, through the same routes the pages use.
async function tourFirst(path, key, pick = () => true) {
  const res = await api(path);
  const list = (res.ok && res.data[key]) || [];
  return list.find(pick) || list[0] || null;
}

const TOUR_STEPS = [
  // Chapter 1: visitor
  {
    role: "visitor",
    page: "index.html",
    title: "Welcome to the Opportunity Registry",
    body:
      "One place where Algoma students find research and industry projects, faculty supervise them, and the Centre keeps it all running. " +
      "This tour walks through it the way each kind of person uses it: a visitor, a student, faculty, then Centre staff.",
  },
  {
    role: "visitor",
    page: "index.html",
    target: "#open-now",
    title: "Open now, without an account",
    body:
      "Anyone can browse. Only opportunities that are open today appear here: expired, withdrawn, matched or completed ones leave discovery on their own, and their links explain why.",
  },
  {
    role: "visitor",
    page: "projects.html",
    target: "#filters",
    title: "One discovery list for everything",
    body:
      "Faculty projects, industry projects proposed by outside organisations, and externally owned opportunities (Mitacs) are listed together. " +
      "Filter by research area, level, term or type; filters stay in the address, so a filtered list can be shared.",
  },
  {
    role: "visitor",
    page: "projects.html",
    target: "#project-list",
    title: "Each card says what it is",
    body:
      "Every card is labelled Faculty project, Industry project (with the organisation) or External. Results come 20 at a time with “Show more”, so the page stays quick on a phone.",
  },
  {
    role: "visitor",
    page: "faculty.html",
    target: "#faculty-list",
    title: "The faculty directory follows consent",
    body:
      "Visitors only see faculty who chose public display. Faculty who leave Algoma drop out of the directory, but their completed work keeps its record and attribution.",
  },
  {
    role: "visitor",
    page: "showcase.html",
    target: "#outcomes",
    title: "Completed work",
    body:
      "Finished projects appear here only once a verified faculty participant confirms them, and only while everyone named has agreed to be public. Withdrawing consent removes them at once.",
  },
  {
    role: "visitor",
    page: "partner.html",
    target: "#intake-form",
    title: "Organisations propose projects, no account needed",
    body:
      "A company or community group describes its project here. Nothing becomes visible to students until a verified faculty member agrees to supervise it, and the partner's contact details are never public.",
  },

  // Chapter 2: student
  {
    role: "student",
    page: "index.html",
    target: "#account-heading",
    title: "A student's home page",
    body:
      "Students sign in with a one-time code sent to their @algomau.ca address; there are no passwords. Their home page points them to proposals waiting for an answer and their own work.",
  },
  {
    role: "student",
    resolve: async () => {
      // A faculty member open to general inquiries, so the contact panel is there to show.
      const person = await tourFirst("/api/faculty", "faculty", (f) => f.displayName === "Dr. Jordan Lee");
      return person ? `faculty.html?id=${encodeURIComponent(person.id)}` : "faculty.html";
    },
    page: "faculty.html",
    target: "#contact-section, #contact-via-projects",
    title: "Contacting faculty",
    body:
      "Contact appears only where the faculty member invites it, on their profile or on a project, and never for someone not accepting inquiries. " +
      "The registry drafts a message the student can edit and opens it in their own Gmail; the site never sends mail for them.",
  },
  {
    role: "student",
    page: "matches.html",
    target: "#student-section",
    title: "Matches need both sides",
    body:
      "Faculty propose a match; it holds only when every student named confirms it. Students can decline, and either side can undo a confirmation made by mistake. A match is never called approval, enrolment or credit.",
  },
  {
    role: "student",
    page: "outcomes.html",
    target: "#outcomes",
    title: "Outcomes",
    body:
      "When a project ends, any participant records what came of it. Faculty confirm it, and each student chooses whether it shows on their own public profile.",
  },
  {
    role: "student",
    resolve: async () => {
      const record = await tourFirst("/api/external-opportunities", "opportunities");
      return record ? `external.html?id=${encodeURIComponent(record.id)}` : "projects.html?type=external";
    },
    page: "external.html",
    target: "#external-apply",
    title: "External opportunities stay theirs",
    body:
      "Mitacs owns these. The registry copies them from Mitacs's feed, says so, warns when the copy may be out of date, and sends students to Mitacs to apply. Students can still keep a private note of where they are with it.",
  },

  // Chapter 3: faculty
  {
    role: "faculty",
    page: "index.html",
    target: "#todo",
    title: "Waiting on you",
    body:
      "Faculty land on what needs them: partner proposals still without a supervisor, matches waiting on students, drafts, and projects whose deadline has passed.",
  },
  {
    role: "faculty",
    page: "my-projects.html",
    target: "#project-list",
    title: "Your projects",
    body:
      "Projects start as drafts. Publishing needs a faculty profile and a public-display choice (either answer is fine). Close, reopen or take a project back to draft at any time; nothing is ever deleted.",
  },
  {
    role: "faculty",
    resolve: async () => {
      const submission = await tourFirst("/api/partner-submissions", "submissions", (s) => s.supervisorCount === 0);
      return submission ? `submissions.html?id=${encodeURIComponent(submission.id)}` : "submissions.html";
    },
    page: "submissions.html",
    target: "#supervisors-heading",
    title: "The publication gate",
    body:
      "An industry proposal reaches students only once a verified faculty member says they are willing to supervise it. Any number of faculty can; the engagement state below is shared and records who changed it.",
  },
  {
    role: "faculty",
    page: "matches.html",
    target: "#faculty-section",
    title: "Proposing matches",
    body:
      "From here faculty propose a match on an opportunity they manage, see each student's answer, withdraw a match, or undo a student's confirmation when it was a mistake.",
  },
  {
    role: "faculty",
    page: "lifecycle.html",
    target: "#items",
    title: "Terms and deadlines",
    body:
      "Each opportunity runs for a term. Set its deadline, withdraw, complete, renew for a later term or reopen it. Every change keeps the same record and adds to its history.",
  },
  {
    role: "faculty",
    page: "notifications.html",
    target: "#panel",
    title: "Notifications",
    body:
      "Faculty choose which new partner proposals they hear about, by research area or all of them. A failed notification never loses the proposal; staff can retry it.",
  },

  // Chapter 4: staff
  {
    role: "staff",
    page: "admin.html",
    target: "#panel",
    title: "Faculty verification",
    body:
      "Only Centre staff grant or revoke faculty status, and it applies on the very next request. When someone leaves or graduates, staff record it here instead of deleting anyone.",
  },
  {
    role: "staff",
    page: "operations.html",
    target: "#summary",
    title: "Operations at a glance",
    body:
      "Database and sync health, stale external data and failed notifications, in plain words, with nothing secret in them.",
  },
  {
    role: "staff",
    page: "operations.html",
    target: "#lifecycle-list",
    title: "Opportunities that need a supervisor",
    body:
      "When a faculty member leaves, their open opportunities come off discovery with a plain reason. Staff reassign each one on Terms and deadlines to a faculty member who has agreed.",
  },
  {
    role: "staff",
    page: "operations.html",
    target: "#history-list",
    title: "Who changed what",
    body:
      "Verifications, consent, publishing, matches, outcomes and corrections are recorded with who made them and the value before and after, so mistakes can be traced and put right.",
  },
  {
    role: "staff",
    page: "sync.html",
    target: "#sources",
    title: "External sync health",
    body:
      "Staff run the Mitacs sync and see each run: what was new, changed, withdrawn or malformed. A failed run keeps the last good data and tells students it may be out of date.",
  },
  {
    role: "staff",
    page: "index.html",
    title: "That's the tour",
    body:
      "That's the whole journey, from a visitor browsing to the Centre keeping it running. Reopen it any time from “Take the tour” in the menu.",
    last: true,
  },
];

// --- State (browser storage can be unavailable, so every access is guarded) ---

function tourRead(storage, key) {
  try {
    return JSON.parse(storage.getItem(key));
  } catch {
    return null;
  }
}

function tourWrite(storage, key, value) {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch {
    // Without storage the tour still works on this page; it just can't follow you to the next.
  }
}

function tourRole(session) {
  if (!session.authenticated) return "visitor";
  if (session.user.isStaff) return "staff";
  if (session.user.isVerifiedFaculty) return "faculty";
  return "student";
}

function tourSeenKey(session) {
  return `tour.seen.${TOUR_VERSION}.${session.authenticated ? session.user.id : "visitor"}`;
}

function tourOnPage(page) {
  return currentPage() === page;
}

// --- Rendering ---

function tourClearTarget() {
  for (const el of document.querySelectorAll(".tour-target")) el.classList.remove("tour-target");
}

function tourClose() {
  tourClearTarget();
  document.getElementById("tour-card")?.remove();
  document.body.classList.remove("tour-open");
  document.removeEventListener("keydown", tourEscape);
}

function tourEscape(event) {
  if (event.key === "Escape" && document.getElementById("tour-card")) {
    tourWrite(sessionStorage, TOUR_STATE_KEY, null);
    tourClose();
  }
}

// Shows the card: { kicker, title, body, buttons: [{ label, primary, onClick }] }.
function tourCard({ kicker, title, body, buttons }) {
  tourClose();
  const heading = h("h2", { id: "tour-title", tabIndex: -1, text: title });
  const card = h(
    "div",
    { id: "tour-card", class: "tour-card", role: "dialog", "aria-modal": "false", "aria-labelledby": "tour-title", "aria-describedby": "tour-body" },
    kicker ? h("p", { class: "tour-kicker", text: kicker }) : null,
    heading,
    h("p", { id: "tour-body", text: body }),
    h(
      "div",
      { class: "tour-actions" },
      ...buttons.map((b) => {
        const button = h("button", { type: "button", class: b.primary ? "primary" : "", text: b.label });
        button.addEventListener("click", b.onClick);
        return button;
      }),
    ),
  );
  document.body.append(card);
  document.body.classList.add("tour-open");
  document.addEventListener("keydown", tourEscape);
  heading.focus({ preventScroll: true });
}

// Waits for a page to finish rendering its target (most sections load their data first). A list of
// selectors means the first one that is showing, e.g. a contact panel or the note that replaces it.
async function tourWaitFor(selector, timeout = 5000) {
  const visible = (el) => el && !el.closest("[hidden]") && el.getClientRects().length > 0;
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const el = [...document.querySelectorAll(selector)].find(visible);
    if (el) return el;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

function tourHighlight(el) {
  el.classList.add("tour-target");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Near the top of the screen, so the card at the bottom doesn't cover it.
  const top = el.getBoundingClientRect().top + window.scrollY - Math.max(80, window.innerHeight * 0.12);
  window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
}

// --- Moving through the tour ---

async function tourGo(index, session) {
  tourWrite(sessionStorage, TOUR_STATE_KEY, { index });
  const step = TOUR_STEPS[index];
  const role = tourRole(session);

  if (step.role !== role) {
    if (session.demoTour) return tourShowSwitch(index, session);
    return tourShowStep(index, session, { described: true });
  }
  // A detail step needs a record (?id=); a list step needs the plain page.
  const needsMove = !tourOnPage(step.page) || (step.resolve ? !location.search : location.search !== "");
  if (needsMove) {
    const url = step.resolve ? await step.resolve() : step.page;
    if (`${currentPage()}${location.search}` !== url) {
      location.href = url;
      return;
    }
  }
  return tourShowStep(index, session, { described: false });
}

function tourKicker(index) {
  const step = TOUR_STEPS[index];
  const chapters = Object.keys(TOUR_CHAPTERS);
  const n = chapters.indexOf(step.role) + 1;
  return `Chapter ${n} of ${chapters.length}: ${TOUR_CHAPTERS[step.role].title} · Step ${index + 1} of ${TOUR_STEPS.length}`;
}

function tourNavButtons(index, session) {
  const buttons = [];
  if (index > 0) buttons.push({ label: "Back", onClick: () => tourGo(index - 1, session) });
  if (TOUR_STEPS[index].last) {
    buttons.push({
      label: "Finish",
      primary: true,
      onClick: () => {
        tourWrite(sessionStorage, TOUR_STATE_KEY, null);
        tourClose();
      },
    });
  } else {
    buttons.push({ label: "Next", primary: true, onClick: () => tourGo(index + 1, session) });
    buttons.push({
      label: "End tour",
      onClick: () => {
        tourWrite(sessionStorage, TOUR_STATE_KEY, null);
        tourClose();
      },
    });
  }
  return buttons;
}

async function tourShowStep(index, session, { described }) {
  const step = TOUR_STEPS[index];
  let body = step.body;
  if (described) body = `What ${TOUR_CHAPTERS[step.role].who} sees: ${body}`;
  tourCard({ kicker: tourKicker(index), title: step.title, body, buttons: tourNavButtons(index, session) });
  if (described || !step.target) {
    window.scrollTo({ top: 0 });
    return;
  }
  const el = await tourWaitFor(step.target);
  // Still on this step (the presenter may have moved on while the page loaded)?
  if (el && tourRead(sessionStorage, TOUR_STATE_KEY)?.index === index) tourHighlight(el);
}

// Local presentation build only: a chapter needs another account, so offer to switch to it.
function tourShowSwitch(index, session) {
  const step = TOUR_STEPS[index];
  const chapter = TOUR_CHAPTERS[step.role];
  const label = step.role === "visitor" ? "Continue as a visitor" : `Continue as ${chapter.account}`;
  const body =
    step.role === "visitor"
      ? "This part shows the site to someone who hasn't signed in. Continuing signs this browser out."
      : `Next, the site as ${chapter.who}. Continuing signs this browser in as that test account (on this local build only).`;
  const buttons = [];
  if (index > 0) buttons.push({ label: "Back", onClick: () => tourGo(index - 1, session) });
  buttons.push({
    label,
    primary: true,
    onClick: async () => {
      const res = await api("/api/demo/sign-in-as", { method: "POST", body: { role: step.role } });
      if (!res.ok) {
        // Can't switch (e.g. the fixtures aren't loaded): carry on with descriptions instead.
        return tourShowStep(index, session, { described: true });
      }
      tourWrite(sessionStorage, TOUR_STATE_KEY, { index });
      location.href = step.resolve ? await step.resolve() : step.page;
    },
  });
  buttons.push({
    label: "End tour",
    onClick: () => {
      tourWrite(sessionStorage, TOUR_STATE_KEY, null);
      tourClose();
    },
  });
  tourCard({ kicker: tourKicker(index), title: `Chapter: ${chapter.title}`, body, buttons });
}

function tourStart(session) {
  tourWrite(localStorage, tourSeenKey(session), true);
  tourGo(0, session);
}

// First visit for this build and this person: offer the tour once.
function tourOffer(session) {
  tourWrite(localStorage, tourSeenKey(session), true);
  tourCard({
    kicker: "New here?",
    title: "Take a guided tour",
    body: "A few minutes through the whole platform: what visitors, students, faculty and Centre staff each see and do.",
    buttons: [
      { label: "Start the tour", primary: true, onClick: () => tourStart(session) },
      { label: "Not now", onClick: tourClose },
    ],
  });
}

async function tourInit() {
  const session = typeof LAST_SESSION !== "undefined" && LAST_SESSION ? LAST_SESSION : await getSession();
  const params = new URLSearchParams(location.search);
  if (params.get("tour") === "start") {
    params.delete("tour");
    const rest = params.toString();
    history.replaceState(null, "", `${location.pathname}${rest ? `?${rest}` : ""}${location.hash}`);
    return tourStart(session);
  }
  const state = tourRead(sessionStorage, TOUR_STATE_KEY);
  if (state && Number.isInteger(state.index) && TOUR_STEPS[state.index]) {
    // Resuming after moving page: show the step here (tourGo only navigates if this is the wrong page).
    return tourGo(state.index, session);
  }
  if (tourRead(localStorage, tourSeenKey(session)) !== true && !["operator.html", "signin.html"].includes(currentPage())) {
    tourOffer(session);
  }
}

tourInit();
