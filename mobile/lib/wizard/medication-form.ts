/**
 * COR-75 add / edit medication wizard: form state, validation, and
 * form <-> domain mapping.
 *
 * Pure module: no React Native, Expo, or storage imports, so it is fully
 * unit-testable under Node. ID generation is injected (screens pass
 * `expo-crypto`'s `randomUUID`); IDs are never derived from drug names.
 *
 * Never log form values from here or callers: they are PHI.
 */
import {
  PILL_SHAPES,
  type Medication,
  type MedicationForm,
  type PillAppearance,
  type PillShape,
  type ScheduleFrequency,
  type TimeOfDayBlock,
  type TimeSlot,
} from '../domain/medication-data';
import { isValidDateKey } from '../schedule/date-keys';

// Appearance types live in the domain (they are persisted); re-exported so
// existing wizard imports keep working.
export { PILL_SHAPES };
export type { PillAppearance, PillShape };

export const MEDICATION_FORMS: readonly MedicationForm[] = [
  'Tablet',
  'Capsule',
  'Softgel',
  'Liquid',
  'Inhaler',
  'Sublingual',
];

export const PILL_COLORS: readonly string[] = [
  '#ffffff',
  '#f8fafc',
  '#fde68a',
  '#fca5a5',
  '#f9a8d4',
  '#c4b5fd',
  '#93c5fd',
  '#5eead4',
  '#86efac',
  '#fdba74',
  '#a8a29e',
  '#0f172a',
];

export const DEFAULT_PILL_APPEARANCE: PillAppearance = {
  shape: 'round',
  primaryColor: '#ffffff',
  secondaryColor: '#5eead4',
};

/** Editable slot row. Numeric inputs are strings so partial input is representable. */
export interface TimeSlotDraft {
  /** Existing slot id when editing; undefined for newly added rows. */
  id?: string;
  time: string; // HH:mm
  doseUnits: string;
  /** Blank = inherit global lead time. */
  leadMinutes: string;
  reminderEnabled: boolean;
}

export interface MedicationFormState {
  name: string;
  genericName: string;
  strength: string;
  form: MedicationForm | '';
  appearance: PillAppearance;
  frequency: ScheduleFrequency;
  daysOfWeek: number[];
  intervalDays: string;
  startDate: string; // YYYY-MM-DD
  timeSlots: TimeSlotDraft[];
  currentUnits: string;
  capacityUnits: string;
  lowThresholdUnits: string;
  lastRefilledAt: string; // YYYY-MM-DD
  pharmacyNote: string;
}

export type WizardStep = 'basics' | 'appearance' | 'schedule' | 'inventory';
export const WIZARD_STEPS: readonly WizardStep[] = ['basics', 'appearance', 'schedule', 'inventory'];

/** Field path -> human readable error. Slot fields use `timeSlots.<index>.<field>`. */
export type FormErrors = Record<string, string>;

export const LIMITS = {
  nameMax: 100,
  strengthMax: 40,
  noteMax: 200,
  intervalMax: 365,
  doseUnitsMax: 100,
  leadMinutesMax: 240,
  unitsMax: 100000,
  slotsMax: 12,
} as const;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const DECIMAL_PATTERN = /^(\d+(\.\d+)?|\.\d+)$/;
/**
 * Comma as the decimal mark ("1,5", "0,25", ",5"), as typed on decimal-pad
 * keyboards in comma locales. Only 1-2 digits may follow, so a thousands-style
 * "1,000" stays invalid instead of being silently read as 1.
 */
const COMMA_DECIMAL_PATTERN = /^(\d*),(\d{1,2})$/;
const INTEGER_PATTERN = /^\d+$/;

export function isValidTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

/**
 * Parses a non-negative decimal string ("1.5", ".5", and "1,5" with a 1-2
 * digit comma fraction); returns NaN for anything else (incl. "", "-1", "1e3",
 * "1,000").
 */
export function parseDecimal(value: string): number {
  let trimmed = value.trim();
  const comma = COMMA_DECIMAL_PATTERN.exec(trimmed);
  if (comma) trimmed = `${comma[1] || '0'}.${comma[2]}`;
  return DECIMAL_PATTERN.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/** Parses a non-negative integer string; returns NaN for anything else. */
export function parseInteger(value: string): number {
  const trimmed = value.trim();
  return INTEGER_PATTERN.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/** Maps a HH:mm time to the time-of-day block used for slot labels. */
export function timeToBlock(time: string): TimeOfDayBlock {
  const hour = Number(time.slice(0, 2));
  if (hour >= 4 && hour < 11) return 'Morning';
  if (hour >= 11 && hour < 16) return 'Midday';
  if (hour >= 16 && hour < 21) return 'Evening';
  return 'Bedtime';
}

export function createEmptyForm(todayKey: string): MedicationFormState {
  return {
    name: '',
    genericName: '',
    strength: '',
    form: '',
    appearance: { ...DEFAULT_PILL_APPEARANCE },
    frequency: 'daily',
    daysOfWeek: [],
    intervalDays: '2',
    startDate: todayKey,
    timeSlots: [{ time: '08:00', doseUnits: '1', leadMinutes: '', reminderEnabled: true }],
    currentUnits: '30',
    capacityUnits: '30',
    lowThresholdUnits: '5',
    lastRefilledAt: todayKey,
    pharmacyNote: '',
  };
}

function validateBasics(state: MedicationFormState, errors: FormErrors): void {
  const name = state.name.trim();
  if (name.length === 0) {
    errors.name = 'Enter the medication name.';
  } else if (name.length > LIMITS.nameMax) {
    errors.name = `Name must be ${LIMITS.nameMax} characters or fewer.`;
  }
  if (state.genericName.trim().length > LIMITS.nameMax) {
    errors.genericName = `Generic name must be ${LIMITS.nameMax} characters or fewer.`;
  }
  const strength = state.strength.trim();
  if (strength.length === 0) {
    errors.strength = 'Enter the strength, e.g. "20 mg".';
  } else if (strength.length > LIMITS.strengthMax) {
    errors.strength = `Strength must be ${LIMITS.strengthMax} characters or fewer.`;
  }
  if (!MEDICATION_FORMS.includes(state.form as MedicationForm)) {
    errors.form = 'Choose a form (tablet, capsule, …).';
  }
}

function validateAppearance(state: MedicationFormState, errors: FormErrors): void {
  if (!PILL_SHAPES.includes(state.appearance.shape)) {
    errors.shape = 'Choose a pill shape.';
  }
  if (!HEX_COLOR_PATTERN.test(state.appearance.primaryColor)) {
    errors.primaryColor = 'Choose a primary color.';
  }
  if (!HEX_COLOR_PATTERN.test(state.appearance.secondaryColor)) {
    errors.secondaryColor = 'Choose a secondary color.';
  }
}

function validateSchedule(state: MedicationFormState, errors: FormErrors): void {
  if (!isValidDateKey(state.startDate)) {
    errors.startDate = 'Enter a real start date (YYYY-MM-DD).';
  }
  if (state.frequency === 'specific_days') {
    const valid =
      state.daysOfWeek.length > 0 &&
      state.daysOfWeek.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (!valid) errors.daysOfWeek = 'Pick at least one day of the week.';
  } else if (state.frequency === 'interval') {
    const n = parseInteger(state.intervalDays);
    if (!(n >= 1 && n <= LIMITS.intervalMax)) {
      errors.intervalDays = `Repeat every 1–${LIMITS.intervalMax} days (whole number).`;
    }
  } else if (state.frequency !== 'daily') {
    errors.frequency = 'Choose how often this is taken.';
  }

  if (state.timeSlots.length === 0) {
    errors.timeSlots = 'Add at least one dose time.';
  } else if (state.timeSlots.length > LIMITS.slotsMax) {
    errors.timeSlots = `No more than ${LIMITS.slotsMax} dose times.`;
  }
  const seen = new Set<string>();
  state.timeSlots.forEach((slot, i) => {
    const p = `timeSlots.${i}`;
    if (!isValidTime(slot.time)) {
      errors[`${p}.time`] = 'Pick a valid time.';
    } else if (seen.has(slot.time)) {
      errors[`${p}.time`] = 'This time is already used by another dose.';
    } else {
      seen.add(slot.time);
    }
    const dose = parseDecimal(slot.doseUnits);
    if (!(dose > 0)) {
      errors[`${p}.doseUnits`] = 'Dose must be a number greater than 0, e.g. 1 or 0.5.';
    } else if (dose > LIMITS.doseUnitsMax) {
      errors[`${p}.doseUnits`] = `Dose must be ${LIMITS.doseUnitsMax} or fewer units.`;
    }
    if (slot.leadMinutes.trim() !== '') {
      const lead = parseInteger(slot.leadMinutes);
      if (!(lead <= LIMITS.leadMinutesMax)) {
        errors[`${p}.leadMinutes`] = `Reminder lead must be 0–${LIMITS.leadMinutesMax} whole minutes, or blank for default.`;
      }
    }
  });
}

function validateInventory(state: MedicationFormState, errors: FormErrors): void {
  // On-hand and threshold may be fractional (logDose subtracts fractional
  // doseUnits) and may exceed the package size (refills add on top), so both
  // are non-negative decimals; exceeding capacity is only a warning.
  const current = parseDecimal(state.currentUnits);
  const capacity = parseInteger(state.capacityUnits);
  const low = parseDecimal(state.lowThresholdUnits);
  if (!(current <= LIMITS.unitsMax)) {
    errors.currentUnits = 'Enter how many units are on hand (0 or more).';
  }
  if (!(capacity >= 1 && capacity <= LIMITS.unitsMax)) {
    errors.capacityUnits = 'Package size must be a whole number of at least 1.';
  }
  if (!(low <= LIMITS.unitsMax)) {
    errors.lowThresholdUnits = 'Low-stock alert must be 0 or more.';
  }
  if (!isValidDateKey(state.lastRefilledAt)) {
    errors.lastRefilledAt = 'Enter a real refill date (YYYY-MM-DD).';
  }
  if (state.pharmacyNote.trim().length > LIMITS.noteMax) {
    errors.pharmacyNote = `Pharmacy notes must be ${LIMITS.noteMax} characters or fewer.`;
  }
}

/**
 * Non-blocking inventory warnings (never prevent saving). Field path ->
 * message, same keys as {@link FormErrors}.
 */
export function inventoryWarnings(state: MedicationFormState): FormErrors {
  const warnings: FormErrors = {};
  const current = parseDecimal(state.currentUnits);
  const capacity = parseInteger(state.capacityUnits);
  const low = parseDecimal(state.lowThresholdUnits);
  if (capacity >= 1) {
    if (current > capacity) warnings.currentUnits = 'More than one package on hand — that is OK after a refill.';
    if (low > capacity) warnings.lowThresholdUnits = 'Alert level is above the package size.';
  }
  return warnings;
}

const STEP_VALIDATORS: Record<WizardStep, (s: MedicationFormState, e: FormErrors) => void> = {
  basics: validateBasics,
  appearance: validateAppearance,
  schedule: validateSchedule,
  inventory: validateInventory,
};

/** Validates a single wizard step. Empty object means the step is valid. */
export function validateStep(step: WizardStep, state: MedicationFormState): FormErrors {
  const errors: FormErrors = {};
  STEP_VALIDATORS[step](state, errors);
  return errors;
}

/** Validates every step. */
export function validateForm(state: MedicationFormState): FormErrors {
  const errors: FormErrors = {};
  for (const step of WIZARD_STEPS) STEP_VALIDATORS[step](state, errors);
  return errors;
}

/** First step containing an error, or null when the whole form is valid. */
export function firstInvalidStep(state: MedicationFormState): WizardStep | null {
  for (const step of WIZARD_STEPS) {
    if (Object.keys(validateStep(step, state)).length > 0) return step;
  }
  return null;
}

export class MedicationFormInvalidError extends Error {
  constructor(public readonly errors: FormErrors) {
    // Field names only, never values (PHI).
    super(`Medication form invalid: ${Object.keys(errors).join(', ')}`);
    this.name = 'MedicationFormInvalidError';
  }
}

export interface FormToMedicationOptions {
  /** Generates new medication / slot IDs. Pass expo-crypto `randomUUID` in the app. */
  newId: () => string;
  /** When editing, the persisted medication: its id and non-wizard fields are preserved. */
  existing?: Medication;
}

/**
 * Maps a validated form to a domain `Medication`. Throws
 * {@link MedicationFormInvalidError} rather than ever producing a corrupt
 * record (e.g. an invalid `startDate`).
 */
export function formToMedication(state: MedicationFormState, options: FormToMedicationOptions): Medication {
  const errors = validateForm(state);
  if (Object.keys(errors).length > 0) throw new MedicationFormInvalidError(errors);
  const { existing, newId } = options;

  const timeSlots: TimeSlot[] = [...state.timeSlots]
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((slot) => {
      const lead = slot.leadMinutes.trim() === '' ? undefined : parseInteger(slot.leadMinutes);
      const mapped: TimeSlot = {
        id: slot.id ?? newId(),
        label: timeToBlock(slot.time),
        time: slot.time,
        doseUnits: parseDecimal(slot.doseUnits),
        reminderEnabled: slot.reminderEnabled,
      };
      if (lead !== undefined) mapped.leadMinutes = lead;
      return mapped;
    });

  const genericName = state.genericName.trim();
  const pharmacyNote = state.pharmacyNote.trim();
  const med: Medication = {
    id: existing?.id ?? newId(),
    name: state.name.trim(),
    strength: state.strength.trim(),
    form: state.form as MedicationForm,
    appearance: { ...state.appearance },
    purpose: existing?.purpose ?? '',
    instructions: existing?.instructions ?? '',
    frequency: state.frequency,
    startDate: state.startDate,
    timeSlots,
    inventory: {
      currentUnits: parseDecimal(state.currentUnits),
      capacityUnits: parseInteger(state.capacityUnits),
      lowThresholdUnits: parseDecimal(state.lowThresholdUnits),
      lastRefilledAt: state.lastRefilledAt,
    },
    active: existing?.active ?? true,
  };
  if (genericName) med.genericName = genericName;
  if (existing?.prescriber) med.prescriber = existing.prescriber;
  if (state.frequency === 'specific_days') med.daysOfWeek = [...new Set(state.daysOfWeek)].sort((a, b) => a - b);
  if (state.frequency === 'interval') med.intervalDays = parseInteger(state.intervalDays);
  if (pharmacyNote) med.inventory.pharmacyNote = pharmacyNote;
  if (existing?.inventory.nextFillDate) med.inventory.nextFillDate = existing.inventory.nextFillDate;
  if (existing?.inventory.googleCalendarEventId) {
    med.inventory.googleCalendarEventId = existing.inventory.googleCalendarEventId;
  }
  return med;
}

/**
 * Maps a persisted medication into editable form state. A corrupt stored
 * `startDate` / `lastRefilledAt` is replaced with `todayKey` so the user
 * must confirm a real date before saving.
 */
export function medicationToForm(
  med: Medication,
  todayKey: string,
  appearance: PillAppearance = med.appearance ?? DEFAULT_PILL_APPEARANCE,
): MedicationFormState {
  return {
    name: med.name,
    genericName: med.genericName ?? '',
    strength: med.strength,
    form: MEDICATION_FORMS.includes(med.form) ? med.form : '',
    appearance: { ...appearance },
    frequency: med.frequency,
    daysOfWeek: [...(med.daysOfWeek ?? [])],
    intervalDays: String(med.intervalDays ?? 2),
    startDate: isValidDateKey(med.startDate) ? med.startDate : todayKey,
    timeSlots: med.timeSlots.map((slot) => ({
      id: slot.id,
      time: slot.time,
      doseUnits: String(slot.doseUnits),
      leadMinutes:
        slot.leadMinutes === undefined || slot.leadMinutes === null ? '' : String(slot.leadMinutes),
      reminderEnabled: slot.reminderEnabled !== false,
    })),
    currentUnits: String(med.inventory.currentUnits),
    capacityUnits: String(med.inventory.capacityUnits),
    lowThresholdUnits: String(med.inventory.lowThresholdUnits),
    lastRefilledAt: isValidDateKey(med.inventory.lastRefilledAt) ? med.inventory.lastRefilledAt : todayKey,
    pharmacyNote: med.inventory.pharmacyNote ?? '',
  };
}

/** Errors scoped to one slot row, keyed by field name. */
export function slotErrors(errors: FormErrors, index: number): Partial<Record<keyof TimeSlotDraft, string>> {
  const prefix = `timeSlots.${index}.`;
  const out: Partial<Record<keyof TimeSlotDraft, string>> = {};
  for (const [key, message] of Object.entries(errors)) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length) as keyof TimeSlotDraft] = message;
  }
  return out;
}

/** Converts a Date (from the native picker) to HH:mm local time. */
export function dateToTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Converts HH:mm to a Date on an arbitrary reference day, for seeding the native picker. */
export function timeToDate(time: string, reference: Date = new Date(2000, 0, 1)): Date {
  const d = new Date(reference.getTime());
  const [h, m] = isValidTime(time) ? time.split(':').map(Number) : [8, 0];
  d.setHours(h, m, 0, 0);
  return d;
}
