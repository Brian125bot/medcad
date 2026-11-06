/**
 * COR-76 reminder settings: preference keys, validated reads, and the
 * medication edits the settings screen saves through the repository.
 */
import {
  DEFAULT_MEDICATION_ALERT,
  type Medication,
  type MedicationAlert,
} from '../domain/medication-data';
import type { ReminderSettings } from './types';

/** Encrypted user preferences (user_preferences table). */
export const PREF_DEFAULT_LEAD_MINUTES = 'notifications.defaultLeadMinutes';
export const PREF_SHOW_MEDICATION_NAMES = 'notifications.showMedicationNames';

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { defaultLeadMinutes: 0, showMedicationNames: false };

/** Lead-time choices offered in settings, in minutes before the dose. */
export const LEAD_TIME_OPTIONS: readonly number[] = [0, 5, 10, 15, 30, 60];
export const MAX_LEAD_MINUTES = 24 * 60;

export function isValidLeadMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_LEAD_MINUTES;
}

interface PreferenceReader {
  getPreference<T>(prefKey: string, defaultValue: T): Promise<T>;
}

export async function readReminderSettings(repository: PreferenceReader): Promise<ReminderSettings> {
  const [lead, names] = await Promise.all([
    repository.getPreference<unknown>(PREF_DEFAULT_LEAD_MINUTES, DEFAULT_REMINDER_SETTINGS.defaultLeadMinutes),
    repository.getPreference<unknown>(PREF_SHOW_MEDICATION_NAMES, DEFAULT_REMINDER_SETTINGS.showMedicationNames),
  ]);
  return {
    defaultLeadMinutes: isValidLeadMinutes(lead) ? lead : DEFAULT_REMINDER_SETTINGS.defaultLeadMinutes,
    showMedicationNames: names === true,
  };
}

export type LeadTimeSummary =
  | { kind: 'default' }
  | { kind: 'explicit'; minutes: number }
  | { kind: 'mixed' };

/** What a medication's lead-time control shows: inherit, one explicit value, or "Mixed". */
export function summarizeLeadMinutes(med: Medication): LeadTimeSummary {
  const values = new Set(med.timeSlots.map((slot) => slot.leadMinutes ?? null));
  if (values.size > 1) return { kind: 'mixed' };
  const [only] = [...values];
  return only === undefined || only === null ? { kind: 'default' } : { kind: 'explicit', minutes: only };
}

/** Writes one lead time to every slot; `null` makes every slot inherit the global default. */
export function withLeadMinutes(med: Medication, minutes: number | null): Medication {
  return { ...med, timeSlots: med.timeSlots.map((slot) => ({ ...slot, leadMinutes: minutes })) };
}

export function getMedicationAlert(med: Medication): MedicationAlert {
  return med.alert ?? DEFAULT_MEDICATION_ALERT;
}

export function withAlert(med: Medication, patch: Partial<MedicationAlert>): Medication {
  return { ...med, alert: { ...getMedicationAlert(med), ...patch } };
}

/**
 * Chip values for the lead-time picker: optional `null` (inherit default), the
 * standard options, plus the stored value when it is not a standard option
 * (e.g. 20 min set in the wizard) so the control shows what is saved.
 */
export function leadChipOptions(value: number | null | 'mixed', allowDefault: boolean): (number | null)[] {
  const minutes = [...LEAD_TIME_OPTIONS];
  if (typeof value === 'number' && !minutes.includes(value)) {
    minutes.push(value);
    minutes.sort((a, b) => a - b);
  }
  return allowDefault ? [null, ...minutes] : minutes;
}

/** Short chip text; `formatLeadMinutes` is the accessible label. */
export function leadChipLabel(minutes: number): string {
  return minutes === 0 ? 'At time' : `${minutes} min`;
}

export function formatLeadMinutes(minutes: number): string {
  return minutes === 0 ? 'At dose time' : `${minutes} min before`;
}
