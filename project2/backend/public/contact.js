// R1-22: the Contact action. Students draft a message here, then send it from their own
// university email (Gmail for Algoma's Google Workspace accounts, or any mail app). Nothing is
// sent by this site, and the address is only placed in links, never printed on the page.
// Load after common.js; call renderContactPanel() with the section to fill.

// Spaces as %20 rather than "+", which some mail handlers show literally.
function gmailComposeUrl(to, subject, body, accountEmail) {
  const parts = { view: "cm", fs: "1", to, su: subject, body };
  if (accountEmail) parts.authuser = accountEmail;
  const query = Object.entries(parts).map(([key, value]) => `${key}=${encodeURIComponent(value)}`);
  return `https://mail.google.com/mail/?${query.join("&")}`;
}

function mailtoUrl(to, subject, body) {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// `section` must be an empty element. Builds a "Contact <name>" button that reveals an editable
// subject and message, with Open in Gmail / Open in email app / Copy actions.
function renderContactPanel(section, { email, facultyName, subject, body, session }) {
  const id = (name) => `contact-${name}`;
  section.className = "contact";
  section.innerHTML = `
    <h2 id="${id("heading")}">Contact</h2>
    <p>Write your message here, then send it from your own university email.</p>
    <button type="button" class="primary" id="${id("toggle")}" aria-expanded="false" aria-controls="${id("form")}"></button>
    <div id="${id("form")}" hidden>
      <div class="field">
        <label for="${id("subject")}">Subject</label>
        <input id="${id("subject")}" autocomplete="off">
      </div>
      <div class="field">
        <label for="${id("body")}">Message</label>
        <textarea id="${id("body")}" rows="10" aria-describedby="${id("body-hint")}"></textarea>
        <p id="${id("body-hint")}" class="hint">Replace the parts in [square brackets] before you send it.</p>
      </div>
      <div class="actions">
        <a class="button-link primary" id="${id("gmail")}" target="_blank" rel="noopener noreferrer">Open in Gmail</a>
        <a class="button-link" id="${id("mailto")}">Open in email app</a>
      </div>
      <p class="hint">Gmail opens a new tab with the message ready to send from your Algoma account.
        If neither option works for you, copy the parts into any email:</p>
      <div class="actions">
        <button type="button" id="${id("copy-address")}">Copy email address</button>
        <button type="button" id="${id("copy-subject")}">Copy subject</button>
        <button type="button" id="${id("copy-body")}">Copy message</button>
      </div>
      <p id="${id("status")}" class="status" role="status" aria-live="polite"></p>
    </div>`;

  const $c = (name) => section.querySelector(`#${id(name)}`);
  const toggle = $c("toggle");
  toggle.textContent = `Contact ${facultyName}`;
  $c("subject").value = subject;
  $c("body").value = body;

  const accountEmail = session?.user?.email;
  function updateLinks() {
    const s = $c("subject").value;
    const b = $c("body").value;
    $c("gmail").href = gmailComposeUrl(email, s, b, accountEmail);
    $c("mailto").href = mailtoUrl(email, s, b);
  }
  $c("subject").addEventListener("input", updateLinks);
  $c("body").addEventListener("input", updateLinks);
  updateLinks();

  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    $c("form").hidden = !open;
    if (open) $c("subject").focus();
  });

  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text);
      showStatus($c("status"), `${what} copied.`);
    } catch {
      showStatus($c("status"), `Couldn't copy automatically. Select the ${what.toLowerCase()} and copy it yourself.`, {
        error: true,
      });
    }
  }
  $c("copy-address").addEventListener("click", () => copy(email, "Email address"));
  $c("copy-subject").addEventListener("click", () => copy($c("subject").value, "Subject"));
  $c("copy-body").addEventListener("click", () => copy($c("body").value, "Message"));
  section.hidden = false;
}
