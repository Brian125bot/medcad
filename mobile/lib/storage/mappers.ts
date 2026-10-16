import {
  isPillAppearance,
  type Medication,
  type MedicationForm,
  type PillAppearance,
  type ScheduleFrequency,
  type TimeOfDayBlock,
} from '../domain/medication-data';
import type { MedicationRow, TimeSlotRow } from './schema';

export interface MedicationPhi {
  name: string;
  generic_name?: string | null;
  strength: string;
  form: string;
  purpose?: string | null;
  instructions?: string | null;
  prescriber?: string | null;
  inventory_pharmacy_note?: string | null;
  appearance?: PillAppearance | null;
}

export interface TimeSlotPhi {
  label: string;
}

export interface StoredMedicationRow extends MedicationRow {
  name: string;
  generic_name?: string | null;
  strength: string;
  form: string;
  purpose?: string | null;
  instructions?: string | null;
  prescriber?: string | null;
  inventory_pharmacy_note?: string | null;
  /** Decoded from the encrypted payload; treated as untrusted on read. */
  appearance?: unknown;
}

export interface StoredTimeSlotRow extends TimeSlotRow {
  label: string;
}

export function domainMedicationToRows(med: Medication): {
  medicationRow: StoredMedicationRow;
  timeSlotRows: StoredTimeSlotRow[];
} {
  const now = new Date().toISOString();
  return {
    medicationRow: {
      id: med.id,
      name: med.name,
      generic_name: med.genericName || null,
      strength: med.strength,
      form: med.form,
      purpose: med.purpose || null,
      instructions: med.instructions || null,
      frequency: med.frequency,
      start_date: med.startDate,
      end_date: null,
      days_of_week: med.daysOfWeek ? JSON.stringify(med.daysOfWeek) : null,
      interval_days: med.intervalDays || null,
      prescriber: med.prescriber || null,
      appearance: med.appearance ? { ...med.appearance } : null,
      active: med.active ? 1 : 0,
      inventory_current: med.inventory?.currentUnits ?? 0,
      inventory_capacity: med.inventory?.capacityUnits ?? 0,
      inventory_low_threshold: med.inventory?.lowThresholdUnits ?? 5,
      inventory_last_refilled: med.inventory?.lastRefilledAt ?? null,
      inventory_next_fill_date: med.inventory?.nextFillDate || null,
      inventory_pharmacy_note: med.inventory?.pharmacyNote || null,
      inventory_calendar_event_id: med.inventory?.googleCalendarEventId ?? null,
      created_at: now,
      updated_at: now,
      enc_payload: '',
    },
    timeSlotRows: (med.timeSlots || []).map((slot) => ({
      id: slot.id,
      medication_id: med.id,
      label: slot.label,
      time: slot.time,
      dose_units: slot.doseUnits ?? 1,
      reminder_enabled: slot.reminderEnabled === false ? 0 : 1,
      lead_minutes:
        slot.leadMinutes !== undefined && slot.leadMinutes !== null ? slot.leadMinutes : null,
      created_at: now,
      updated_at: now,
      enc_payload: '',
    })),
  };
}

export function rowsToDomainMedication(
  medRow: StoredMedicationRow,
  slotRows: StoredTimeSlotRow[],
): Medication {
  let parsedDaysOfWeek: number[] | undefined;
  if (medRow.days_of_week) {
    try {
      parsedDaysOfWeek = JSON.parse(medRow.days_of_week) as number[];
    } catch {
      parsedDaysOfWeek = undefined;
    }
  }

  return {
    id: medRow.id,
    name: medRow.name,
    genericName: medRow.generic_name || undefined,
    strength: medRow.strength,
    form: medRow.form as MedicationForm,
    purpose: medRow.purpose || '',
    instructions: medRow.instructions || '',
    frequency: medRow.frequency as ScheduleFrequency,
    startDate: medRow.start_date,
    daysOfWeek: parsedDaysOfWeek,
    intervalDays: medRow.interval_days || undefined,
    prescriber: medRow.prescriber || undefined,
    // Rows saved before the pill builder (or with a damaged payload) have no
    // valid appearance; omit the key rather than inventing a look.
    ...(isPillAppearance(medRow.appearance) ? { appearance: { ...medRow.appearance } } : {}),
    active: medRow.active === 1,
    timeSlots: [...slotRows]
      .sort((a, b) => a.time.localeCompare(b.time))
      .map((slot) => ({
        id: slot.id,
        label: slot.label as TimeOfDayBlock,
        time: slot.time,
        doseUnits: slot.dose_units,
        reminderEnabled: slot.reminder_enabled === 1,
        leadMinutes:
          slot.lead_minutes !== null && slot.lead_minutes !== undefined ? slot.lead_minutes : undefined,
      })),
    inventory: {
      currentUnits: medRow.inventory_current,
      capacityUnits: medRow.inventory_capacity,
      lowThresholdUnits: medRow.inventory_low_threshold,
      lastRefilledAt: medRow.inventory_last_refilled || medRow.start_date,
      nextFillDate: medRow.inventory_next_fill_date || undefined,
      pharmacyNote: medRow.inventory_pharmacy_note || undefined,
      googleCalendarEventId: medRow.inventory_calendar_event_id || undefined,
    },
  };
}
