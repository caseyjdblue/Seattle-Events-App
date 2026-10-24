# Seattle Events

A mobile-first, installable web app for Seattle-area events. It is a static site: no sign-in, no backend, and no paid APIs. Quinn's picks are marked and, on the today view, listed first. Friends and family only need the link.

Expected site: [https://caseyjdblue.github.io/Seattle-Events-App/](https://caseyjdblue.github.io/Seattle-Events-App/)

## Enable GitHub Pages

The repo has to be **public** for free GitHub Pages. This one already is. If it is ever made private, the free site will stop.

1. Open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Merge to `main`. The workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) tests, builds, and deploys.
4. When the **Deploy GitHub Pages** workflow is green, the site is at the URL above.

The Pages base path is `/Seattle-Events-App/`, set in `vite.config.ts`. If the repository is renamed, change that `base` to the new name and push to `main` again.

## Run locally

Node 22 is required (`npm test` uses the built-in TypeScript runner).

```bash
npm install
npm test
npm run dev
```

Open [http://localhost:5173/Seattle-Events-App/](http://localhost:5173/Seattle-Events-App/). The `/Seattle-Events-App/` prefix matches the GitHub Pages URL.

```bash
npm run build
npm run preview
```

Preview serves the production build at [http://127.0.0.1:4173/Seattle-Events-App/](http://127.0.0.1:4173/Seattle-Events-App/).

## Update the week

Each Monday, edit **`data/events.json`** and commit it to `main`. That file is the only source of events. The app imports it at build time, and the Pages workflow publishes the new build.

Keep the top-level `timezone` as `America/Los_Angeles`. Update `weekOf` and `through` to the new window. Replace the `events` array. Do not invent prices or URLs; copy them from the event page. Run `npm test` before pushing. The same checks run in GitHub Actions, and a bad file fails the deploy.

`npm test` checks the schema, the Pacific offset, which days each event appears on, and the calendar files.

## Event schema

`data/events.json` looks like this:

```json
{
  "timezone": "America/Los_Angeles",
  "weekOf": "2026-10-24",
  "through": "2026-11-01",
  "about": "Short note for the next editor. The app ignores this field.",
  "events": []
}
```

Each event:

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Unique string, such as `W1-3`. |
| `name` | yes | Event name, as published. |
| `start` | yes | ISO datetime with a Pacific offset, such as `2026-10-24T14:00:00-07:00`. |
| `end` | yes | Same shape, or `null` when the end was not published. |
| `allDay` | yes | `true` for a date range with no hours (festivals, Restaurant Week). `false` otherwise. |
| `occurrences` | no | Extra start/end pairs when one interval would be wrong. Omit it for a single interval. |
| `venue` | yes | Place name. |
| `area` | yes | `Seattle`, `Bellevue`, `Redmond`, or another label such as `Shoreline`. |
| `category` | yes | One of the four labels below, copied exactly. |
| `price` | yes | Price text from the source. Use the source's own "not listed" wording rather than guessing. |
| `url` | yes | `https` link to that event's own page (tickets or registration). |
| `source` | yes | Short site label, such as `seattlephil.org`. |
| `isPick` | yes | `true` if it is one of Quinn's picks. Picks are badged and sorted first on Today. |
| `rating` | yes | `null`, or an integer `1` through `5`. A dash in a notes sheet means `null`. |
| `note` | yes | String, or `null`. Doors, age limits, and source caveats go here. |
| `lat`, `lng` | yes | Approximate decimal degrees, or `null` for both. Never set just one. |

Categories, exactly:

- `Live music & shows` (concerts and other shows)
- `Food & drink / markets`
- `Outdoors & hikes` (includes nature events such as the mushroom show)
- `Arts & culture`

Area filters are Seattle, Bellevue, and Redmond (Marymoor Park is `Redmond`). Any other `area` still appears when **All** areas is selected. Shoreline is the current example.

### Times

Write the civil time in `America/Los_Angeles` and put the offset in the string:

- Pacific Daylight Time is `-07:00`.
- Pacific Standard Time is `-08:00`.
- In 2026 the clocks fall back at 2:00am on Sunday Nov 1. A time before that, including midnight at the end of Oct 31, is still `-07:00`. A time at or after 2:00am is `-08:00`.

`npm test` rejects an offset that does not match Pacific Time at that instant.

Use the show time as `start` when the listing separates doors and showtime, and put the door time in `note`. If the end is not published, set `end` to `null`. Do not guess a runtime.

### One interval, a range, or several occurrences

- One sitting: set `start` and `end` (or `end: null`). Leave `occurrences` out. Example: the philharmonic at 2:00pm.
- All-day or multi-day with no hours: `allDay: true`, `start` at local midnight on the first day, `end` at `23:59:59` on the last day. The event shows on every day from the first through the last. Example: Seattle Restaurant Week, Sat Oct 24 through Sat Oct 31. There is no map point when the listing is citywide, so `lat` and `lng` are `null`.
- Different hours, separate shows, or the same hours on many days: add `occurrences`, one object per sitting, with its own `start` and `end`. Set the event's `start` to the earliest occurrence start. If every occurrence has an end, set `end` to the latest occurrence end; otherwise `end` is `null`. Occurrences do not fill the gaps between them. Example: the book fair is 10am–6pm Saturday and 11am–4pm Sunday. The Chicks are two nights at 8:30pm, not an all-day span. Melissa Messer is 12–5pm each day Oct 24–31, not overnight.

An event that ends exactly at local midnight (for example 8pm–12am) uses `end` of the next date at `T00:00:00` with that night's offset. It does not show on the next calendar day.

### Add to calendar

Each event has an **Add to calendar** button that downloads an `.ics` file.

- Known start and end are written as those times, in UTC.
- All-day ranges use date-only values. The end date in the file is the day after the last listed day, which is what calendar apps expect.
- A single listing with no end becomes a **2-hour** hold. The description says the end was not published.
- Several start-only times close together on the same day (the steam-plant tours, every 30 minutes) become one hold from the first start until **2 hours after the last listed start**, and the description lists each start time.
- Two start-only shows at least 2 hours apart (Candlelight at 6:30pm and 8:45pm) stay separate 2-hour holds.

### Near me

**Near me** is on the today view. It does nothing until someone taps it. The app then explains that the browser will ask for location, and only the confirm button calls geolocation. Coordinates are used to sort today's list and are not stored or uploaded. Events with `lat` and `lng` of `null` stay at the bottom as "Distance not listed."

Approximate coordinates are rounded to 4 decimal places. Leave both null when the venue is not a single place or the location is not clear.

### Ratings and the chat placeholder

A rating of 1–5 shows as a badge (`4/5`). `null` shows no badge.

**Ask about events (coming soon)** is a disabled button on the home page. It is only a placeholder for a later chat feature.

## Layout

- `data/events.json` — the weekly event list
- `src/` — the Vite + TypeScript app
- `public/` — web app manifest, service worker, and icons
- `tests/events.test.ts` — schema, dates, and calendar-file checks
- `.github/workflows/pages.yml` — test, build, and deploy to GitHub Pages
