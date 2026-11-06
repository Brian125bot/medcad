# Cabinet (COR-78)

The Cabinet tab lists every medication with its current stock, a capacity
progress bar, and an estimate of days of supply remaining. It is where you
record a refill and see what is running low.

## Screen anatomy

- **Rows** for active medications, sorted out-of-stock first, then low-stock,
  then by days of supply remaining (fewest first), then by name.
- Each row shows the pill preview, name/strength, a units label, a supply bar, a
  days-left label, and an amber **low** or red **out** badge when supply is low.
- A collapsed read-only **Paused** section lists inactive medications.
- States: loading, empty ("Add a medication in Regimen to track its supply."), a
  dismissible save-error banner, and pull-to-retry on load error.

Test ids: `cabinet-row-<id>`, `cabinet-refill-30-<id>`,
`cabinet-refill-custom-<id>`, `refill-preset-<n>`, `refill-sheet-input`,
`refill-sheet-apply`, `refill-sheet-cancel`.

## The "low" rule

There is a single threshold, `LOW_SUPPLY_DAYS = 7`, shared by the badge and the
push. The **badge** is amber when stock is at or below `lowThresholdUnits` **or**
days of supply left is at or below 7 (red when out). The **push** uses days only:
a medication below the units threshold but with more than 7 days left gets the
badge and no alert.

## Days of supply

`estimateDaysOfSupplyRemaining(medication, todayKey)` in `lib/schedule/supply.ts`
walks the actual schedule (interval and day-specific slots), so the estimate
accounts for exactly how the medication is taken. `NO_CONSUMPTION_DAYS` (no
scheduled doses) renders no days-left label.

## Refill semantics

Refills are optimistic: stock updates in memory immediately, listeners fire
before the persist promise exists, then the write goes through
`MedicationRepository.refillMedication(id, units, todayKey, notes?)`. Persists are
serialized so concurrent refills cannot interleave. On failure only that refill's
own units roll back and `SAVE_ERROR_MESSAGE` is shown.

`lastRefilledAt` and the refresh `todayKey` are civil date keys (`toDateKey`),
never UTC slices. `refillMedication` rebuilds stock immutably and runs
`refreshNextFillDate`, so `nextFillDate` moves only when the refill changes the
shared supply projection; `googleCalendarEventId` and the sealed
`calendarSyncedFillDate` marker are carried for the calendar-sync ticket. Stock
above capacity is allowed; the bar caps at 100% while the number shows the true
units.

## Low-stock alerts

When projected supply crosses into the low band, the reminder engine schedules
one `cx.refill.` alert per episode at 09:00 local. See
[notifications.md](notifications.md#cor-78-low-stock-refill-alerts) for the
crossing rule, episode markers, cap, budget, revoke and tap routing.
