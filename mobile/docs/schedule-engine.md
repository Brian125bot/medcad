# CadenceRx Mobile — Schedule Engine (COR-72)

The pure-TypeScript module in `lib/schedule/` that answers: *is this medication
due on this day, what is the state of each dose, how is adherence going, and
when will the supply run out?* Screens (Today, Insights, Cabinet) and the
notification engine consume it; none of them should re-implement any of this.

**Import only from the public index:** `import { … } from '@/lib/schedule'`
(`lib/schedule/index.ts` — its header comment is the canonical short spec).

## Design contract

- **Pure.** No React Native, Expo, storage or I/O imports. Safe in plain Node.
- **No hidden clock.** "Today" is always an explicit `todayKey` argument
  (`YYYY-MM-DD`, local calendar date). Callers compute it once with
  `toDateKey(new Date())`.
- **Local calendar days, not instants.** All day maths uses serial civil-day
  numbers (`dateKeyToDayNumber`, Hinnant's days-from-civil algorithm). It never
  divides milliseconds and never parses `YYYY-MM-DD` with `new Date()`, so a
  23-hour spring-forward day, a 25-hour fall-back day, leap days, and a device
  time-zone change between logging and reporting cannot shift a result.
- **Strict input handling.** Invalid date keys throw `RangeError` in the
  low-level utilities; the high-level rules return `false`/safe values instead
  of leaking `NaN`.
- **Exhaustive.** Frequency handling ends in `assertNever`, so adding a
  `ScheduleFrequency` variant is a compile error until every rule handles it.

## Public API

| Function | Module | What it does |
| --- | --- | --- |
| `toDateKey`, `parseDateKey`, `addDaysToKey`, `diffDaysBetweenKeys`, `getDayOfWeek`, `isValidDateKey`, `isLeapYear`, `daysInMonth`, `dateKeyToDayNumber`, `dayNumberToDateKey` | `date-keys.ts` | Calendar arithmetic on date keys. `parseDateKey` returns a *noon-local* `Date` purely for UI interop (noon exists on every DST day). |
| `isMedicationScheduledOnDate(med, dateKey)` | `frequency.ts` | Is this medication due on that day? |
| `normalizeIntervalDays(n)`, `assertNever` | `frequency.ts` | Helpers (interval fallback; exhaustiveness guard). |
| `getScheduledDosesForDate(meds, logs, dateKey, todayKey)` | `doses.ts` | Expands every slot of every medication due that day into a `ScheduledDoseInstance` with its effective status, sorted by slot `time`. |
| `buildDoseKey(dateKey, medId, slotId)` | `doses.ts` | `` `${dateKey}_${medId}_${slotId}` `` — the `dose_logs` primary key. |
| `computeAdherenceAnalytics(meds, logs, todayKey)` | `analytics.ts` | 7/30-day adherence, current/best streak, breakdown by time-of-day and by medication. |
| `estimateDaysOfSupplyRemaining(med, todayKey)` | `supply.ts` | Days until stock can't cover the next scheduled day. |
| `computeRecommendedNextFillDate(med, todayKey)` | `supply.ts` | Two days before depletion (or today). |
| `getScheduledDayUnits(med, dateKey)` | `supply.ts` | Total dose units scheduled that day. |
| `MAX_STREAK_LOOKBACK_DAYS` (3660), `MAX_PROJECTION_DAYS` (36500), `NO_CONSUMPTION_DAYS` (999) | | Bounds and sentinel. |

## Rules

### Is a medication due? (`frequency.ts`)

A medication is **never** due when it is inactive (`active: false`), when either
date key is invalid, or on a date before `startDate`. Otherwise:

| `frequency` | Due when |
| --- | --- |
| `daily` | every day on/after `startDate` |
| `specific_days` | the local weekday (0 = Sunday … 6 = Saturday) is in `daysOfWeek`; a missing or empty list is never due |
| `interval` | `(dateKey − startDate) % N === 0`, where `N = intervalDays \|\| 2`, clamped to ≥ 1. Missing / 0 / NaN → every 2 days; 1 → every day; a huge N → the anchor day, then every N days |

### Dose status (`doses.ts`)

| Situation | `effectiveStatus` |
| --- | --- |
| A log exists | the log's status (`taken` / `skipped` / `missed`) |
| No log, `dateKey` is before `todayKey` | `missed` |
| No log, today or a future day | `pending` |

### Adherence and streaks (`analytics.ts`)

Window: the 30 days ending today (`-29…0`); `sevenDayAdherencePct` is the same
over `-6…0`. Percentages are `taken / scheduled`, rounded; an empty bucket
reports **100**.

- **Today's `pending` doses are excluded** from the denominator, so an
  unstarted evening dose doesn't drag the rate down. Anything *logged* today
  counts.
- **A `skipped` dose lowers the percentage.** It counts in `totalScheduled30d`
  but not in `totalTaken30d`, so 1 taken + 1 skipped reads **50 %** (verified).
  It is tallied separately in `totalSkipped30d` rather than `totalMissed30d`,
  which is the only sense in which it is "not a miss". (The header comment in
  `analytics.ts` says skipped doses "are not misses for the adherence rate";
  that wording is easy to misread — the numbers above are what the code does.)
- **Streak scan** runs from the earliest valid medication `startDate` (on or
  before today) through today, clipped to `MAX_STREAK_LOOKBACK_DAYS` (~10
  years; longer histories *saturate* at the bound rather than scanning
  unboundedly). Medications with an invalid or future `startDate` don't move
  the scan start.
- A scheduled day **extends** the streak only if every dose is `taken` or
  `skipped` **and at least one is `taken`**.
- A day with **no scheduled doses** neither extends nor breaks the streak.
- A past day where everything was **skipped** (none `taken`) **resets** the
  streak to 0. This matches the web app and is intentional — a skipped-only
  day is "handled" but not "adhered".
- **Today** never breaks the streak while incomplete (`pending` doses keep
  yesterday's count); once fully handled with ≥ 1 `taken`, it extends it.
  A today with no scheduled doses keeps yesterday's running streak.

### Supply (`supply.ts`)

`estimateDaysOfSupplyRemaining` walks the **real schedule forward** from
`todayKey` (today inclusive), subtracting each scheduled day's `doseUnits`:

- `currentUnits <= 0` → `0`.
- No scheduled consumption (inactive, empty `daysOfWeek`, no slots) →
  `NO_CONSUMPTION_DAYS` (999).
- Otherwise the day offset of the first scheduled day the stock can't cover.
- Walk is capped at `MAX_PROJECTION_DAYS` as a termination guard.

`computeRecommendedNextFillDate` = today + `max(0, daysLeft − 2)`.

Callers deciding on refills should skip inactive medications explicitly; an
inactive medication reports the 999 sentinel, which is *not* "plenty of supply".

## Intentional differences from the web implementation

The engine was ported from the web app's `lib/medication-data.ts`, with web
behaviour pinned first (characterization tests) and then reproduced except for
these deliberate changes:

| Area | Web | Mobile |
| --- | --- | --- |
| Supply estimate | flat average (`activeDaysPerWeek / 7`) | forward simulation of the actual schedule (e.g. Monday-only, 7 units, starting Sunday: web 49, mobile 50) |
| Invalid date key / start date | `NaN` leaks through; `daily` returned `true` | returns `false` / throws `RangeError` |
| Unknown frequency | silently `true` | throws via `assertNever` |
| Day difference | millisecond division | serial civil-day subtraction |
| Streak depth | fixed `-45…0` window (46 days) | full history, bounded at 3660 days |
| Today with no scheduled doses | `currentStreakDays` reads 0 (verified: two complete days, empty today → web 0, mobile 2) | yesterday's running streak is preserved |

Histories of 46 days or fewer must match the web module exactly; the parity
tests enforce it.

## Tests

All under `mobile/tests/*.spec.ts`, run by vitest with **100 % line / branch /
function / statement coverage required** on `lib/schedule/**` (and
`lib/wizard/**`) — see [development.md](development.md#testing).

| File | Purpose |
| --- | --- |
| `schedule-characterization.spec.ts` | Pins the *web* module's current outputs over an input matrix (the oracle). Imports `../../lib/medication-data` from the repo root. |
| `schedule-parity.spec.ts` | Asserts the ported API reproduces those outputs, except the documented divergences above. Also imports the web module. |
| `schedule-date-keys.spec.ts` | Every branch of the date utilities, leap years, DST days. |
| `schedule-frequency.spec.ts`, `-doses.spec.ts`, `-supply.spec.ts`, `-analytics.spec.ts` | Unit tests per module (analytics includes 46/47/90/400-day streak-depth cases). |

`npm run test:tz` re-runs the whole vitest suite in six time zones (UTC,
America/Chicago, America/New_York, Pacific/Auckland, Asia/Kolkata,
Pacific/Honolulu) so DST and half-hour-offset bugs can't hide on a developer's
home zone.

## Extending it

1. **New frequency type:** add the variant to `ScheduleFrequency`
   (`lib/domain/medication-data.ts`); the compiler will point at
   `isMedicationScheduledOnDate`'s `assertNever`. Update the wizard
   (`lib/wizard/medication-form.ts`, `MedicationWizard.tsx`), the mapper
   columns in `lib/storage/` if it needs new fields, and add tests.
2. **New date arithmetic:** add it to `date-keys.ts` and export it from
   `index.ts`; keep it free of `Date` parsing and ms division.
3. **Anything new must keep `npm run test:schedule` at 100 % coverage** or the
   run fails.
