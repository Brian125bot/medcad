# Calendar sync (COR-79)

Status: **part 1 of 2: engine only, inert.** Part 1 adds the sync engine, the
storage hooks it needs and the app wiring. There is no Google sign-in, no
network client and no screen yet. The wired auth adapter reports
`not-configured`, so the engine never calls the API, but it still records
deletion tombstones so medications deleted before sign-in ships do not leave
orphaned events later. Part 2 adds Google OAuth (PKCE), the Calendar API
adapter and the settings screen.

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| Where events live | A dedicated secondary calendar, "CadenceRx refills", using only the `https://www.googleapis.com/auth/calendar.app.created` scope | That scope covers `calendars.insert/delete` and `events.insert/patch/delete` for calendars the app created, and nothing else in the account. Never the primary calendar |
| Event shape | **Timed**, 09:00–09:15 local on the civil `nextFillDate`, popup reminder at 0 minutes, `transparency: "transparent"` | Google reminder overrides count minutes **before** the event start (0–40320). An all-day event starts at 00:00, so it cannot carry a same-day 09:00 popup. A transparent timed event does not mark the user busy |
| Event text | Generic: "Medication refill" / "Refill due. Open CadenceRx to check your supply." The "Show medication names in calendar events" setting (default off) adds the name only | Google stores events and shows them on every device signed in to the account. Strength, purpose, prescriber, instructions and pharmacy note never leave the device under any setting |
| Overdue | `nextFillDate < today` makes no event and leaves an existing event alone | |
| Doses | Dose logging never triggers a sync (and never recomputes the fill date, per COR-94) | |
| Disconnect | Asks "Remove events" or "Keep events" (screen in part 2) | |
| Vault wipe | Deletes the remote calendar, best effort | See [limitation](#vault-wipe-limitation) |

## Architecture

```
storage commit ──► RepositoryChange ──► CalendarSyncEngine.handleChange
                                          │  (single-flight, dirty flag)
                                          ▼
          settings + medications + tombstones ──► planCalendarSync (pure)
                                          │
                                          ▼
                     CalendarApiPort (part 2: Google adapter)
                                          │
                                          ▼
              repository.recordCalendarSync (two fields, emits nothing)
```

| File | Role |
| --- | --- |
| `lib/calendar/settings.ts` | Pref keys (`calendar.sync.enabled`, `calendar.sync.showMedicationNames`, `calendar.sync.tombstones`, `calendar.sync.fingerprint`), strict parsing, tombstone cap (200, oldest dropped) |
| `lib/calendar/event-content.ts` | `buildEventContent`: the Google event body |
| `lib/calendar/fingerprint.ts` | `contentFingerprint({ showNames, timeZone })` |
| `lib/calendar/planner.ts` | `planCalendarSync`: ordered `SyncOp[]` |
| `lib/calendar/errors.ts` | Typed API errors and `classifyCalendarError` |
| `lib/calendar/ports.ts` | `CalendarApiPort`, `AccountStatePort`, `AuthPort`, `CalendarClockPort`, the repository subset |
| `lib/calendar/engine.ts` | `CalendarSyncEngine` |
| `lib/calendar/placeholder-adapters.ts` | Inert part-1 adapters (`not-configured` auth) |
| `lib/calendar/expo-clock.ts`, `index.ts` | Device clock and app wiring (`startCalendarSyncEngine`, `syncNow`, `syncAll`, `disconnect`, `useCalendarSyncStatus`) |

Screens (`app/`, `components/`, `hooks/`) import only `@/lib/calendar`; ESLint
and `tests/calendar-boundary.spec.ts` enforce it.

## State-driven plan plus tombstones

The engine does not replay a log of edits. Each pass compares what is stored
with what should exist:

- **eligible** = sync enabled, medication active, `nextFillDate` a valid date
  key and `>= today` (civil string comparison);
- eligible and unlinked → `create`;
- eligible, linked and (`isCalendarEventStale` or fingerprint changed or a
  forced "sync all") → `update`;
- linked but paused or with no fill date → `remove`;
- past-dated → nothing;
- every tombstone → `remove-tombstone`.

Order: removals, tombstones, updates, creates, each sorted by id.

A deleted medication's row (and its event id) is gone after commit, so
`deleteMedication` reads the plaintext `inventory_calendar_event_id` first and
puts it on the `medication-deleted` event. The engine appends it to the
`calendar.sync.tombstones` pref on an internal promise chain, whatever the
enabled or sign-in state, and a later pass deletes the event.

## Recording results

Results are written with `repository.recordCalendarSync(id, {
googleCalendarEventId, calendarSyncedFillDate })`, never `saveMedication`.
It runs under the single-writer gate, re-reads the row, changes only the
plaintext event-id column and the sealed `calendar_synced_fill_date`, returns
`false` for a deleted medication and **emits no change event** (so it cannot
re-trigger notifications, Cabinet reloads or this engine).

**Recorded-date rule:** the engine records the `fillDateKey` the op carried,
not a re-read date. If `nextFillDate` changes while the request is in flight,
the marker stays behind, `isCalendarEventStale` is true, and the edit's
`medication-saved` event runs another pass that updates the event.

Every `saveMedication` of an existing row (wizard edit, reminder settings,
refill, pause/resume) re-reads the row under the write gate and keeps the
**stored** calendar fields instead of the caller's snapshot, so a sync that
linked an event while an editor was open is not unlinked (which would make a
duplicate event on the next pass). `recordCalendarSync` is the only writer of
those fields after a row exists.

`deleteMedication` reads the event id inside the same gate, so a link recorded
just before the delete rides on the `medication-deleted` event. If a
medication is deleted between an insert and its record instead, the record
returns `false` and the engine tombstones the new event itself.

If the record **throws** after an insert (storage error), the engine deletes
the new event remotely before failing the pass; if that delete fails too, it
tombstones the id. Only a process kill between the insert response and the
record can still orphan an event (see part 2: client-chosen event ids).

## Renames

The fingerprint covers settings, not per-medication text. Every
`medication-saved` adds its id to a pending set; while names are shown, the
next pass updates those linked events (one patch per saved medication). With
names off the set is ignored. The set is kept until a pass ends `ok`.

## Fingerprint

`contentFingerprint` hashes the names setting and the device time zone. After
a fully successful pass it is stored in `calendar.sync.fingerprint`; a
different value on the next pass updates every linked event (names toggled,
or the device moved zones).

## Calendar recreation

`ensureCalendar(storedId)` returns the stored calendar if it still exists, or
creates one. If it had to create a calendar although an id was stored, or no
id was stored while medications carry event ids, every stored event id and
tombstone points into a calendar that no longer exists: they are cleared and
the pass replans (all creates).

## Status and failure classes

Status: `{ state, pendingCount, failedCount, lastSyncedAt }`, with `state` one
of `disabled`, `not-configured`, `signed-out`, `reauth-required`, `offline`,
`error`, `ok`.

| Error | Effect |
| --- | --- |
| `CalendarAuthError` | `reauth-required`, pass stops, nothing dropped |
| `CalendarNetworkError` | `offline`, pass stops |
| `CalendarRateLimitedError`, `CalendarServerError`, any untyped error | `error`, pass stops |
| `CalendarClientError` on one op | counted in `failedCount`, op skipped, pass continues; fingerprint not stored |

There are no timers: retry happens on the next trigger (start, a medication
save or delete, the two settings, app foreground, `syncNow`, `syncAll`).
`dose-changed` and every other pref (including the engine's own tombstone and
fingerprint writes) are ignored. The reminder engine ignores every
`calendar.*` pref in turn.

## Privacy

- Default event text is generic. Only the medication name can be added.
- `extendedProperties.private` is `{ cadencerx: '1', med: <medication UUID> }`.
- Logs carry a fixed message and an error **class name** only: never a
  medication name, a date, an event id, a token or a response body.
- Part 2 keeps the refresh token and calendar id in `expo-secure-store` under
  its own keychain service; the access token stays in memory. Nothing token
  related enters the vault or preferences.

## Disconnect

`disconnect({ removeEvents })`:

- **Remove events:** delete the remote calendar; then clear every
  medication's event id and synced date, the tombstones and the account state.
  If the remote delete fails (offline), nothing local changes and the result is
  `remote-delete-failed`, so the user can retry or keep the events.
- **Keep events:** keep the calendar id, event ids and synced dates so a
  reconnect resumes with no duplicates.
- Both: sign out and set `calendar.sync.enabled` to false.

## Vault wipe limitation

The vault wipe deletes the preference table and the medications, so event ids
are gone. The calendar id lives in the token store (part 2), not in a pref, so
on `vault-deleted` the engine calls `deleteCalendar` once, best effort, then
signs out and clears the account state. **If the device is offline at wipe
time, the "CadenceRx refills" calendar stays in the Google account** and the
user has to delete it in Google Calendar. There is no retry after a wipe.

## Testing

All in Node with fake ports (`tests/calendar-engine-fakes.ts`):

- `calendar-planner.spec.ts`, `calendar-event-content.spec.ts`,
  `calendar-settings.spec.ts` (settings, fingerprint pin, errors, placeholder
  adapters), `calendar-engine.spec.ts`, `calendar-boundary.spec.ts`;
- `repository-calendar.test.ts` (storage, `npm test`);
- the `calendar.*` case in `notification-reconciler.spec.ts`;
- `npm run test:tz` runs the event-content DST cases in six zones.

Nothing here has run on a device; part 1 is inert there.
