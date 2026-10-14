/**
 * CadenceRx — Slot Reminder Toggle & Persistence Engine (COR-76)
 *
 * Implements synchronous, race-condition-free slot reminder toggling,
 * optimistic state updates, encrypted repository persistence, and cloud sync.
 */

import { Medication, TimeSlot } from './medication-data';

export interface SlotReminderToggleResult {
  updatedMedication: Medication;
  targetSlot: TimeSlot;
  targetSlotId: string;
  nextReminderEnabled: boolean;
  time: string;
  medicationName: string;
}

export interface SlotReminderToggleDependencies {
  getMedications: () => Medication[];
  setMedications: (medications: Medication[]) => void;
  saveMedication: (medication: Medication) => Promise<Medication>;
  saveToFirestore?: (uid: string, medication: Medication) => Promise<void>;
  updateStorageInfo?: () => void;
  triggerFeedback?: (message: string) => void;
  cloudUserUid?: string | null;
  rescheduleReminders?: (medications: Medication[]) => Promise<void>;
}

export interface SlotReminderToggleExecutionResult {
  success: boolean;
  reason?: 'not_found' | 'error';
  updatedMedication: Medication | null;
  updatedMedicationsList: Medication[];
  nextReminderEnabled?: boolean;
  savePromise?: Promise<unknown>;
}

// Map of in-flight / queued save promises keyed by medicationId
const medicationSaveQueues = new Map<string, Promise<unknown>>();

/**
 * Serializes persistence operations per medication to guarantee that rapid
 * consecutive toggles do not persist stale medication snapshots or overwrite
 * newer toggles due to out-of-order async resolution.
 */
export function queueMedicationSave(
  medicationId: string,
  task: () => Promise<unknown>
): Promise<unknown> {
  const previous = medicationSaveQueues.get(medicationId) || Promise.resolve();
  const next = previous
    .catch(() => {}) // Prevent previous rejections from breaking subsequent saves
    .then(task);
  medicationSaveQueues.set(medicationId, next);
  return next;
}

/**
 * Reset queued saves (useful for unit testing isolation).
 */
export function clearMedicationSaveQueues(): void {
  medicationSaveQueues.clear();
}

/**
 * Pure synchronous derivation of slot reminder toggle.
 * Returns null if the medication or slot is not found.
 * Strictly preserves all other slots and medication fields.
 */
export function toggleSlotReminderPure(
  medications: Medication[],
  medicationId: string,
  slotId: string
): SlotReminderToggleResult | null {
  const medication = medications.find((m) => m.id === medicationId);
  if (!medication) return null;

  const slot = medication.timeSlots.find((s) => s.id === slotId);
  if (!slot) return null;

  // If reminderEnabled is false, toggle to true. If true or undefined (default), toggle to false.
  const nextReminderEnabled = slot.reminderEnabled === false;

  const updatedMedication: Medication = {
    ...medication,
    timeSlots: medication.timeSlots.map((candidate) =>
      candidate.id === slotId
        ? { ...candidate, reminderEnabled: nextReminderEnabled }
        : candidate
    ),
  };

  return {
    updatedMedication,
    targetSlot: slot,
    targetSlotId: slot.id,
    nextReminderEnabled,
    time: slot.time,
    medicationName: medication.name,
  };
}

/**
 * Synchronously derives the updated medication, immediately applies optimistic
 * state updates, and reliably persists through repository and Firestore sync.
 *
 * Guaranteed properties:
 * 1. Synchronous object creation before any async operations.
 * 2. No write or sync occurs if medication or slot is missing.
 * 3. Immediately updates UI state (optimistic UI).
 * 4. Safely invokes repository save and Firestore sync when user is authenticated.
 * 5. Serializes persistence per medication to eliminate race conditions under rapid repeated toggles.
 */
export function handleSlotReminderToggle(
  medicationId: string,
  slotId: string,
  deps: SlotReminderToggleDependencies
): SlotReminderToggleExecutionResult {
  const currentMedications = deps.getMedications();
  const derived = toggleSlotReminderPure(currentMedications, medicationId, slotId);

  if (!derived) {
    return {
      success: false,
      reason: 'not_found',
      updatedMedication: null,
      updatedMedicationsList: currentMedications,
    };
  }

  const { updatedMedication, nextReminderEnabled, medicationName, time } = derived;

  // 1. Optimistic update: synchronously create new list and update state
  const updatedMedicationsList = currentMedications.map((m) =>
    m.id === medicationId ? updatedMedication : m
  );
  deps.setMedications(updatedMedicationsList);

  // 2. Trigger immediate user feedback
  deps.triggerFeedback?.(
    nextReminderEnabled
      ? `Enabled reminder alert for ${medicationName} (${time})`
      : `Muted reminder alert for ${medicationName} (${time})`
  );

  // 3. Optional explicit notification rescheduling (for non-React or test runners)
  if (deps.rescheduleReminders) {
    deps.rescheduleReminders(updatedMedicationsList).catch((err) => {
      console.error('Failed to reschedule notification alarms after slot toggle:', err);
    });
  }

  // 4. Enqueue persistence and cloud sync sequentially
  const savePromise = queueMedicationSave(medicationId, async () => {
    try {
      await deps.saveMedication(updatedMedication);
      deps.updateStorageInfo?.();
    } catch (err) {
      console.error('Failed to persist slot reminder toggle in storage:', err);
      throw err;
    }

    if (deps.cloudUserUid && deps.saveToFirestore) {
      try {
        await deps.saveToFirestore(deps.cloudUserUid, updatedMedication);
      } catch (err) {
        console.error('Failed to sync slot reminder toggle to cloud:', err);
        throw err;
      }
    }
  });

  return {
    success: true,
    updatedMedication,
    updatedMedicationsList,
    nextReminderEnabled,
    savePromise,
  };
}

/**
 * Async wrapper for callers that prefer awaiting the complete persistence sequence.
 */
export async function executeSlotReminderToggle(
  currentMedications: Medication[],
  medicationId: string,
  slotId: string,
  deps: Omit<SlotReminderToggleDependencies, 'getMedications' | 'setMedications'> & {
    onMedicationsUpdated?: (updatedList: Medication[], updatedMed: Medication) => void;
  }
): Promise<{
  success: boolean;
  updatedMedication: Medication | null;
  updatedMedicationsList: Medication[];
  nextReminderEnabled?: boolean;
}> {
  let list = currentMedications;
  const result = handleSlotReminderToggle(medicationId, slotId, {
    ...deps,
    getMedications: () => list,
    setMedications: (nextList) => {
      list = nextList;
      if (result?.updatedMedication) {
        deps.onMedicationsUpdated?.(nextList, result.updatedMedication);
      }
    },
  });

  if (!result.success || !result.savePromise) {
    return {
      success: false,
      updatedMedication: null,
      updatedMedicationsList: currentMedications,
    };
  }

  await result.savePromise;

  return {
    success: true,
    updatedMedication: result.updatedMedication,
    updatedMedicationsList: result.updatedMedicationsList,
    nextReminderEnabled: result.nextReminderEnabled,
  };
}
