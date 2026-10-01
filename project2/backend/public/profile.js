const $ = (id) => document.getElementById(id);
const statusEl = $("status");

function lines(value) {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

// R1-09: each preference is offered with a plain-language explanation.
function renderInquiryOptions(options, selected) {
  const container = $("inquiry-options");
  container.innerHTML = "";
  for (const option of options) {
    const label = document.createElement("label");
    label.className = "choice";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "inquiryPreference";
    input.value = option.value;
    input.checked = option.value === selected;
    const text = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = option.label;
    const detail = document.createElement("span");
    detail.className = "hint";
    detail.textContent = option.explanation;
    text.append(strong, document.createElement("br"), detail);
    label.append(input, text);
    container.append(label);
  }
}

function fillForm(profile) {
  $("displayName").value = profile.displayName;
  $("description").value = profile.description;
  $("researchAreas").value = profile.researchAreas.join("\n");
  $("externalLinks").value = profile.externalLinks.join("\n");
  const link = $("view-link");
  link.querySelector("a").href = `faculty.html?id=${encodeURIComponent(profile.id)}`;
  link.hidden = false;
}

function renderVisibilityNote(user) {
  const note = $("visibility-note");
  if (user.publicProfileChoice === null) {
    note.innerHTML =
      'Before you can save your profile, choose whether it may be shown publicly on the <a href="index.html">home page</a>. Either answer is fine.';
  } else if (user.publiclyVisible) {
    note.textContent = "Your profile is public: anyone can see it, including people who are not signed in.";
  } else {
    note.textContent = "Your profile is shown only to people signed in with an Algoma account.";
  }
  if (user.publicProfileChoice !== null) {
    note.insertAdjacentHTML("beforeend", ' You can change this on the <a href="index.html">home page</a>.');
  }
}

// Focus the field the server says is wrong, so keyboard and screen-reader users land on it.
function focusField(field) {
  if (field === "inquiryPreference") {
    (document.querySelector('input[name="inquiryPreference"]:checked') ||
      document.querySelector('input[name="inquiryPreference"]'))?.focus();
  } else if (field && $(field)) {
    $(field).focus();
  }
}

$("profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const selected = document.querySelector('input[name="inquiryPreference"]:checked');
  const body = {
    displayName: $("displayName").value,
    description: $("description").value,
    researchAreas: lines($("researchAreas").value),
    inquiryPreference: selected ? selected.value : null,
    externalLinks: lines($("externalLinks").value),
  };
  const res = await api("/api/faculty/me/profile", { method: "PUT", body });
  if (!res.ok) {
    showStatus(statusEl, res.data.error || "Could not save your profile.", { error: true });
    focusField(res.data.field);
    return;
  }
  fillForm(res.data.profile);
  showStatus(statusEl, "Profile saved.");
});

(async () => {
  const session = await getSession();
  renderNav(session);
  if (!session.authenticated) {
    $("denied").innerHTML = 'Please <a href="index.html">sign in</a> first.';
    $("denied").hidden = false;
    return;
  }
  if (!session.user.isVerifiedFaculty) {
    $("denied").textContent =
      "Only verified faculty can keep a profile. Faculty member? Ask Centre staff to verify your account.";
    $("denied").hidden = false;
    return;
  }

  const res = await api("/api/faculty/me/profile");
  if (!res.ok) {
    showStatus(statusEl, res.data.error || "Could not load your profile.", { error: true });
    return;
  }
  const { profile, inquiryOptions } = res.data;
  renderVisibilityNote(session.user);
  renderInquiryOptions(inquiryOptions, profile?.inquiryPreferenceCode);
  if (profile) fillForm(profile);
  $("panel").hidden = false;
})();
