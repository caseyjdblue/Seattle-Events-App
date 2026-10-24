import raw from "../data/events.json";
import { buildIcs, icsFilename } from "./lib/ics.ts";
import {
  AREA_FILTERS,
  CATEGORIES,
  type EventFile,
  type EventRecord,
  type LatLng,
  eventsOnDay,
  formatDayHeading,
  formatDayShort,
  formatMiles,
  formatMonth,
  monthCells,
  orderByDistance,
  partitionByPick,
  seattleTodayKey,
  spanHint,
  timeLabelForDay,
  endsKnownOnDay,
  validateEvents,
} from "./lib/model.ts";
import "./styles.css";

const file = raw as EventFile;
const problems = validateEvents(file);

type GeoStatus = "idle" | "loading" | "on" | "denied" | "error";

const openingToday = seattleTodayKey();
const [openingYear, openingMonth] = openingToday.split("-").map(Number);

const state = {
  view: location.hash === "#calendar" ? "calendar" : "today",
  categories: new Set<string>(),
  areas: new Set<string>(),
  filtersOpen: window.matchMedia("(min-width: 900px)").matches,
  near: null as LatLng | null,
  nearError: null as string | null,
  geoStatus: "idle" as GeoStatus,
  showGeoPrompt: false,
  monthYear: openingYear,
  month: openingMonth,
  selectedDay: null as string | null,
};

let pendingFocus: string | null | undefined;
let returnFocusId: string | null = null;
let scrollToDay = false;

function h(tag: string, attrs: Record<string, string | null | undefined> = {}, children: (Node | string | null | false | undefined)[] = []): HTMLElement {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    el.setAttribute(key, value);
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

function setStatus(text: string): void {
  const el = document.getElementById("status");
  if (el && el.textContent !== text) el.textContent = text;
}

function activeFilterCount(): number {
  return state.categories.size + state.areas.size;
}

function categorySummary(): string {
  if (state.categories.size === 0) return "All categories";
  return [...state.categories].join(" or ");
}

function areaSummary(): string {
  if (state.areas.size === 0) return "All areas";
  return [...state.areas]
    .map((id) => AREA_FILTERS.find((area) => area.id === id)?.label ?? id)
    .join(" or ");
}

function render(): void {
  const root = document.getElementById("app");
  if (!root) return;
  const focusId = pendingFocus !== undefined ? pendingFocus : document.activeElement?.getAttribute("data-focus-id");
  pendingFocus = undefined;
  const today = seattleTodayKey();
  root.replaceChildren(buildPage(today));
  document.title = state.view === "calendar" ? "Calendar · Seattle Events" : "Today · Seattle Events";
  document.body.classList.toggle("modal-open", state.showGeoPrompt);
  if (focusId) {
    const next = root.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]`);
    next?.focus();
  }
  if (scrollToDay && window.matchMedia("(max-width: 899px)").matches) {
    document.getElementById("day-panel")?.scrollIntoView({ block: "start" });
  }
  scrollToDay = false;
  announce(today);
}

function announce(today: string): void {
  const categories = [...state.categories];
  const areas = [...state.areas];
  if (state.view === "today") {
    const count = eventsOnDay(file.events, today, categories, areas).length;
    const how = state.near ? "sorted by distance" : "Quinn's picks first";
    setStatus(`Today, ${formatDayHeading(today)}. ${count} events, ${how}. ${categorySummary()}. ${areaSummary()}.`);
    return;
  }
  const selected = state.selectedDay;
  const monthCount = monthCells(state.monthYear, state.month).filter((day) => day && eventsOnDay(file.events, day, categories, areas).length > 0).length;
  const dayCount = selected ? eventsOnDay(file.events, selected, categories, areas).length : 0;
  const dayText = selected ? `${formatDayHeading(selected)} is open, ${dayCount} events.` : "No day is open.";
  setStatus(`${formatMonth(state.monthYear, state.month)}. ${monthCount} days with events. ${dayText}`);
}

function buildPage(today: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  frag.append(
    h("a", { class: "skip", href: "#main" }, ["Skip to content"]),
    h("header", { class: "band" }, [
      h("p", { class: "kicker" }, ["Seattle · Bellevue · Redmond"]),
      h("h1", {}, ["Seattle Events"]),
      h("p", { class: "lede" }, ["Quinn's picks for friends and family. No sign-in. Anyone with the link can look."]),
      h("p", { class: "week" }, [`Listed week: ${formatDayShort(file.weekOf)} – ${formatDayShort(file.through)}, 2026`]),
    ]),
    h("div", { class: "wrap" }, [
      h("nav", { class: "nav", "aria-label": "Views" }, [
        viewLink("today", "Today", "nav-today"),
        viewLink("calendar", "Calendar", "nav-calendar"),
      ]),
      buildFilters(),
      h("main", { id: "main" }, [state.view === "calendar" ? buildCalendar(today) : buildToday(today)]),
      h("footer", { class: "footer" }, [
        h("p", {}, ["Times are Pacific. Add to calendar downloads an .ics file. If an end time was not published, the file uses a 2-hour hold and says so in the description."]),
        h("p", {}, ["Locations are approximate and stay on this device when you use Near me. Nothing is sent to a server. Replace data/events.json to update the week."]),
      ]),
    ]),
  );
  if (state.showGeoPrompt) frag.append(buildGeoDialog());
  return frag;
}

function viewLink(view: "today" | "calendar", label: string, focusId: string): HTMLElement {
  const current = state.view === view;
  return h(
    "a",
    {
      class: current ? "nav-link is-current" : "nav-link",
      href: `#${view}`,
      "aria-current": current ? "page" : null,
      "data-focus-id": focusId,
    },
    [label],
  );
}

function buildFilters(): HTMLElement {
  const count = activeFilterCount();
  const panel = h(
    "div",
    { id: "filter-panel", class: "filter-panel", hidden: state.filtersOpen ? null : "" },
    [
      chipGroup("Categories", "category", CATEGORIES.map((category) => ({ id: category, label: category })), state.categories, "Choose one or more. A day shows events in any selected category."),
      chipGroup("Areas", "area", AREA_FILTERS.map((area) => ({ id: area.id, label: area.label })), state.areas, "Marymoor Park is part of Redmond. Shoreline shows when all areas are selected."),
      count
        ? h("button", { type: "button", class: "btn btn-small", "data-action": "clear-filters", "data-focus-id": "clear-filters" }, ["Clear filters"])
        : null,
    ],
  );
  return h("section", { class: "filters", "aria-label": "Filters" }, [
    h("div", { class: "filter-bar" }, [
      h(
        "button",
        {
          type: "button",
          class: "btn",
          "data-action": "toggle-filters",
          "data-focus-id": "filter-toggle",
          "aria-expanded": state.filtersOpen ? "true" : "false",
          "aria-controls": "filter-panel",
        },
        [count ? `Filters (${count})` : "Filters"],
      ),
      h("p", { class: "filter-summary" }, [`${categorySummary()} · ${areaSummary()}`]),
    ]),
    panel,
  ]);
}

function chipGroup(
  label: string,
  kind: "category" | "area",
  options: { id: string; label: string }[],
  selected: Set<string>,
  help: string,
): HTMLElement {
  const allOn = selected.size === 0;
  const chips = [
    h(
      "button",
      {
        type: "button",
        class: "chip",
        "data-action": kind === "category" ? "toggle-category" : "toggle-area",
        "data-value": "*",
        "data-focus-id": `${kind}:*`,
        "aria-pressed": allOn ? "true" : "false",
      },
      ["All"],
    ),
    ...options.map((option) =>
      h(
        "button",
        {
          type: "button",
          class: "chip",
          "data-action": kind === "category" ? "toggle-category" : "toggle-area",
          "data-value": option.id,
          "data-focus-id": `${kind}:${option.id}`,
          "aria-pressed": selected.has(option.id) ? "true" : "false",
        },
        [option.label],
      ),
    ),
  ];
  return h("div", { class: "filter-group" }, [
    h("p", { class: "filter-label", id: `${kind}-label` }, [label]),
    h("div", { class: "chips", role: "group", "aria-labelledby": `${kind}-label` }, chips),
    h("p", { class: "filter-help" }, [help]),
  ]);
}

function buildToday(today: string): HTMLElement {
  const categories = [...state.categories];
  const areas = [...state.areas];
  const todays = eventsOnDay(file.events, today, categories, areas);
  const blocks: (HTMLElement | null)[] = [
    h("div", { class: "today-head" }, [
      h("h2", {}, [`Today, ${formatDayHeading(today)}`]),
      h("p", { class: "subhead" }, [`${todays.length} ${todays.length === 1 ? "event" : "events"} · Pacific Time`]),
    ]),
    h("div", { class: "row-actions" }, [
      h(
        "button",
        {
          type: "button",
          class: "btn",
          "data-action": "near-me",
          "data-focus-id": "near-me",
          "aria-pressed": state.near ? "true" : "false",
          "aria-busy": state.geoStatus === "loading" ? "true" : "false",
          disabled: state.geoStatus === "loading" ? "" : null,
        },
        [state.geoStatus === "loading" ? "Finding you…" : "Near me"],
      ),
      state.near
        ? h("button", { type: "button", class: "btn", "data-action": "clear-near", "data-focus-id": "clear-near" }, ["Sort by time"])
        : null,
    ]),
    state.nearError ? h("p", { class: "alert", role: "alert" }, [state.nearError]) : null,
    state.near ? h("p", { class: "status-line" }, ["Sorting by distance. Quinn's picks stay marked. Location stays on this device."]) : null,
  ];

  if (!todays.length) {
    blocks.push(
      h("p", { class: "empty" }, ["Nothing listed for today in Pacific Time. Open the calendar for other days, or check back after the next events file."]),
    );
  } else if (state.near) {
    const ordered = orderByDistance(todays, state.near);
    blocks.push(h("h3", { class: "section-title" }, ["Today, nearest first"]));
    blocks.push(h("div", { class: "cards" }, ordered.located.map((item) => buildCard(item.event, today, item.miles))));
    if (ordered.unknown.length) {
      blocks.push(h("h3", { class: "section-title" }, ["Distance not listed"]));
      blocks.push(h("div", { class: "cards" }, ordered.unknown.map((event) => buildCard(event, today, "missing"))));
    }
  } else {
    const grouped = partitionByPick(todays);
    blocks.push(h("h3", { class: "section-title" }, ["Quinn's picks"]));
    blocks.push(h("div", { class: "cards" }, grouped.picks.map((event) => buildCard(event, today, "hide"))));
    if (grouped.others.length) {
      blocks.push(h("h3", { class: "section-title" }, ["Also today"]));
      blocks.push(h("div", { class: "cards" }, grouped.others.map((event) => buildCard(event, today, "hide"))));
    }
  }
  blocks.push(buildSoon());
  return h("div", {}, blocks);
}

function buildSoon(): HTMLElement {
  return h("section", { class: "soon", "aria-labelledby": "soon-title" }, [
    h("p", { id: "soon-title", class: "soon-title" }, ["Ask about events"]),
    h("button", { type: "button", class: "btn soon-btn", disabled: "" }, ["Ask about events (coming soon)"]),
    h("p", {}, ["Live chat isn't available yet. This button is a placeholder so it can be turned on later."]),
  ]);
}

function buildCalendar(today: string): HTMLElement {
  const categories = [...state.categories];
  const areas = [...state.areas];
  const cells = monthCells(state.monthYear, state.month);
  const weeks: HTMLElement[] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(h("tr", {}, cells.slice(index, index + 7).map((day) => buildDayCell(day, today, categories, areas))));
  }
  const weekday = (short: string, long: string) =>
    h("th", { scope: "col" }, [h("span", { class: "sr-only" }, [long]), h("span", { "aria-hidden": "true" }, [short])]);

  const selected = state.selectedDay;
  const selectedEvents = selected ? eventsOnDay(file.events, selected, categories, areas) : [];
  const panel = h("section", { id: "day-panel", class: "day-panel", "aria-live": "off" }, [
    selected
      ? h("h3", {}, [formatDayHeading(selected)])
      : h("h3", {}, ["Choose a day"]),
    h("p", { class: "subhead" }, [
      selected
        ? `${selectedEvents.length} ${selectedEvents.length === 1 ? "event" : "events"}`
        : "Days with a number have events. Select one to open the full list.",
    ]),
    selected && selectedEvents.length
      ? h("div", { class: "cards" }, selectedEvents.sort(byTime).map((event) => buildCard(event, selected, "hide")))
      : null,
    selected && !selectedEvents.length ? h("p", { class: "empty" }, ["Nothing listed this day for the current filters."]) : null,
  ]);

  return h("div", { class: "calendar-layout" }, [
    h("div", { class: "month-wrap" }, [
      h("div", { class: "month-nav" }, [
        h("button", { type: "button", class: "btn", "data-action": "prev-month", "data-focus-id": "prev-month", "aria-label": "Previous month" }, ["Prev"]),
        h("h2", { id: "month-label" }, [formatMonth(state.monthYear, state.month)]),
        h("button", { type: "button", class: "btn", "data-action": "next-month", "data-focus-id": "next-month", "aria-label": "Next month" }, ["Next"]),
      ]),
      h("table", { class: "month" }, [
        h("caption", { class: "sr-only" }, [`${formatMonth(state.monthYear, state.month)}, event counts by day`]),
        h("thead", {}, [
          h("tr", {}, [
            weekday("Sun", "Sunday"),
            weekday("Mon", "Monday"),
            weekday("Tue", "Tuesday"),
            weekday("Wed", "Wednesday"),
            weekday("Thu", "Thursday"),
            weekday("Fri", "Friday"),
            weekday("Sat", "Saturday"),
          ]),
        ]),
        h("tbody", {}, weeks),
      ]),
    ]),
    panel,
  ]);
}

function buildDayCell(day: string | null, today: string, categories: string[], areas: string[]): HTMLElement {
  if (!day) return h("td", { class: "out" }, []);
  const count = eventsOnDay(file.events, day, categories, areas).length;
  const dayNum = String(Number(day.slice(-2)));
  const isToday = day === today;
  const open = state.selectedDay === day;
  const label = `${formatDayHeading(day)}${isToday ? ", today" : ""}, ${count === 0 ? "no events" : `${count} ${count === 1 ? "event" : "events"}`}`;
  if (!count) {
    return h("td", { class: isToday ? "is-today" : null }, [h("span", { class: "day-num" }, [dayNum])]);
  }
  return h("td", { class: isToday ? "is-today" : null }, [
    h(
      "button",
      {
        type: "button",
        class: "day-btn",
        "data-action": "select-day",
        "data-day": day,
        "data-focus-id": `day:${day}`,
        "aria-expanded": open ? "true" : "false",
        "aria-controls": "day-panel",
        "aria-label": label,
      },
      [
        h("span", { "aria-hidden": "true", class: "num" }, [dayNum]),
        h("span", { "aria-hidden": "true", class: "count" }, [String(count)]),
      ],
    ),
  ]);
}

function byTime(a: EventRecord, b: EventRecord): number {
  const delta = Date.parse(a.start) - Date.parse(b.start);
  if (delta !== 0) return delta;
  return a.name.localeCompare(b.name);
}

function buildCard(event: EventRecord, day: string, distance: number | "hide" | "missing"): HTMLElement {
  const knownEnd = endsKnownOnDay(event, day);
  const hint = spanHint(event, day);
  return h("article", { class: event.isPick ? "card card-pick" : "card" }, [
    h("div", { class: "kicker-row" }, [
      event.isPick ? h("p", { class: "pick-flag" }, ["Quinn's pick"]) : h("p", { class: "pick-flag" }, ["Event"]),
      event.rating != null
        ? h("p", { class: "rating", "aria-label": `Quinn rated this ${event.rating} out of 5` }, [`${event.rating}/5`])
        : null,
    ]),
    h("p", { class: "when" }, [
      h("span", { class: "sr-only" }, ["When: "]),
      timeLabelForDay(event, day),
    ]),
    h("h4", {}, [
      h(
        "a",
        { class: "event-link", href: event.url, target: "_blank", rel: "noopener noreferrer" },
        [event.name, h("span", { class: "sr-only" }, [" (opens in a new tab)"])],
      ),
    ]),
    h("p", { class: "venue" }, [h("span", { class: "sr-only" }, ["Venue: "]), `${event.venue} · ${event.area}`]),
    h("p", { class: "meta" }, [h("span", { class: "pill" }, [event.category])]),
    h("p", { class: "price" }, [h("span", { class: "sr-only" }, ["Price: "]), event.price]),
    !knownEnd ? h("p", { class: "end-note" }, ["End time not listed"]) : null,
    event.note ? h("p", { class: "note" }, [event.note]) : null,
    hint ? h("p", { class: "span" }, [hint]) : null,
    typeof distance === "number" ? h("p", { class: "distance" }, [`${formatMiles(distance)} away · approximate`]) : null,
    distance === "missing" ? h("p", { class: "distance" }, ["Distance not listed"]) : null,
    h("p", { class: "source" }, [`Source: ${event.source}`]),
    h("div", { class: "actions" }, [
      h(
        "button",
        { type: "button", class: "btn", "data-action": "ics", "data-id": event.id, "data-focus-id": `ics:${event.id}:${day}` },
        ["Add to calendar"],
      ),
      h(
        "a",
        { class: "btn btn-primary", href: event.url, target: "_blank", rel: "noopener noreferrer" },
        ["Event page", h("span", { class: "sr-only" }, [" (opens in a new tab)"])],
      ),
    ]),
  ]);
}

function buildGeoDialog(): HTMLElement {
  return h("div", { class: "backdrop" }, [
    h(
      "div",
      { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "geo-title", "aria-describedby": "geo-desc" },
      [
        h("h2", { id: "geo-title" }, ["Sort today by distance?"]),
        h("p", { id: "geo-desc" }, [
          "Near me sorts today's events using your location. Your browser will ask for permission next. The location stays on this device and is not saved or sent anywhere.",
        ]),
        h("div", { class: "dialog-actions" }, [
          h("button", { type: "button", class: "btn btn-primary", id: "geo-confirm", "data-action": "geo-confirm", "data-focus-id": "geo-confirm" }, ["Use my location"]),
          h("button", { type: "button", class: "btn", "data-action": "geo-cancel", "data-focus-id": "geo-cancel" }, ["Not now"]),
        ]),
      ],
    ),
  ]);
}

function toggleSet(set: Set<string>, value: string | undefined): void {
  if (!value || value === "*") {
    set.clear();
    return;
  }
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

function shiftMonth(delta: number): void {
  const next = new Date(Date.UTC(state.monthYear, state.month - 1 + delta, 1));
  state.monthYear = next.getUTCFullYear();
  state.month = next.getUTCMonth() + 1;
  if (state.selectedDay) {
    const year = Number(state.selectedDay.slice(0, 4));
    const month = Number(state.selectedDay.slice(5, 7));
    if (year !== state.monthYear || month !== state.month) state.selectedDay = null;
  }
}

function downloadCalendar(event: EventRecord): void {
  const blob = new Blob([buildIcs(event)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = icsFilename(event);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus(`Downloaded a calendar file for ${event.name}.`);
}

function openGeoPrompt(): void {
  returnFocusId = document.activeElement?.getAttribute("data-focus-id") ?? "near-me";
  state.showGeoPrompt = true;
  pendingFocus = "geo-confirm";
  render();
}

function closeGeoPrompt(): void {
  state.showGeoPrompt = false;
  pendingFocus = returnFocusId;
  render();
}

function confirmGeo(): void {
  state.showGeoPrompt = false;
  if (!navigator.geolocation) {
    state.near = null;
    state.geoStatus = "error";
    state.nearError = "This browser can't share location. The list stays in time order.";
    pendingFocus = "near-me";
    render();
    return;
  }
  state.geoStatus = "loading";
  state.nearError = null;
  pendingFocus = "near-me";
  render();
  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.near = { lat: position.coords.latitude, lng: position.coords.longitude };
      state.geoStatus = "on";
      state.nearError = null;
      pendingFocus = "clear-near";
      render();
    },
    (error) => {
      state.near = null;
      state.geoStatus = error.code === error.PERMISSION_DENIED ? "denied" : "error";
      state.nearError =
        error.code === error.PERMISSION_DENIED
          ? "Location permission was blocked. You can allow it in the browser's site settings, then try Near me again."
          : "Location couldn't be read. The list stays in time order.";
      pendingFocus = "near-me";
      render();
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 },
  );
}

function onClick(event: MouseEvent): void {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "toggle-filters") {
    state.filtersOpen = !state.filtersOpen;
    pendingFocus = "filter-toggle";
    render();
  } else if (action === "toggle-category") {
    toggleSet(state.categories, target.dataset.value);
    pendingFocus = target.dataset.focusId ?? null;
    render();
  } else if (action === "toggle-area") {
    toggleSet(state.areas, target.dataset.value);
    pendingFocus = target.dataset.focusId ?? null;
    render();
  } else if (action === "clear-filters") {
    state.categories.clear();
    state.areas.clear();
    pendingFocus = "filter-toggle";
    render();
  } else if (action === "near-me") {
    openGeoPrompt();
  } else if (action === "geo-confirm") {
    confirmGeo();
  } else if (action === "geo-cancel") {
    closeGeoPrompt();
  } else if (action === "clear-near") {
    state.near = null;
    state.geoStatus = "idle";
    state.nearError = null;
    pendingFocus = "near-me";
    render();
  } else if (action === "prev-month") {
    shiftMonth(-1);
    pendingFocus = "prev-month";
    render();
  } else if (action === "next-month") {
    shiftMonth(1);
    pendingFocus = "next-month";
    render();
  } else if (action === "select-day") {
    const day = target.dataset.day ?? null;
    state.selectedDay = state.selectedDay === day ? null : day;
    scrollToDay = state.selectedDay != null;
    pendingFocus = day ? `day:${day}` : null;
    render();
  } else if (action === "ics") {
    const found = file.events.find((item) => item.id === target.dataset.id);
    if (found) downloadCalendar(found);
  }
}

function onKey(event: KeyboardEvent): void {
  if (!state.showGeoPrompt) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeGeoPrompt();
    return;
  }
  if (event.key !== "Tab") return;
  const dialog = document.querySelector("[role='dialog']");
  if (!dialog) return;
  const focusables = [...dialog.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])")].filter(
    (el) => !el.hasAttribute("disabled"),
  );
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function showProblems(messages: string[]): void {
  const root = document.getElementById("app");
  if (!root) return;
  root.replaceChildren(
    h("main", { class: "wrap" }, [
      h("h1", {}, ["Seattle Events can't read events.json"]),
      h("p", {}, ["Fix the data file, then reload. The checks are the same ones npm test runs."]),
      h("ul", {}, messages.map((message) => h("li", {}, [message]))),
    ]),
  );
}

function boot(): void {
  if (problems.length) {
    showProblems(problems);
    return;
  }
  document.addEventListener("click", onClick);
  document.addEventListener("keydown", onKey);
  window.addEventListener("hashchange", () => {
    const next = location.hash === "#calendar" ? "calendar" : "today";
    if (next === state.view) return;
    state.view = next;
    render();
  });
  render();
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {
        /* The site still works online if the worker does not install. */
      });
    });
  }
}

boot();
