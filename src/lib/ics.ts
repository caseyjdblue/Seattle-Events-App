import {
  type EventRecord,
  type Occurrence,
  formatTime,
} from "./model.ts";

/** Shown in the .ics description when a single listing has no published end. */
export const UNKNOWN_END_NOTE =
  "End time was not published. This calendar hold lasts 2 hours from the listed start.";

/** Shown when several start-only times on the same day are combined into one hold. */
export const GROUPED_UNKNOWN_END_NOTE =
  "End times were not published. This hold starts at the first listed time and ends 2 hours after the last listed start.";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

type Block = {
  allDay: { start: string; endExclusive: string } | null;
  startMs: number;
  endMs: number | null;
  detail: string | null;
};

export function icsFilename(event: EventRecord): string {
  const slug = event.name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${event.id}-${slug || "event"}.ics`;
}

export function buildIcs(event: EventRecord, now = new Date()): string {
  const stamp = utcStamp(now.getTime());
  const blocks = icsBlocks(event);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Seattle Events//EN",
    "CALSCALE:GREGORIAN",
  ];
  blocks.forEach((block, index) => {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${event.id}-${index}@seattle-events.app`);
    lines.push(`DTSTAMP:${stamp}`);
    if (block.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${block.allDay.start}`);
      lines.push(`DTEND;VALUE=DATE:${block.allDay.endExclusive}`);
    } else if (block.endMs == null) {
      lines.push(`DTSTART:${utcStamp(block.startMs)}`);
      lines.push("DURATION:PT2H");
    } else {
      lines.push(`DTSTART:${utcStamp(block.startMs)}`);
      lines.push(`DTEND:${utcStamp(block.endMs)}`);
    }
    lines.push(prop("SUMMARY", event.name));
    lines.push(prop("LOCATION", `${event.venue}, ${event.area}`));
    const description = descriptionFor(event, block);
    if (description) lines.push(prop("DESCRIPTION", description));
    lines.push(prop("URL", event.url));
    if (event.lat != null && event.lng != null) lines.push(`GEO:${event.lat};${event.lng}`);
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

function descriptionFor(event: EventRecord, block: Block): string {
  const parts: string[] = [];
  if (block.detail) parts.push(block.detail);
  if (event.note) parts.push(event.note);
  parts.push(`Price: ${event.price}`);
  if (!block.allDay && block.endMs == null) parts.push(UNKNOWN_END_NOTE);
  parts.push(`Event page: ${event.url}`);
  return parts.join("\n");
}

function icsBlocks(event: EventRecord): Block[] {
  if (event.allDay && !event.occurrences?.length) {
    const start = event.start.slice(0, 10).replaceAll("-", "");
    const last = (event.end ?? event.start).slice(0, 10);
    const endExclusive = addDaysKey(last, 1).replaceAll("-", "");
    return [{ allDay: { start, endExclusive }, startMs: Date.parse(event.start), endMs: null, detail: null }];
  }
  const occurrences: Occurrence[] = event.occurrences?.length
    ? event.occurrences
    : [{ start: event.start, end: event.end }];
  const byDay = new Map<string, Occurrence[]>();
  for (const occurrence of occurrences) {
    const day = occurrence.start.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(occurrence);
    byDay.set(day, list);
  }
  const blocks: Block[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const sorted = [...(byDay.get(day) ?? [])].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    if (sorted.every((occurrence) => occurrence.end)) {
      for (const occurrence of sorted) {
        blocks.push({
          allDay: null,
          startMs: Date.parse(occurrence.start),
          endMs: Date.parse(occurrence.end ?? occurrence.start),
          detail: null,
        });
      }
      continue;
    }
    let cluster: Occurrence[] = [];
    const flush = () => {
      if (!cluster.length) return;
      if (cluster.length > 1 && cluster.every((occurrence) => !occurrence.end)) {
        const times = cluster.map((occurrence) => formatTime(occurrence.start)).join(", ");
        const last = cluster[cluster.length - 1];
        blocks.push({
          allDay: null,
          startMs: Date.parse(cluster[0].start),
          endMs: Date.parse(last.start) + TWO_HOURS_MS,
          detail: `Listed start times: ${times}. ${GROUPED_UNKNOWN_END_NOTE}`,
        });
      } else {
        for (const occurrence of cluster) {
          blocks.push({
            allDay: null,
            startMs: Date.parse(occurrence.start),
            endMs: occurrence.end ? Date.parse(occurrence.end) : null,
            detail: null,
          });
        }
      }
      cluster = [];
    };
    for (const occurrence of sorted) {
      if (!cluster.length) {
        cluster.push(occurrence);
        continue;
      }
      const previous = cluster[cluster.length - 1];
      const gap = Date.parse(occurrence.start) - Date.parse(previous.start);
      if (gap >= TWO_HOURS_MS) flush();
      cluster.push(occurrence);
    }
    flush();
  }
  return blocks;
}

function addDaysKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, "0");
  const d = String(next.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function utcStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function esc(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll(",", "\\,").replaceAll(";", "\\;");
}

function prop(name: string, value: string): string {
  return `${name}:${esc(value)}`;
}

/** Fold a content line at 75 octets, per the iCalendar spec. */
export function fold(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let currentLen = 0;
  let limit = 75;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (current.length > 0 && currentLen + size > limit) {
      parts.push(current);
      current = "";
      currentLen = 0;
      limit = 74;
    }
    current += ch;
    currentLen += size;
  }
  if (current) parts.push(current);
  return parts.map((part, index) => (index === 0 ? part : ` ${part}`)).join("\r\n");
}
