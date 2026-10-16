# CadenceRx Mobile — Add / Edit Medication Wizard (COR-75)

A four-step form that creates or edits a `Medication`. The logic lives in a
pure module (`lib/wizard/medication-form.ts`, 100 % test-covered); the React
Native screens are thin.

| Piece | Path |
| --- | --- |
| Form state, validation, mapping | `lib/wizard/medication-form.ts` |
| Wizard UI (steps, chips, swatches, inputs) | `components/medication-wizard/MedicationWizard.tsx` |
| Native date / time picker | `components/medication-wizard/NativePickerField.tsx` |
| Live pill preview (SVG) | `components/medication-wizard/PillPreview.tsx` |
| Entry points | `app/(tabs)/regimen.tsx` (Regimen tab: list; rows open edit), the shared tab header's "+ Add" (every tab), `app/medication/new.tsx`, `app/medication/[id].tsx` (both presented as modals) |
| Tests | `tests/wizard-medication-form.spec.ts` (logic only — see [Testing](#testing)) |

## Flow

```
Basic info → Pill look → Schedule → Inventory → "Add medication" / "Save changes"
```

- **Next** validates the current step only; errors show inline and the step
  doesn't advance.
- Once a step has shown errors, it **re-validates live** on every edit.
- **Back** clears errors; **Back on step 1 is "Cancel"** and closes the modal.
- On the last step, **everything is validated again**; if any earlier step is
  invalid the wizard jumps back to the first invalid step.
- Saving shows a spinner. Any failure shows only *"Could not save. Please try
  again."* — the underlying error is dropped on purpose because it could embed
  PHI.

## Fields and rules

All numeric inputs are **strings in form state** so half-typed values
(`"1."`, `""`) are representable; they're parsed only by validation and
`formToMedication`.

### Basic info

| Field | Rule |
| --- | --- |
| Name | required, ≤ 100 chars (trimmed) |
| Generic name | optional, ≤ 100 chars; omitted from the record when blank |
| Strength | required, ≤ 40 chars (e.g. `20 mg`) |
| Form | required: Tablet · Capsule · Softgel · Liquid · Inhaler · Sublingual |

### Pill look

Shape (`round` · `capsule` · `oval`) plus primary and secondary colour from a
fixed 12-swatch palette (`PILL_COLORS`). Default: round, white / teal
(`#ffffff` / `#5eead4`). Saved as `Medication.appearance` and stored **inside
the encrypted payload** (see [storage.md](storage.md#hybrid-column-encryption-model));
the Medications list does not render it yet.

### Schedule

| Field | Rule |
| --- | --- |
| How often | `daily` · `specific_days` (≥ 1 weekday) · `interval` (every N days, whole number 1–365) |
| Start date | must be a real calendar date (`YYYY-MM-DD`); for `interval` it is also the anchor |
| Dose times | 1–12 rows; each time must be valid `HH:mm` and **unique** among the rows |
| Dose units | decimal, > 0 and ≤ 100 (e.g. `0.5`, `1`, `2`) |
| Remind min. before | blank = inherit the global lead time; otherwise a whole number 0–240 |
| Reminder toggle | per slot, default on |

Each slot's **label** is derived from its time, not chosen:
04:00–10:59 Morning · 11:00–15:59 Midday · 16:00–20:59 Evening ·
21:00–03:59 Bedtime. Slots are saved **sorted by time**.

### Inventory

| Field | Rule |
| --- | --- |
| Units on hand | decimal ≥ 0, ≤ 100 000 (fractions allowed — a half-tablet dose leaves `29.5`) |
| Package size | whole number 1–100 000 |
| Low-stock alert at | decimal ≥ 0, ≤ 100 000 |
| Last refilled | real calendar date |
| Pharmacy notes | optional, ≤ 200 chars |

**Non-blocking warnings** (never prevent saving): units on hand above the
package size ("that is OK after a refill"), and an alert level above the
package size.

### Number parsing

`parseDecimal` accepts `1.5`, `.5` and — for comma-decimal keyboards — `1,5`,
`0,25`, `,5`. A comma counts as a decimal mark **only with 1–2 digits after it**,
so `1,000` is *rejected* rather than silently read as 1 (or 1000): for a dose,
refusing is safer than guessing. It rejects negatives, exponents (`1e3`) and
trailing dots (`5.`). `parseInteger` is digits-only. Any unusable dose shows
one message: *"Dose must be a number greater than 0, e.g. 1 or 0.5."*

## Mapping: form ⇄ `Medication`

`formToMedication(state, { newId, existing? })`

- Re-validates everything and **throws `MedicationFormInvalidError`** (field
  names only, no values) instead of producing a corrupt record.
- Trims text; drops blank optional fields; dedupes + sorts `daysOfWeek`; sorts
  slots by time; derives slot labels; copies `appearance`.
- **IDs:** `newId` is injected (the screens pass `expo-crypto`'s `randomUUID`).
  A new medication and any slot without an `id` get a fresh UUID. IDs are never
  derived from the drug name.

When **editing** (`existing` passed), the wizard owns only what it shows; these
are **carried over untouched** from the stored medication:

`id`, `purpose`, `instructions`, `prescriber`, `active`,
`inventory.nextFillDate`, `inventory.googleCalendarEventId`, and the `id` of
every slot that still exists. New medications get `purpose: ''`,
`instructions: ''`, `active: true`.

`medicationToForm(med, todayKey)` repairs bad stored data so the user must
re-confirm it: an unknown `form` becomes unselected, and an invalid `startDate`
or `lastRefilledAt` becomes `todayKey`. A stored `appearance` is loaded;
without one the default look is used.

## Behaviour to be aware of

These are current behaviours, not endorsements — several are tracked in the
[roadmap](roadmap.md#known-gaps-and-sharp-edges).

- **Edit merges stock instead of overwriting it (COR-95).** The edit screen
  saves with `saveMedication(med, { inventoryBaseline })`, where the baseline is
  the `currentUnits` it loaded. Under the write gate the repository re-reads the
  stored stock and applies only `form currentUnits - baseline`, so a dose logged
  on Today while the editor is open is kept.
- **Removing a dose time** deletes that slot row immediately on save, with no
  confirmation, and leaves its past `dose_logs` behind (COR-93).
- **`nextFillDate` is not recalculated** when schedule or inventory change
  (COR-94).
- **No notification hook.** Saving does not (re)schedule reminders; COR-76
  requires a single post-save hook in the storage/app layer, not in screens.
- **No delete or pause UI.** `deleteMedication` and `toggleActiveMedication`
  exist on the repository but no screen calls them.
- **Never validated on a device.** The iOS inline spinner / Android dialog
  behaviour of `NativePickerField` and the modal presentation are unverified on
  hardware (COR-91).

## Adding a field to a medication

A checklist, in the order that keeps the compiler on your side:

1. **Domain:** add the optional field to `Medication`
   (`lib/domain/medication-data.ts`). Keep it optional unless old rows can be
   back-filled.
2. **Is it PHI?** If it describes the person or the drug (names, notes, how a
   pill looks…), it belongs in the **encrypted payload**: add it to
   `MedicationPhi` / `StoredMedicationRow` and `domainMedicationToRows` /
   `rowsToDomainMedication` in `lib/storage/mappers.ts`, and to the `phi`
   object in `encryptMedicationRow` (`lib/storage/context.ts`). If it must be
   queried or indexed (dates, counters), it needs a real column and a schema
   migration — see [storage.md](storage.md#schema-versions-and-migrations).
   Treat stored values as untrusted on read (see `isPillAppearance`).
3. **Form:** add it to `MedicationFormState`, `createEmptyForm`,
   `medicationToForm` and `formToMedication` (carry it over from `existing`
   if the wizard doesn't edit it).
4. **Validation:** add rules to the right `validate*` step function and a
   `LIMITS` entry if it has a bound.
5. **UI:** add the control in `MedicationWizard.tsx`.
6. **Tests:** wizard spec (validation + round trip), `mappers.test.ts`
   (round trip, absent stays absent, invalid stored value), and
   `repository.test.ts` (persisted; not in a plaintext column if PHI).
   Coverage on `lib/wizard` must stay at 100 %.
7. **Docs and changelog:** update this page and `CHANGELOG.md`.

## Testing

`tests/wizard-medication-form.spec.ts` covers parsing, every validation rule,
warnings, form ⇄ medication mapping (including edit round trips and corrupt
stored values) and picker date conversion. **There are no component tests:**
`MedicationWizard`, `NativePickerField` and `PillPreview` are exercised only by
hand. Run with `npm run test:schedule` (vitest + coverage) or `npm test`.
