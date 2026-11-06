# Cabinet (COR-78)

The Cabinet tab lists every medication with its current stock, a capacity progress
bar, and an estimate of days of supply remaining. It is the place to record a
refill and to see what is running low.

## What it shows

- **Rows** for active medications, sorted out-of-stock first, then low-stock, then
  by days of supply remaining (fewest first), then by name.
- Each row shows the pill preview, name/strength, a units label, a supply bar, a
  days-left label, and an amber **low** or red **out** badge when supply is low.
- A collapsed read-only **Paused** section lists inactive medications.
- States: loading, empty ("Add a medication in Regimen to track its supply."), a
  dismissible save-error banner, and pull-to-retry on load error.

## Refill actions

- **+30** adds 30 units (or the medication's capacity preset) in one tap.
- **Refill…** opens a sheet with preset chips and a decimal input, validated by
  `parseRefillUnits` (rejects empty, non-finite, ≤ 0, or > `MAX_REFILL_UNITS`).
- Refills are optimistic: stock updates immediately and rolls back only its own
  units if the write fails, surfacing `SAVE_ERROR_MESSAGE`.

## Days of supply

`estimateDaysOfSupplyRemaining(medication, todayKey)` in `lib/schedule/supply.ts`
walks the actual schedule (interval and day-specific slots), so the estimate
accounts for exactly how the medication is taken. `NO_CONSUMPTION_DAYS` (no
scheduled doses) renders as no days-left label.

## Low-stock alerts

When a medication's projected supply crosses into the low band
(`LOW_SUPPLY_DAYS = 7`), the reminder engine schedules a single refill alert per
episode in the `cx.refill.` namespace at 09:00 local. See
`docs/notifications.md` for the crossing-date rule, episode markers, and budget.
