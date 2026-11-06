/**
 * COR-77: build planner-shaped doses for snooze follow-up content (pure).
 */
import { DEFAULT_MEDICATION_ALERT, type Medication } from '../domain/medication-data';
import { parseSlotTime } from './fire-time';
import { mergeProfiles } from './planner';
import type { PlannedDose } from './types';

export function plannedDosesFromPayload(
  medications: Medication[],
  doses: { dateKey: string; medicationId: string; slotId: string }[],
): { planned: PlannedDose[]; profile: { sound: boolean; vibrate: boolean } } {
  const medById = new Map(medications.map((m) => [m.id, m]));
  const planned: PlannedDose[] = [];
  let profile = { ...DEFAULT_MEDICATION_ALERT };
  for (const dose of doses) {
    const medication = medById.get(dose.medicationId);
    const slot = medication?.timeSlots.find((s) => s.id === dose.slotId);
    const doseMinuteOfDay = slot ? parseSlotTime(slot.time) : 0;
    planned.push({
      dateKey: dose.dateKey,
      medicationId: dose.medicationId,
      slotId: dose.slotId,
      medicationName: medication?.name ?? '',
      doseMinuteOfDay,
    });
    if (medication?.alert) profile = mergeProfiles(profile, medication.alert);
  }
  return { planned, profile };
}
