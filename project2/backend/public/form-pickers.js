// Inputs for the fixed lists from GET /api/options (src/catalog.js). Load after common.js.

// Research areas: a checkbox per area, grouped into collapsible sections. Groups that hold a
// chosen area start open. `countEl` shows how many are chosen out of `max`.
function renderAreaPicker(container, groups, selected, { max, countEl }) {
  const chosen = new Set(selected);
  container.replaceChildren(
    ...groups.map((g) => {
      const details = document.createElement("details");
      details.className = "area-group";
      details.open = g.areas.some((area) => chosen.has(area));
      const summary = document.createElement("summary");
      summary.textContent = g.group;
      const list = document.createElement("div");
      list.className = "area-options";
      for (const area of g.areas) {
        const label = document.createElement("label");
        label.className = "choice";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.name = "researchAreas";
        input.value = area;
        input.checked = chosen.has(area);
        const text = document.createElement("span");
        text.textContent = area;
        label.append(input, text);
        list.append(label);
      }
      details.append(summary, list);
      return details;
    }),
  );
  const updateCount = () => {
    const n = readAreaPicker(container).length;
    countEl.textContent = `${n} of up to ${max} chosen.`;
    countEl.classList.toggle("error", n > max);
  };
  container.addEventListener("change", updateCount);
  updateCount();
}

function readAreaPicker(container) {
  return [...container.querySelectorAll('input[name="researchAreas"]:checked')].map((input) => input.value);
}

// For validation errors: focus the first chosen area, or the first area at all.
function focusAreaPicker(container) {
  const target =
    container.querySelector('input[name="researchAreas"]:checked') || container.querySelector('input[name="researchAreas"]');
  if (!target) return;
  target.closest("details").open = true;
  target.focus();
}

// Fills a <select>. `options` are { value, label } (label defaults to value); a first, empty
// option is added when `emptyLabel` is given.
function fillSelect(select, options, selected, emptyLabel) {
  const items = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const choices = emptyLabel === undefined ? items : [{ value: "", label: emptyLabel }, ...items];
  select.replaceChildren(
    ...choices.map((o) => {
      const option = document.createElement("option");
      option.value = o.value;
      option.textContent = o.label ?? o.value;
      option.selected = o.value === (selected ?? "");
      return option;
    }),
  );
}

// Fills a <select> from [{ group, areas: [{ value, count }] }] with one <optgroup> per group.
// A selected value with no options (e.g. from an old link) is still shown, so the form always
// reflects the filter in the URL.
function fillGroupedSelect(select, groups, selected, emptyLabel) {
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = emptyLabel;
  const children = [empty];
  let found = !selected;
  for (const g of groups) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = g.group;
    for (const item of g.areas) {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = `${item.value} (${item.count})`;
      option.selected = item.value === selected;
      found ||= option.selected;
      optgroup.append(option);
    }
    children.push(optgroup);
  }
  if (!found) {
    const option = document.createElement("option");
    option.value = selected;
    option.textContent = `${selected} (0)`;
    option.selected = true;
    children.push(option);
  }
  select.replaceChildren(...children);
}

// Shared by the filter forms: submit only the filters that are set, so URLs stay readable
// and bookmarkable (R1-24), e.g. projects.html?area=Cybersecurity&term=Winter+2027.
function submitFiltersAsUrl(form, page) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      if (String(value).trim()) params.set(key, String(value).trim());
    }
    location.assign(params.size ? `${page}?${params}` : page);
  });
}

// "3 projects match your filters." / "Showing all 5 projects." Moves focus to the message
// after filtering, so screen-reader users hear the result.
function showResultCount(element, count, { noun, plural, filtered }) {
  const word = count === 1 ? noun : plural;
  element.textContent = filtered
    ? count === 0
      ? `No ${plural} match these filters. Try removing one, or clear the filters.`
      : `${count} ${word} match${count === 1 ? "es" : ""} these filters.`
    : `Showing all ${count} ${word}.`;
  if (filtered) {
    element.tabIndex = -1;
    element.focus();
  }
}

// Target term: a season and a year, combined as "Winter 2027". A stored year outside the
// offered range (an older project) is kept as an extra choice; a term in any other form
// (entered before terms were fixed) starts unselected.
function renderTermPicker(seasonSelect, yearSelect, { seasons, years }, current) {
  const match = /^(\S+) (\d{4})$/.exec(current || "");
  const season = match?.[1];
  const year = match?.[2];
  const yearChoices = years.map(String);
  if (year && !yearChoices.includes(year)) yearChoices.unshift(year);
  fillSelect(seasonSelect, seasons, seasons.includes(season) ? season : "", "Choose a season");
  fillSelect(yearSelect, yearChoices, yearChoices.includes(year) ? year : "", "Choose a year");
}

function readTerm(seasonSelect, yearSelect) {
  return seasonSelect.value && yearSelect.value ? `${seasonSelect.value} ${yearSelect.value}` : "";
}
