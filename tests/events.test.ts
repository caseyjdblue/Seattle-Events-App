import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildIcs, UNKNOWN_END_NOTE } from "../src/lib/ics.ts";
import {
  type EventFile,
  type EventRecord,
  coversDay,
  distanceMiles,
  eventsOnDay,
  monthCells,
  orderByDistance,
  partitionByPick,
  seattleDateKey,
  spanHint,
  timeLabelForDay,
  validateEvents,
} from "../src/lib/model.ts";

const file = JSON.parse(readFileSync(new URL("../data/events.json", import.meta.url), "utf8")) as EventFile;
const events = file.events;

function idsOn(day: string): string[] {
  return events.filter((event) => coversDay(event, day)).map((event) => event.id).sort();
}

test("seed file has the 28 week-1 picks and passes the schema checks", () => {
  assert.equal(file.timezone, "America/Los_Angeles");
  assert.equal(events.length, 28);
  assert.deepEqual(validateEvents(file), []);
  assert.ok(events.every((event) => event.isPick));
  const ratings = Object.fromEntries(events.map((event) => [event.id, event.rating]));
  assert.equal(ratings["W1-1"], 3);
  assert.equal(ratings["W1-2"], 2);
  assert.equal(ratings["W1-3"], 4);
  assert.equal(ratings["W1-4"], 4);
  assert.equal(ratings["W1-5"], 2);
  assert.equal(ratings["W1-6"], null);
  assert.equal(events.filter((event) => event.rating != null).length, 5);
  assert.equal(events.find((event) => event.id === "W1-12")?.lat, null);
  assert.equal(events.find((event) => event.id === "W1-32")?.start.endsWith("-08:00"), true);
  assert.equal(events.find((event) => event.id === "W1-17")?.end?.endsWith("-07:00"), true);
});

test("events land on the right Pacific days, including ranges and midnight ends", () => {
  assert.deepEqual(idsOn("2026-10-23"), []);
  assert.deepEqual(idsOn("2026-10-24"), ["W1-1", "W1-12", "W1-19", "W1-2", "W1-23", "W1-24", "W1-29", "W1-3", "W1-4", "W1-5", "W1-7"]);
  assert.deepEqual(idsOn("2026-10-25"), ["W1-1", "W1-12", "W1-2", "W1-20", "W1-23", "W1-25", "W1-26", "W1-6", "W1-7", "W1-8", "W1-9"]);
  assert.deepEqual(idsOn("2026-10-26"), ["W1-12", "W1-20", "W1-21", "W1-23"]);
  assert.deepEqual(idsOn("2026-10-27"), ["W1-12", "W1-23"]);
  assert.deepEqual(idsOn("2026-10-28"), ["W1-12", "W1-23", "W1-30"]);
  assert.deepEqual(idsOn("2026-10-29"), ["W1-12", "W1-22", "W1-23"]);
  assert.deepEqual(idsOn("2026-10-30"), ["W1-12", "W1-14", "W1-23", "W1-27"]);
  assert.deepEqual(idsOn("2026-10-31"), ["W1-12", "W1-16", "W1-17", "W1-18", "W1-23", "W1-28", "W1-31"]);
  assert.deepEqual(idsOn("2026-11-01"), ["W1-18", "W1-32"]);
  assert.deepEqual(idsOn("2026-11-02"), []);
});

test("time labels keep different hours, all-day runs, and unknown ends", () => {
  const byId = (id: string) => events.find((event) => event.id === id) as EventRecord;
  assert.equal(timeLabelForDay(byId("W1-1"), "2026-10-24"), "All day");
  assert.equal(timeLabelForDay(byId("W1-2"), "2026-10-24"), "10:00 AM–6:00 PM");
  assert.equal(timeLabelForDay(byId("W1-2"), "2026-10-25"), "11:00 AM–4:00 PM");
  assert.equal(timeLabelForDay(byId("W1-19"), "2026-10-24"), "10:00 AM–11:30 AM");
  assert.match(timeLabelForDay(byId("W1-7"), "2026-10-25"), /7:00 PM, 7:30 PM, 8:00 PM, 8:30 PM/);
  assert.match(timeLabelForDay(byId("W1-24"), "2026-10-24"), /6:00 PM–7:30 PM/);
  assert.match(timeLabelForDay(byId("W1-24"), "2026-10-24"), /8:30 PM–10:00 PM/);
  assert.equal(timeLabelForDay(byId("W1-23"), "2026-10-31"), "12:00 PM–5:00 PM");
  assert.equal(timeLabelForDay(byId("W1-32"), "2026-11-01"), "2:00 PM–4:00 PM");
  assert.equal(spanHint(byId("W1-20"), "2026-10-25"), "Also Mon, Oct 26");
  assert.match(spanHint(byId("W1-12"), "2026-10-24") ?? "", /Runs Sat, Oct 24 – Sat, Oct 31/);
});

test("filters and pick partitioning", () => {
  assert.deepEqual(eventsOnDay(events, "2026-10-24", ["Outdoors & hikes"], []).map((event) => event.id), ["W1-19"]);
  assert.deepEqual(eventsOnDay(events, "2026-10-24", [], ["Redmond"]).map((event) => event.id), ["W1-29"]);
  assert.deepEqual(eventsOnDay(events, "2026-10-24", [], ["Bellevue"]).map((event) => event.id), ["W1-24"]);
  assert.equal(eventsOnDay(events, "2026-10-24", [], ["Seattle"]).length, 9);
  assert.equal(eventsOnDay(events, "2026-10-25", ["Outdoors & hikes"], ["Shoreline"]).map((event) => event.id).join(), "W1-9");
  const sample = events[0];
  const other: EventRecord = { ...sample, id: "X", isPick: false, name: "Not a pick" };
  const grouped = partitionByPick([other, sample]);
  assert.deepEqual(grouped.picks.map((event) => event.id), [sample.id]);
  assert.deepEqual(grouped.others.map((event) => event.id), ["X"]);
});

test("near me sorts by distance and leaves citywide events unlocated", () => {
  const today = eventsOnDay(events, "2026-10-24", [], []);
  const ordered = orderByDistance(today, { lat: 47.6081, lng: -122.337 });
  assert.equal(ordered.located[0]?.event.id, "W1-3");
  assert.ok(ordered.unknown.some((event) => event.id === "W1-12"));
  const phil = ordered.located.find((item) => item.event.id === "W1-3");
  const diwali = ordered.located.find((item) => item.event.id === "W1-29");
  assert.ok(phil && diwali && phil.miles < 0.2 && diwali.miles > 5);
  const benaroya = { lat: 47.6081, lng: -122.337 };
  const neptune = { lat: 47.6611, lng: -122.314 };
  const miles = distanceMiles(benaroya, neptune);
  assert.ok(miles > 3 && miles < 6);
});

test("calendar grid for October 2026 starts on Thursday", () => {
  const cells = monthCells(2026, 10);
  assert.equal(cells[4], "2026-10-01");
  assert.equal(cells[0], null);
  assert.equal(new Date(Date.UTC(2026, 9, 24)).getUTCDay(), 6);
  assert.equal(seattleDateKey(new Date("2026-10-24T15:00:00Z")), "2026-10-24");
  assert.equal(seattleDateKey(new Date("2026-10-24T06:00:00Z")), "2026-10-23");
});

function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, "");
}

test("ics files use real ends, all-day dates, and a 2-hour hold when the end is unknown", () => {
  const byId = (id: string) => events.find((event) => event.id === id) as EventRecord;
  const now = new Date("2026-10-24T15:00:00Z");

  const coffee = unfold(buildIcs(byId("W1-1"), now));
  assert.match(coffee, /DTSTART;VALUE=DATE:20261024/);
  assert.match(coffee, /DTEND;VALUE=DATE:20261026/);
  assert.equal(coffee.split("BEGIN:VEVENT").length - 1, 1);

  const week = unfold(buildIcs(byId("W1-12"), now));
  assert.match(week, /DTEND;VALUE=DATE:20261101/);
  assert.doesNotMatch(week, /GEO:/);

  const book = unfold(buildIcs(byId("W1-2"), now));
  assert.equal(book.split("BEGIN:VEVENT").length - 1, 2);
  assert.match(book, /DTSTART:20261024T170000Z/);
  assert.match(book, /DTEND:20261025T010000Z/);
  assert.match(book, /DTSTART:20261025T180000Z/);
  assert.match(book, /DTEND:20261025T230000Z/);

  const philRaw = buildIcs(byId("W1-3"), now);
  const phil = unfold(philRaw);
  assert.match(phil, /DTSTART:20261024T210000Z/);
  assert.match(phil, /DURATION:PT2H/);
  assert.match(phil, new RegExp(UNKNOWN_END_NOTE.replace(/[.]/g, "\\.")));
  assert.match(phil, /GEO:47\.6081;-122\.337/);
  assert.match(phil, /DTSTAMP:20261024T150000Z/);

  const circus = unfold(buildIcs(byId("W1-7"), now));
  assert.equal(circus.split("BEGIN:VEVENT").length - 1, 2);
  assert.match(circus, /Listed start times: 7:00 PM\\, 7:30 PM\\, 8:00 PM\\, 8:30 PM/);
  assert.match(circus, /DTSTART:20261025T020000Z/);
  assert.match(circus, /DTEND:20261025T053000Z/);

  const messer = unfold(buildIcs(byId("W1-23"), now));
  assert.equal(messer.split("BEGIN:VEVENT").length - 1, 8);

  const chicks = unfold(buildIcs(byId("W1-20"), now));
  assert.equal(chicks.split("BEGIN:VEVENT").length - 1, 2);
  assert.match(chicks, /DURATION:PT2H/);

  const drawing = unfold(buildIcs(byId("W1-32"), now));
  assert.match(drawing, /DTSTART:20261101T220000Z/);
  assert.match(drawing, /DTEND:20261102T000000Z/);

  for (const line of philRaw.split("\r\n")) {
    assert.ok(Buffer.byteLength(line) <= 75, line);
  }
  assert.ok(philRaw.endsWith("\r\n"));
});
