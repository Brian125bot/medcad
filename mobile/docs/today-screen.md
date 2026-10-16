# Today screen (COR-74)

The Today tab shows the selected day's doses, lets the user log them, and keeps
the header's progress ring and streak in step with every change.

## Layers

| Layer | File | Notes |
| --- | --- | --- |
| View model (pure) | `lib/today/today-view-model.ts` | Medications + logs + `todayKey` + `selectedDateKey` + `nowTime` → sections, progress, streak, empty states, supply warnings, card actions. No clock, no React. |
| Controller (pure) | `lib/today/today-store.ts` | `TodayStore`: in-memory medications and `DoseLogMap`, optimistic actions, rollback, undo snackbar entry, clock sync. Takes a `TodayRepository` (the slice of `MedicationRepository` it uses) and an injectable clock. |
| React binding | `hooks/useTodaySchedule.ts` | One shared store (`getTodayStore`), `useSyncExternalStore`, focus/foreground reload, minute tick, midnight timer. `useTodayPendingCount` feeds the tab badge. |
| UI | `app/(tabs)/today.tsx`, `components/today/*` | Header + date strip + `ProgressRing`, `DoseSectionList` / `DoseCard`, `SkipReasonSheet`, banners and the undo snackbar. |

Both pure modules are in the vitest 100 % coverage gate (`tests/today-schedule.spec.ts`).

## Rules

- **Dates.** `todayKey` comes from `toDateKey(clock())`; the selected day is a
  date key from the strip. No `toISOString()` anywhere. The strip covers the
  last 7 days ending today; `selectDate` rejects invalid keys and future days.
- **Rollover.** The hook calls `store.syncClock()` every minute, at local
  midnight (+1 s), on tab focus and when `AppState` becomes `active`. If the user
  was looking at today, the view follows the new today; a past day stays put.
- **Grouping.** Sections use the slot's own `label` (`Morning`, `Midday`,
  `Evening`, `Bedtime`), in that order, doses by time inside.
- **Streak / adherence** come from `computeAdherenceAnalytics(medications, logs, todayKey)`
  on every render of a changed state. Nothing is cached, so retroactive edits
  and undo show at once. `todayComplete` = every dose today handled and at least
  one taken.

## Actions

| Card state | Buttons | Swipe right | Swipe left |
| --- | --- | --- | --- |
| `pending` | Take · Skip | take (haptic) | skip-reason sheet |
| `missed` (past, unlogged) | Log as taken · Mark skipped | take | skip-reason sheet |
| `taken` | Undo | — | — |
| `skipped` | Take instead · Undo | take | — |

**Take all** appears on the active block of today (the latest block whose time
has come that still has unlogged doses, else the first one with unlogged doses)
and logs every unlogged dose in it as one undoable action.

Every action:

1. updates `logs` synchronously (the screen re-renders in the same frame);
2. sets the undo snackbar entry (`state.undo`, auto-hides after 5 s);
3. persists through `logDose` / `undoDose` — stock is decremented / refunded in
   the same SQLite transaction (COR-71) and the returned medication replaces
   the in-memory one;
4. on rejection rolls that dose back (only if no newer action on the same dose
   happened since), shows `SAVE_ERROR_MESSAGE` and drops the undo entry.

Undo from the snackbar restores each dose's **previous log** (e.g. skipped with
a note), not just "pending". A reload while writes are in flight re-applies them,
and is retried if a write settles mid-read.

Haptics: `notificationAsync(Success)` on take / take all, `selectionAsync` on
skip. Failures (e.g. web) are ignored.

## Not done / known limits

- **Snooze** is not offered: there is no reminder scheduler yet (COR-76). The
  swipe-left sheet only skips, with an optional reason saved as the log note.
- Undo of a take refunds the slot's *current* dose units
  ([roadmap gap 4](roadmap.md#known-gaps-and-sharp-edges)).
- Not run on a device: the app doesn't bundle (COR-90). Gestures, haptics and
  the ring animation are type-checked only.
