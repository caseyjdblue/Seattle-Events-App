/** Event dates are America/Los_Angeles civil times, stored as ISO datetimes with a numeric offset. */

export const TIME_ZONE = "America/Los_Angeles";

export const CATEGORIES = [
  "Live music & shows",
  "Food & drink / markets",
  "Outdoors & hikes",
  "Arts & culture",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Area chips. Other area strings (for example Shoreline) still show when no area is selected. */
export const AREA_FILTERS = [
  { id: "Seattle", label: "Seattle" },
  { id: "Bellevue", label: "Bellevue" },
  { id: "Redmond", label: "Redmond, incl. Marymoor" },
] as const;

export type Occurrence = {
  start: string;
  end: string | null;
};

export type EventRecord = {
  id: string;
  name: string;
  start: string;
  end: string | null;
  allDay: boolean;
  occurrences?: Occurrence[];
  venue: string;
  area: string;
  category: Category;
  price: string;
  url: string;
  source: string;
  isPick: boolean;
  rating: number | null;
  note: string | null;
  lat: number | null;
  lng: number | null;
};

export type EventFile = {
  timezone: string;
  weekOf: string;
  through: string;
  about?: string;
  events: EventRecord[];
};

export type LatLng = { lat: number; lng: number };

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD for an instant, using Pacific Time. */
export function seattleDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function seattleTodayKey(now = new Date()): string {
  return seattleDateKey(now);
}

/** Pacific offset for an instant, as ±HH:MM. */
export function pacificOffset(date: Date): string {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    timeZoneName: "shortOffset",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = name?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) {
    throw new Error(`Could not read Pacific offset from ${name ?? "missing name"}`);
  }
  return `${match[1]}${match[2].padStart(2, "0")}:${match[3] ?? "00"}`;
}

export function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, "0");
  const d = String(next.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * True when the event should appear on that Pacific calendar day.
 * A timed event that ends exactly at local midnight does not also appear on the next day.
 * All-day ranges include the start date and the end date.
 * When `occurrences` is set, only those intervals count (gaps are not filled in).
 */
export function coversDay(event: EventRecord, day: string): boolean {
  if (event.occurrences?.length) {
    return event.occurrences.some((occurrence) => intervalCoversDay(occurrence.start, occurrence.end, day));
  }
  if (event.allDay) {
    const startDay = event.start.slice(0, 10);
    const endDay = (event.end ?? event.start).slice(0, 10);
    return day >= startDay && day <= endDay;
  }
  return intervalCoversDay(event.start, event.end, day);
}

function intervalCoversDay(start: string, end: string | null, day: string): boolean {
  const startDay = start.slice(0, 10);
  if (!end) return day === startDay;
  const endDay = end.slice(0, 10);
  if (/T00:00:00/.test(end)) return day >= startDay && day < endDay;
  return day >= startDay && day <= endDay;
}

export function daysCovered(event: EventRecord): string[] {
  if (event.occurrences?.length) {
    const days = new Set<string>();
    for (const occurrence of event.occurrences) {
      for (const day of daysInInterval(occurrence.start, occurrence.end)) days.add(day);
    }
    return [...days].sort();
  }
  if (event.allDay) {
    const startDay = event.start.slice(0, 10);
    const endDay = (event.end ?? event.start).slice(0, 10);
    const days: string[] = [];
    let cursor = startDay;
    while (cursor <= endDay && days.length < 400) {
      days.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return days;
  }
  return daysInInterval(event.start, event.end);
}

function daysInInterval(start: string, end: string | null): string[] {
  const startDay = start.slice(0, 10);
  if (!end) return [startDay];
  const endDay = end.slice(0, 10);
  const last = /T00:00:00/.test(end) ? addDays(endDay, -1) : endDay;
  const days: string[] = [];
  let cursor = startDay;
  while (cursor <= last && days.length < 400) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

export function occurrencesOnDay(event: EventRecord, day: string): Occurrence[] {
  const source = event.occurrences?.length ? event.occurrences : [{ start: event.start, end: event.end }];
  return source.filter((occurrence) => intervalCoversDay(occurrence.start, occurrence.end, day));
}

export function formatWhen(iso: string, options: Intl.DateTimeFormatOptions): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options })
    .format(noon)
    .replace(/[\u202f\u00a0]/g, " ");
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  })
    .format(new Date(iso))
    .replace(/[\u202f\u00a0]/g, " ");
}

export function formatDayHeading(dateKey: string): string {
  return formatWhen(`${dateKey}T12:00:00-07:00`, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function formatDayShort(dateKey: string): string {
  return formatWhen(`${dateKey}T12:00:00-07:00`, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatMonth(year: number, month: number): string {
  const noon = new Date(Date.UTC(year, month - 1, 1, 12));
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(noon);
}

/** Time label for one calendar day. All-day listings say "All day" instead of midnight. */
export function timeLabelForDay(event: EventRecord, day: string): string {
  if (event.allDay && !event.occurrences?.length) return "All day";
  const occurrences = occurrencesOnDay(event, day);
  if (!occurrences.length) return "All day";
  if (occurrences.length > 1 && occurrences.every((occurrence) => !occurrence.end)) {
    return occurrences.map((occurrence) => formatTime(occurrence.start)).join(", ");
  }
  return occurrences
    .map((occurrence) => {
      const start = formatTime(occurrence.start);
      if (!occurrence.end) return start;
      return `${start}–${formatTime(occurrence.end)}`;
    })
    .join("; ");
}

export function endsKnownOnDay(event: EventRecord, day: string): boolean {
  if (event.allDay && !event.occurrences?.length) return true;
  const occurrences = occurrencesOnDay(event, day);
  return occurrences.length > 0 && occurrences.every((occurrence) => occurrence.end != null);
}

export function spanHint(event: EventRecord, day: string): string | null {
  const days = daysCovered(event);
  if (days.length <= 1) return null;
  const others = days.filter((item) => item !== day);
  const first = days[0];
  const last = days[days.length - 1];
  const consecutive = days.length === dayCountInclusive(first, last);
  if (!event.allDay && others.length === 1) return `Also ${formatDayShort(others[0])}`;
  if (consecutive) return `Runs ${formatDayShort(first)} – ${formatDayShort(last)}`;
  return `Also ${others.map((item) => formatDayShort(item)).join(", ")}`;
}

function dayCountInclusive(first: string, last: string): number {
  let count = 1;
  let cursor = first;
  while (cursor < last && count < 400) {
    cursor = addDays(cursor, 1);
    count += 1;
  }
  return count;
}

export function matchesFilters(event: EventRecord, categories: readonly string[], areas: readonly string[]): boolean {
  const categoryOk = categories.length === 0 || categories.includes(event.category);
  const areaOk = areas.length === 0 || areas.includes(event.area);
  return categoryOk && areaOk;
}

export function eventsOnDay(
  events: readonly EventRecord[],
  day: string,
  categories: readonly string[],
  areas: readonly string[],
): EventRecord[] {
  return events.filter((event) => coversDay(event, day) && matchesFilters(event, categories, areas));
}

function compareByTime(a: EventRecord, b: EventRecord): number {
  const delta = Date.parse(a.start) - Date.parse(b.start);
  if (delta !== 0) return delta;
  return a.name.localeCompare(b.name);
}

export function partitionByPick(events: readonly EventRecord[]): { picks: EventRecord[]; others: EventRecord[] } {
  const sorted = [...events].sort(compareByTime);
  return {
    picks: sorted.filter((event) => event.isPick),
    others: sorted.filter((event) => !event.isPick),
  };
}

export function distanceMiles(from: LatLng, to: LatLng): number {
  const earthMiles = 3958.7613;
  const toRadians = Math.PI / 180;
  const lat1 = from.lat * toRadians;
  const lat2 = to.lat * toRadians;
  const dLat = (to.lat - from.lat) * toRadians;
  const dLng = (to.lng - from.lng) * toRadians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthMiles * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function formatMiles(miles: number): string {
  if (miles < 0.1) return "Under 0.1 mi";
  return `${miles.toFixed(1)} mi`;
}

export function orderByDistance(
  events: readonly EventRecord[],
  near: LatLng,
): { located: { event: EventRecord; miles: number }[]; unknown: EventRecord[] } {
  const located: { event: EventRecord; miles: number }[] = [];
  const unknown: EventRecord[] = [];
  for (const event of events) {
    if (event.lat == null || event.lng == null) unknown.push(event);
    else located.push({ event, miles: distanceMiles(near, { lat: event.lat, lng: event.lng }) });
  }
  located.sort((a, b) => a.miles - b.miles || compareByTime(a.event, b.event));
  unknown.sort(compareByTime);
  return { located, unknown };
}

/** Sunday-first month grid. Null cells are the blank days outside the month. */
export function monthCells(year: number, month: number): (string | null)[] {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function validateEvents(file: EventFile): string[] {
  const errors: string[] = [];
  if (file.timezone !== TIME_ZONE) errors.push(`timezone must be ${TIME_ZONE}`);
  if (!DATE_KEY.test(file.weekOf)) errors.push("weekOf must be YYYY-MM-DD");
  if (!DATE_KEY.test(file.through)) errors.push("through must be YYYY-MM-DD");
  if (!Array.isArray(file.events)) return [...errors, "events must be an array"];

  const ids = new Set<string>();
  for (const event of file.events) {
    const id = event.id || "(missing id)";
    if (!event.id || ids.has(event.id)) errors.push(`${id} needs a unique id`);
    if (event.id) ids.add(event.id);
    if (!event.name?.trim()) errors.push(`${id} missing name`);
    if (!ISO_WITH_OFFSET.test(event.start)) errors.push(`${id} start must be an ISO datetime with a numeric offset`);
    if (event.end != null && !ISO_WITH_OFFSET.test(event.end)) errors.push(`${id} end must be an ISO datetime or null`);
    checkOffset(errors, id, event.start);
    if (event.end) checkOffset(errors, id, event.end);
    if (event.end && Date.parse(event.end) < Date.parse(event.start)) errors.push(`${id} end is before start`);
    if (typeof event.allDay !== "boolean") errors.push(`${id} allDay must be true or false`);
    if (!event.venue?.trim()) errors.push(`${id} missing venue`);
    if (!event.area?.trim()) errors.push(`${id} missing area`);
    if (!CATEGORIES.includes(event.category)) errors.push(`${id} category must be one of the four filter labels`);
    if (!event.price?.trim()) errors.push(`${id} missing price`);
    if (!event.url?.startsWith("https://")) errors.push(`${id} url must be an https link`);
    if (!event.source?.trim()) errors.push(`${id} missing source`);
    if (typeof event.isPick !== "boolean") errors.push(`${id} isPick must be true or false`);
    if (!(event.rating === null || (Number.isInteger(event.rating) && event.rating >= 1 && event.rating <= 5))) {
      errors.push(`${id} rating must be null or an integer 1–5`);
    }
    if (!(event.note === null || typeof event.note === "string")) errors.push(`${id} note must be a string or null`);
    const lat = event.lat;
    const lng = event.lng;
    if ((lat == null) !== (lng == null)) errors.push(`${id} lat and lng must both be numbers or both null`);
    if (lat != null && lng != null) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) errors.push(`${id} lat/lng must be finite`);
      else if (lat < 47 || lat > 48.2 || lng < -123 || lng > -121.5) {
        errors.push(`${id} lat/lng is outside the Puget Sound check (leave both null if you are not sure)`);
      }
    }
    if (event.allDay && event.occurrences?.length) errors.push(`${id} all-day events should not also list occurrences`);
    if (event.allDay) {
      if (!/T00:00:00/.test(event.start)) errors.push(`${id} all-day start should be local midnight`);
      if (!event.end || !/T23:59:59/.test(event.end)) errors.push(`${id} all-day end should be 23:59:59 on the last day`);
    }
    if (event.occurrences) {
      if (!Array.isArray(event.occurrences) || event.occurrences.length === 0) {
        errors.push(`${id} occurrences must be a non-empty array when present`);
      } else {
        for (const occurrence of event.occurrences) {
          if (!ISO_WITH_OFFSET.test(occurrence.start)) errors.push(`${id} has an occurrence with a bad start`);
          if (occurrence.end != null && !ISO_WITH_OFFSET.test(occurrence.end)) errors.push(`${id} has an occurrence with a bad end`);
          checkOffset(errors, id, occurrence.start);
          if (occurrence.end) checkOffset(errors, id, occurrence.end);
          if (occurrence.end && Date.parse(occurrence.end) < Date.parse(occurrence.start)) {
            errors.push(`${id} has an occurrence that ends before it starts`);
          }
        }
        const earliest = event.occurrences.reduce((best, item) => (Date.parse(item.start) < Date.parse(best.start) ? item : best));
        if (event.start !== earliest.start) errors.push(`${id} start should match the earliest occurrence`);
        const endsKnown = event.occurrences.every((item) => item.end);
        if (endsKnown) {
          const latest = event.occurrences.reduce((best, item) => (Date.parse(item.end ?? "") > Date.parse(best.end ?? "") ? item : best));
          if (event.end !== latest.end) errors.push(`${id} end should match the latest occurrence end`);
        } else if (event.end !== null) {
          errors.push(`${id} end should be null when any occurrence has no end`);
        }
      }
    }
  }
  return errors;
}

function checkOffset(errors: string[], id: string, iso: string): void {
  if (!ISO_WITH_OFFSET.test(iso)) return;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    errors.push(`${id} has a datetime that does not parse: ${iso}`);
    return;
  }
  const suffix = iso.slice(-6);
  let expected = "";
  try {
    expected = pacificOffset(parsed);
  } catch (error) {
    errors.push(`${id} ${error instanceof Error ? error.message : "offset check failed"}`);
    return;
  }
  if (suffix !== expected) {
    errors.push(`${id} ${iso} uses ${suffix} but Pacific Time at that instant is ${expected}`);
  }
}
