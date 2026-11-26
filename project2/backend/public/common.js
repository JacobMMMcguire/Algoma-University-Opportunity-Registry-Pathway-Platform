// Shared by every page: <script src="common.js"></script> before the page's own script.

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// F-18, F-19: under a paged list, says how many are shown and offers the next page. `page` is
// the API's { total, next }; `loadNext(offset)` fetches and adds that page.
function showMoreButton(button, countEl, shown, page, loadNext) {
  countEl.textContent = page.total > shown ? `Showing ${shown} of ${page.total}.` : "";
  button.hidden = page.next === null || page.next === undefined;
  button.onclick = async () => {
    button.disabled = true;
    await loadNext(page.next);
    button.disabled = false;
  };
}

// Builds an element without HTML strings, so user and partner text is always text. `props.text`
// sets textContent; children may be strings or elements, and null/false children are skipped.
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("data-") || key.startsWith("aria-")) node.setAttribute(key, value);
    else node[key] = value;
  }
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

// Replaces an element's children, skipping null/false like h() does (replaceChildren would show
// them as the text "null").
function setChildren(element, ...children) {
  element.replaceChildren(...children.filter((c) => c !== null && c !== undefined && c !== false));
}

// Moves focus to `selector` after a change, so keyboard and screen-reader users land on what
// changed. Headings and cards get tabindex="-1" so they can take focus.
function focusElement(selector) {
  const target = selector && document.querySelector(selector);
  if (!target) return;
  if (!target.matches("a[href], button, input, select, textarea")) target.tabIndex = -1;
  target.focus();
}

// Calls the API on this same origin. Never throws: network failures come back as status 0.
async function api(path, { method = "GET", body, headers = {} } = {}) {
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "Could not reach the server. Check your connection and try again." } };
  }
}

// { authenticated, testMode, clock, user? } where user has id, email, isStaff, isVerifiedFaculty,
// publicProfileChoice (true, false or null if not chosen yet) and publiclyVisible, and clock is
// { today, simulated, label }: the date deadlines are evaluated against (R3-08).
async function getSession() {
  const res = await api("/api/auth/me");
  return res.ok ? res.data : { authenticated: false, testMode: false };
}

// Add links for new pages here. `show` decides visibility from the session; `group` decides where
// the link sits: a dropdown in the red top bar for visitors, a sidebar section once signed in.
const NAV_GROUPS = ["Explore", "Your work", "Account", "Staff", "For organisations", "Test mode"];
const NAV_LINKS = [
  { href: "index.html", label: "Home", group: "Explore", sidebarOnly: true },
  { href: "projects.html", label: "Discover projects", group: "Explore", description: "Faculty, industry and external opportunities" },
  { href: "faculty.html", label: "Faculty directory", group: "Explore", description: "Research interests and how to get in touch" },
  { href: "showcase.html", label: "Completed work", group: "Explore", description: "Projects students finished, confirmed by faculty" },
  { href: "my-projects.html", label: "Your projects", group: "Your work", show: (s) => s.user?.isVerifiedFaculty },
  { href: "submissions.html", label: "Industry opportunities", group: "Your work", show: (s) => s.user?.isVerifiedFaculty || s.user?.isStaff },
  { href: "lifecycle.html", label: "Terms and deadlines", group: "Your work", show: (s) => s.user?.isVerifiedFaculty || s.user?.isStaff },
  { href: "matches.html", label: "Matches", group: "Your work", show: (s) => s.user && (s.user.isVerifiedFaculty || !s.user.isStaff) },
  { href: "outcomes.html", label: "Your outcomes", group: "Your work", show: (s) => s.user && (s.user.isVerifiedFaculty || !s.user.isStaff) },
  { href: "external.html", label: "Your external opportunities", group: "Your work", show: (s) => s.user && (s.user.isVerifiedFaculty || !s.user.isStaff) },
  { href: "notifications.html", label: "Notifications", group: "Your work", show: (s) => s.user?.isVerifiedFaculty },
  { href: "profile.html", label: "Your faculty profile", group: "Account", show: (s) => s.user?.isVerifiedFaculty },
  { href: "student-profile.html", label: "Your student profile", group: "Account", show: (s) => s.user && !s.user.isVerifiedFaculty && !s.user.isStaff },
  { href: "admin.html", label: "Faculty verification", group: "Staff", show: (s) => s.user?.isStaff },
  { href: "operations.html", label: "Operations", group: "Staff", show: (s) => s.user?.isStaff },
  { href: "sync.html", label: "External sync health", group: "Staff", show: (s) => s.user?.isStaff },
  { href: "partner.html", label: "Propose a project", group: "For organisations", description: "No account needed. Faculty review every proposal." },
  { href: "operator.html", label: "Operator console", group: "Test mode", description: "Sign-in codes for the test accounts", show: (s) => s.testMode },
];

const BRAND_MARK_SVG =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b3202f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="M3 13l9 5 9-5"/></svg>';
const CHEVRON_SVG =
  '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>';

// Fixed SVG markup only (never user text), wrapped so it can sit inside h() children.
function svgIcon(markup) {
  const span = document.createElement("span");
  span.innerHTML = markup;
  return span.firstElementChild;
}

function currentPage() {
  return location.pathname.split("/").pop() || "index.html";
}

function visibleNavGroups(session) {
  const links = NAV_LINKS.filter((link) => !link.show || link.show(session));
  return NAV_GROUPS.map((name) => ({ name, links: links.filter((link) => link.group === name) })).filter((g) => g.links.length);
}

// Closes every open dropdown (top-bar menus and the account menu), optionally except one.
function closeDropdowns(except) {
  for (const trigger of document.querySelectorAll(".nav-trigger, .account-trigger")) {
    if (trigger === except) continue;
    trigger.setAttribute("aria-expanded", "false");
    document.getElementById(trigger.getAttribute("aria-controls")).hidden = true;
  }
}

// A disclosure button with its menu: click or Enter/Space toggles, Escape closes and returns focus.
function dropdown(label, menuId, items, { triggerClass = "nav-trigger", align = "", current = false, leading = null } = {}) {
  const trigger = h(
    "button",
    { type: "button", class: `${triggerClass}${current ? " is-current" : ""}`, "aria-expanded": "false", "aria-controls": menuId },
    leading,
    h("span", { text: label }),
    svgIcon(CHEVRON_SVG),
  );
  const menu = h("ul", { id: menuId, class: `nav-menu ${align}`.trim(), hidden: true }, ...items.map((item) => h("li", {}, item)));
  trigger.addEventListener("click", () => {
    const open = trigger.getAttribute("aria-expanded") !== "true";
    closeDropdowns(trigger);
    trigger.setAttribute("aria-expanded", String(open));
    menu.hidden = !open;
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeDropdowns();
    trigger.focus();
  });
  return h("div", { class: "nav-group" }, trigger, menu);
}

function navMenuLink(link, current) {
  const props = { href: link.href };
  if (link.href === current) props["aria-current"] = "page";
  return h(
    "a",
    props,
    h("span", { class: "item-label", text: link.label }),
    link.description ? h("span", { class: "item-desc", text: link.description }) : null,
  );
}

async function signOutEverywhere() {
  await api("/api/auth/logout", { method: "POST" });
  location.href = "index.html";
}

// The sidebar: always shown to signed-in users on wide screens; on phones (and for visitors) it is
// the drawer the Menu button opens.
function buildSidebar(session, groups, current) {
  const close = h("button", { type: "button", "aria-label": "Close menu" }, "Close");
  const sidebar = h(
    "nav",
    { id: "sidebar", class: `sidebar${session.authenticated ? "" : " drawer-only"}`, "aria-label": "Site" },
    h("div", { class: "sidebar-head" }, h("span", { text: "Menu" }), close),
    ...groups.map((group) => {
      const headingId = `sidebar-${group.name.toLowerCase().replace(/[^a-z]+/g, "-")}`;
      return h(
        "div",
        {},
        h("p", { class: "sidebar-group-title", id: headingId, text: group.name }),
        h(
          "ul",
          { "aria-labelledby": headingId },
          ...group.links.map((link) => {
            const props = { href: link.href, text: link.label };
            if (link.href === current) props["aria-current"] = "page";
            return h("li", {}, h("a", props));
          }),
        ),
      );
    }),
  );
  if (session.authenticated) {
    const signOut = h("button", { type: "button", text: "Sign out" });
    signOut.addEventListener("click", signOutEverywhere);
    sidebar.append(h("div", { class: "sidebar-account" }, h("p", {}, "Signed in as ", h("strong", { text: session.user.email })), signOut));
  } else if (current !== "signin.html") {
    sidebar.append(h("div", { class: "sidebar-account" }, h("a", { class: "button-link primary", href: "signin.html", text: "Sign in" })));
  }
  close.addEventListener("click", () => setDrawer(false, { returnFocus: true }));
  sidebar.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sidebar.classList.contains("open")) setDrawer(false, { returnFocus: true });
  });
  return sidebar;
}

function setDrawer(open, { returnFocus = false } = {}) {
  const sidebar = document.getElementById("sidebar");
  const toggle = document.querySelector(".menu-toggle");
  const backdrop = document.querySelector(".drawer-backdrop");
  if (!sidebar || !toggle) return;
  sidebar.classList.toggle("open", open);
  backdrop?.classList.toggle("open", open);
  toggle.setAttribute("aria-expanded", String(open));
  if (open) sidebar.querySelector("a, button")?.focus();
  else if (returnFocus) toggle.focus();
}

function renderNav(session) {
  const header = document.querySelector("body > header");
  if (!header) return;
  const current = currentPage();
  const signedIn = Boolean(session.authenticated);
  const groups = visibleNavGroups(session);
  document.body.classList.toggle("signed-in", signedIn);

  // Clear anything a previous call built (index.js calls this again after signing out).
  document.getElementById("sidebar")?.remove();
  document.querySelector(".drawer-backdrop")?.remove();
  const oldShell = document.querySelector(".shell");
  if (oldShell) {
    const main = oldShell.querySelector("main");
    if (main) oldShell.before(main);
    oldShell.remove();
  }

  const main = document.querySelector("main");
  if (main && !main.id) main.id = "main";
  if (!document.querySelector(".skip-link") && main) {
    document.body.prepend(h("a", { class: "skip-link", href: `#${main.id}`, text: "Skip to main content" }));
  }

  header.className = "site-header";
  const brand = h(
    "a",
    { class: "brand", href: "index.html" },
    h("span", { class: "brand-mark" }, svgIcon(BRAND_MARK_SVG)),
    h("span", { class: "brand-text" }, h("span", { class: "brand-name", text: "Opportunity Registry" }), h("span", { class: "brand-sub", text: "Algoma University" })),
  );
  const bar = h("div", { class: "topbar" }, brand);

  // The sign-in page stands apart from the rest of the site: brand and a way back, nothing else.
  if (document.body.dataset.nav === "plain") {
    bar.append(h("a", { class: "topbar-back", href: "index.html", text: "Back to the registry" }));
    header.replaceChildren(bar);
    renderClockNote(session);
    return;
  }

  const toggle = h("button", { type: "button", class: "menu-toggle", "aria-expanded": "false", "aria-controls": "sidebar", text: "Menu" });
  toggle.addEventListener("click", () => setDrawer(toggle.getAttribute("aria-expanded") !== "true"));
  const actions = h("div", { class: "topbar-actions" });

  if (signedIn) {
    const email = session.user.email;
    const initials = email.slice(0, 2).toUpperCase();
    const signOut = h("button", { type: "button", class: "menu-item", text: "Sign out" });
    signOut.addEventListener("click", signOutEverywhere);
    const account = dropdown(
      email.split("@")[0],
      "account-menu",
      [h("p", { class: "menu-note" }, "Signed in as ", h("strong", { text: email })), h("a", { href: "index.html", text: "Your account" }), signOut],
      { triggerClass: "account-trigger", align: "align-right", leading: h("span", { class: "avatar", "aria-hidden": "true", text: initials }) },
    );
    account.classList.add("account-menu");
    account.querySelector("button").setAttribute("aria-label", `Account menu for ${email}`);
    actions.append(account, toggle);
    bar.append(actions);
  } else {
    const nav = h("nav", { id: "site-nav", class: "topbar-nav", "aria-label": "Main" });
    const list = h("ul");
    for (const group of groups) {
      const links = group.links.filter((link) => !link.sidebarOnly);
      if (!links.length) continue;
      const menuId = `menu-${group.name.toLowerCase().replace(/[^a-z]+/g, "-")}`;
      const here = links.some((link) => link.href === current);
      list.append(h("li", {}, dropdown(group.name, menuId, links.map((link) => navMenuLink(link, current)), { current: here })));
    }
    nav.append(list);
    bar.append(nav);
    if (current !== "signin.html") actions.append(h("a", { class: "signin-pill", href: "signin.html", text: "Sign in" }));
    actions.append(toggle);
    bar.append(actions);
  }
  header.replaceChildren(bar);

  const sidebar = buildSidebar(session, groups, current);
  const backdrop = h("div", { class: "drawer-backdrop" });
  backdrop.addEventListener("click", () => setDrawer(false, { returnFocus: true }));
  if (signedIn && main) {
    const shell = h("div", { class: "shell" });
    main.before(shell);
    shell.append(sidebar, main);
    shell.after(backdrop);
  } else {
    header.after(sidebar, backdrop);
  }
  renderClockNote(session);
}

// Clicking anywhere outside an open dropdown closes it.
document.addEventListener("click", (event) => {
  if (!event.target.closest?.(".nav-group")) closeDropdowns();
});

// R3_PLAN.md D3: when the server's clock is set to a fixed date (for evaluating the R3 fixture),
// every page says so, so nobody mistakes "expired" for a real-world fact.
function renderClockNote(session) {
  if (!session.clock?.simulated || document.getElementById("clock-note")) return;
  const note = document.createElement("p");
  note.id = "clock-note";
  note.className = "clock-note";
  note.textContent = `Deadlines are evaluated as of ${session.clock.label} (a simulated date, set for evaluation).`;
  // Above the red bar, so the bar and each page's red title band read as one block. Inside the
  // header landmark, so screen-reader users find it with the rest of the banner (axe "region").
  document.querySelector("body > header")?.prepend(note);
}

// "2026-10-20" -> "20 October 2026", without letting a time zone shift the day.
function formatDay(isoDate) {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${day} ${months[month - 1]} ${year}`;
}

// The not-found section of a detail page. R3-19: a record that is no longer listed says why,
// e.g. "Expired: the deadline, 20 October 2026, passed without a confirmed match."
function showNotFound(res, session) {
  const removed = res.data?.removed;
  const heading = document.querySelector("#not-found h1");
  const text = document.getElementById("not-found-text");
  if (removed) {
    heading.textContent = `No longer listed: ${removed.title}`;
    text.textContent = removed.lifecycle.reason;
  } else {
    text.textContent = session.authenticated
      ? "This project doesn't exist or is no longer available."
      : "This project doesn't exist or isn't available publicly. Signing in may let you see it.";
  }
  document.getElementById("not-found").hidden = false;
}

// Plain-language project status, for the owner's pages.
const PROJECT_STATUS_LABELS = {
  draft: "Draft: only you can see it",
  published: "Published",
  closed: "Closed: withdrawn from students",
};

// Shows a message in a role="status" element; errors are styled and announced the same way.
function showStatus(element, message, { error = false } = {}) {
  element.textContent = message;
  element.classList.toggle("error", error);
}

// API errors with a `code` the user can fix themselves get a link to where they fix it.
const ERROR_FIX_LINKS = {
  faculty_profile_required: { href: "profile.html", label: "Write your faculty profile" },
  public_profile_choice_required: { href: "index.html", label: "Choose on the home page" },
};

function showApiError(element, res, fallback) {
  showStatus(element, res.data.error || fallback, { error: true });
  const fix = ERROR_FIX_LINKS[res.data.code];
  if (fix) {
    const link = document.createElement("a");
    link.href = fix.href;
    link.textContent = fix.label;
    element.append(" ", link);
  }
}
