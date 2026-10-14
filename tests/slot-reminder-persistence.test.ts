/**
 * Automated Regression Test Suite for Slot Reminder Persistence & Concurrency
 *
 * Verifies:
 * 1. Toggling an enabled slot sets it to disabled
 * 2. Toggling a disabled slot sets it to enabled
 * 3. The updated medication is persisted through medicationRepository.saveMedication()
 * 4. The updated medication is synced to Firestore when authenticated (and skipped when unauthenticated)
 * 5. No persistence or sync occurs for an unknown medication or slot
 * 6. Other slots remain unchanged and medication fields are preserved
 * 7. The setting survives reload/reload-style repository hydration
 * 8. Notification scheduling excludes a disabled slot
 * 9. Re-enabling the slot restores its notification schedule
 * 10. Rapid consecutive toggles do not persist an obsolete snapshot
 */

import assert from 'node:assert';
import {
  handleSlotReminderToggle,
  toggleSlotReminderPure,
  queueMedicationSave,
  clearMedicationSaveQueues,
} from '../lib/slot-reminder-toggle';
import { medicationRepository } from '../lib/storage/repository';
import { dbAdapter } from '../lib/storage/database';
import { computeUpcomingNotificationTriggers } from '../lib/notifications';
import { Medication, TimeSlot, toDateKey } from '../lib/medication-data';

console.log('=== CadenceRx Slot Reminder Persistence & Concurrency Test Suite ===\n');

// Mock localStorage for Node environment
class MockLocalStorage {
  private store: Map<string, string> = new Map();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
  get length(): number {
    return this.store.size;
  }
}

const mockStorage = new MockLocalStorage();
(globalThis as any).window = { localStorage: mockStorage };
(globalThis as any).localStorage = mockStorage;

function createTestMedication(id = 'med-toggle-test'): Medication {
  return {
    id,
    name: 'Metformin',
    strength: '500 mg',
    form: 'Tablet',
    purpose: 'Blood Sugar Regulation',
    instructions: 'Take with food',
    frequency: 'daily',
    startDate: '2026-01-01',
    active: true,
    timeSlots: [
      { id: 'slot-morning', label: 'Morning', time: '08:00', doseUnits: 1, reminderEnabled: true },
      { id: 'slot-evening', label: 'Evening', time: '18:00', doseUnits: 1, reminderEnabled: true },
      { id: 'slot-night', label: 'Bedtime', time: '22:00', doseUnits: 1, reminderEnabled: false },
    ],
    inventory: {
      currentUnits: 60,
      capacityUnits: 100,
      lowThresholdUnits: 15,
      lastRefilledAt: '2026-10-01',
    },
  };
}

// Test 1: Toggling an enabled slot sets it to disabled
function testToggleEnabledToDisabled() {
  console.log('Test 1: Toggling an enabled slot sets it to disabled...');
  const med = createTestMedication();
  const result = toggleSlotReminderPure([med], med.id, 'slot-morning');

  assert.ok(result, 'Result must be returned for valid medication and slot');
  assert.strictEqual(result.nextReminderEnabled, false, 'nextReminderEnabled must be false');
  const targetSlot = result.updatedMedication.timeSlots.find((s) => s.id === 'slot-morning');
  assert.strictEqual(targetSlot?.reminderEnabled, false, 'Slot reminderEnabled must be false');
  console.log('  ✓ Enabled slot successfully toggled to disabled');
}

// Test 2: Toggling a disabled slot sets it to enabled
function testToggleDisabledToEnabled() {
  console.log('Test 2: Toggling a disabled slot sets it to enabled...');
  const med = createTestMedication();
  const result = toggleSlotReminderPure([med], med.id, 'slot-night');

  assert.ok(result, 'Result must be returned for valid medication and slot');
  assert.strictEqual(result.nextReminderEnabled, true, 'nextReminderEnabled must be true');
  const targetSlot = result.updatedMedication.timeSlots.find((s) => s.id === 'slot-night');
  assert.strictEqual(targetSlot?.reminderEnabled, true, 'Slot reminderEnabled must be true');
  console.log('  ✓ Disabled slot successfully toggled to enabled');
}

// Test 3: The updated medication is persisted through medicationRepository.saveMedication()
async function testPersistenceThroughRepository() {
  console.log('Test 3: Persistence through medicationRepository.saveMedication()...');
  clearMedicationSaveQueues();
  const med = createTestMedication('med-repo-persist');
  let currentMeds = [med];

  let saveMedicationCalledWith: Medication | null = null;
  let updateStorageInfoCalled = false;

  const result = handleSlotReminderToggle(med.id, 'slot-morning', {
    getMedications: () => currentMeds,
    setMedications: (nextMeds) => {
      currentMeds = nextMeds;
    },
    saveMedication: async (savedMed) => {
      saveMedicationCalledWith = savedMed;
      return savedMed;
    },
    updateStorageInfo: () => {
      updateStorageInfoCalled = true;
    },
  });

  assert.strictEqual(result.success, true);
  assert.ok(result.savePromise, 'Must return a savePromise');

  // Verify immediate optimistic UI update before promise resolution
  assert.strictEqual(
    currentMeds[0].timeSlots.find((s) => s.id === 'slot-morning')?.reminderEnabled,
    false,
    'Optimistic UI state must be updated immediately'
  );

  await result.savePromise;

  assert.ok(saveMedicationCalledWith, 'saveMedication must be called');
  const savedSlot = (saveMedicationCalledWith as Medication).timeSlots.find(
    (s) => s.id === 'slot-morning'
  );
  assert.strictEqual(savedSlot?.reminderEnabled, false, 'Persisted slot must have reminderEnabled=false');
  assert.strictEqual(updateStorageInfoCalled, true, 'updateStorageInfo must be invoked after persistence');
  console.log('  ✓ Updated medication persisted through medicationRepository.saveMedication()');
}

// Test 4: The updated medication is synced to Firestore when authenticated (and skipped when unauthenticated)
async function testFirestoreSyncBehavior() {
  console.log('Test 4: Firestore sync when authenticated vs unauthenticated...');
  clearMedicationSaveQueues();

  // Case A: Authenticated user
  let firestoreSyncPayload: { uid: string; med: Medication } | null = null;
  const medA = createTestMedication('med-auth');
  let medsA = [medA];

  const resultAuth = handleSlotReminderToggle(medA.id, 'slot-evening', {
    getMedications: () => medsA,
    setMedications: (next) => {
      medsA = next;
    },
    saveMedication: async (m) => m,
    saveToFirestore: async (uid, med) => {
      firestoreSyncPayload = { uid, med };
    },
    cloudUserUid: 'usr-firebase-456',
  });

  await resultAuth.savePromise;
  assert.ok(firestoreSyncPayload, 'Firestore sync must be called when authenticated');
  assert.strictEqual((firestoreSyncPayload as any).uid, 'usr-firebase-456');
  assert.strictEqual(
    (firestoreSyncPayload as any).med.timeSlots.find((s: TimeSlot) => s.id === 'slot-evening')?.reminderEnabled,
    false
  );

  // Case B: Unauthenticated user (cloudUserUid is null)
  let unauthSyncAttempted = false;
  const medB = createTestMedication('med-unauth');
  let medsB = [medB];

  const resultUnauth = handleSlotReminderToggle(medB.id, 'slot-evening', {
    getMedications: () => medsB,
    setMedications: (next) => {
      medsB = next;
    },
    saveMedication: async (m) => m,
    saveToFirestore: async () => {
      unauthSyncAttempted = true;
    },
    cloudUserUid: null,
  });

  await resultUnauth.savePromise;
  assert.strictEqual(unauthSyncAttempted, false, 'Firestore sync must NOT be called when unauthenticated');
  console.log('  ✓ Firestore sync correctly conditioned on authenticated cloud user');
}

// Test 5: No persistence or sync occurs for an unknown medication or slot
async function testUnknownMedicationOrSlotGuards() {
  console.log('Test 5: Guards against unknown medication or slot...');
  clearMedicationSaveQueues();
  const med = createTestMedication('med-guard');
  let meds = [med];
  let saveAttempted = false;
  let firestoreAttempted = false;

  const dummyDeps = {
    getMedications: () => meds,
    setMedications: (next: Medication[]) => {
      meds = next;
    },
    saveMedication: async (m: Medication) => {
      saveAttempted = true;
      return m;
    },
    saveToFirestore: async () => {
      firestoreAttempted = true;
    },
    cloudUserUid: 'uid-test',
  };

  // Case A: Nonexistent medication
  const resBadMed = handleSlotReminderToggle('med-nonexistent', 'slot-morning', dummyDeps);
  assert.strictEqual(resBadMed.success, false);
  assert.strictEqual(resBadMed.reason, 'not_found');
  assert.strictEqual(saveAttempted, false);
  assert.strictEqual(firestoreAttempted, false);

  // Case B: Nonexistent slot
  const resBadSlot = handleSlotReminderToggle(med.id, 'slot-nonexistent', dummyDeps);
  assert.strictEqual(resBadSlot.success, false);
  assert.strictEqual(resBadSlot.reason, 'not_found');
  assert.strictEqual(saveAttempted, false);
  assert.strictEqual(firestoreAttempted, false);

  console.log('  ✓ No persistence or sync occurs for unknown medication or slot');
}

// Test 6: Other slots remain unchanged and medication fields are preserved
function testPreservesOtherSlotsAndFields() {
  console.log('Test 6: Other slots and medication fields preservation...');
  const med = createTestMedication('med-preserve');
  const result = toggleSlotReminderPure([med], med.id, 'slot-morning');

  assert.ok(result);
  const updated = result.updatedMedication;

  // Check that other slots are untouched
  const slotEvening = updated.timeSlots.find((s) => s.id === 'slot-evening');
  const slotNight = updated.timeSlots.find((s) => s.id === 'slot-night');
  assert.strictEqual(slotEvening?.reminderEnabled, true, 'Evening slot must remain enabled');
  assert.strictEqual(slotNight?.reminderEnabled, false, 'Night slot must remain disabled');

  // Check top-level medication fields
  assert.strictEqual(updated.name, med.name);
  assert.strictEqual(updated.strength, med.strength);
  assert.strictEqual(updated.purpose, med.purpose);
  assert.strictEqual(updated.instructions, med.instructions);
  assert.strictEqual(updated.frequency, med.frequency);
  assert.strictEqual(updated.startDate, med.startDate);
  assert.strictEqual(updated.active, med.active);
  assert.strictEqual(updated.inventory.currentUnits, med.inventory.currentUnits);
  assert.strictEqual(updated.inventory.capacityUnits, med.inventory.capacityUnits);

  console.log('  ✓ All other slots and medication fields strictly preserved');
}

// Test 7: The setting survives reload/reload-style repository hydration
async function testSurvivesRepositoryHydration() {
  console.log('Test 7: Survives reload / repository hydration...');
  clearMedicationSaveQueues();
  await medicationRepository.ensureReady();

  const med = createTestMedication('med-hydration-test');
  await medicationRepository.saveMedication(med);

  // Toggle slot-morning to disabled via the handler using the real repository
  let inMemoryMeds = [med];
  const res = handleSlotReminderToggle(med.id, 'slot-morning', {
    getMedications: () => inMemoryMeds,
    setMedications: (next) => {
      inMemoryMeds = next;
    },
    saveMedication: (m) => medicationRepository.saveMedication(m),
    updateStorageInfo: () => {},
  });

  await res.savePromise;

  // Simulate a full app reload / hydration by querying fresh from repository
  const reloadedMed = await medicationRepository.getMedicationById(med.id);
  assert.ok(reloadedMed, 'Medication must exist in repository after reload');
  const reloadedSlot = reloadedMed.timeSlots.find((s) => s.id === 'slot-morning');
  assert.strictEqual(
    reloadedSlot?.reminderEnabled,
    false,
    'Slot reminder toggle must survive storage reload and hydration'
  );

  // Now re-enable and verify it survives reload again
  const resReenable = handleSlotReminderToggle(med.id, 'slot-morning', {
    getMedications: () => [reloadedMed],
    setMedications: (next) => {
      inMemoryMeds = next;
    },
    saveMedication: (m) => medicationRepository.saveMedication(m),
    updateStorageInfo: () => {},
  });

  await resReenable.savePromise;
  const reloadedAgain = await medicationRepository.getMedicationById(med.id);
  const reloadedSlotAgain = reloadedAgain?.timeSlots.find((s) => s.id === 'slot-morning');
  assert.strictEqual(
    reloadedSlotAgain?.reminderEnabled,
    true,
    'Re-enabled slot must survive storage reload and hydration'
  );

  console.log('  ✓ Setting persists and survives reload / repository hydration');
}

// Test 8: Notification scheduling excludes a disabled slot
function testNotificationExcludesDisabledSlot() {
  console.log('Test 8: Notification scheduling excludes disabled slot...');
  const baseMed = createTestMedication('med-notif');
  // Disable morning slot
  const disabledMed: Medication = {
    ...baseMed,
    timeSlots: baseMed.timeSlots.map((s) =>
      s.id === 'slot-morning' ? { ...s, reminderEnabled: false } : s
    ),
  };

  const fakeNow = new Date('2026-10-14T06:00:00Z').getTime();
  const triggers = computeUpcomingNotificationTriggers([disabledMed], 0, fakeNow);

  const morningTrigger = triggers.find((t) => t.slotId === 'slot-morning');
  const eveningTrigger = triggers.find((t) => t.slotId === 'slot-evening');

  assert.strictEqual(morningTrigger, undefined, 'Disabled slot-morning must NOT be scheduled');
  assert.ok(eveningTrigger, 'Enabled slot-evening must be scheduled');
  console.log('  ✓ Notification engine strictly excludes disabled slots from scheduled alarms');
}

// Test 9: Re-enabling the slot restores its notification schedule
function testReenablingRestoresNotificationSchedule() {
  console.log('Test 9: Re-enabling slot restores notification schedule...');
  const baseMed = createTestMedication('med-notif-restore');
  // Re-enable morning slot
  const enabledMed: Medication = {
    ...baseMed,
    timeSlots: baseMed.timeSlots.map((s) =>
      s.id === 'slot-morning' ? { ...s, reminderEnabled: true } : s
    ),
  };

  const fakeNow = new Date('2026-10-14T06:00:00Z').getTime();
  const triggers = computeUpcomingNotificationTriggers([enabledMed], 0, fakeNow);

  const morningTrigger = triggers.find((t) => t.slotId === 'slot-morning');
  assert.ok(morningTrigger, 'Re-enabled slot-morning must be restored in scheduled triggers');
  assert.strictEqual(morningTrigger.scheduledTime, '08:00');
  console.log('  ✓ Notification schedule restored after re-enabling slot');
}

// Test 10: Rapid consecutive toggles do not persist an obsolete snapshot
async function testRapidConsecutiveTogglesNoStaleSnapshot() {
  console.log('Test 10: Rapid consecutive toggles do not persist obsolete snapshots...');
  clearMedicationSaveQueues();

  const med = createTestMedication('med-rapid-race');
  let currentMeds = [med];
  const savedSnapshots: Medication[] = [];

  // Mock save with artificial random delay to simulate network/disk latency
  const mockSaveMedication = async (m: Medication): Promise<Medication> => {
    // Artificial delay: first save takes 30ms, second save takes 5ms
    const delay = savedSnapshots.length === 0 ? 30 : 5;
    await new Promise((resolve) => setTimeout(resolve, delay));
    savedSnapshots.push(JSON.parse(JSON.stringify(m)));
    return m;
  };

  // Perform Toggle 1: slot-morning true -> false
  const res1 = handleSlotReminderToggle(med.id, 'slot-morning', {
    getMedications: () => currentMeds,
    setMedications: (next) => {
      currentMeds = next;
    },
    saveMedication: mockSaveMedication,
  });

  // IMMEDIATELY perform Toggle 2 synchronously in the same tick:
  // slot-morning false -> true (user clicked again rapidly)
  const res2 = handleSlotReminderToggle(med.id, 'slot-morning', {
    getMedications: () => currentMeds,
    setMedications: (next) => {
      currentMeds = next;
    },
    saveMedication: mockSaveMedication,
  });

  // IMMEDIATELY perform Toggle 3 synchronously:
  // slot-evening true -> false
  const res3 = handleSlotReminderToggle(med.id, 'slot-evening', {
    getMedications: () => currentMeds,
    setMedications: (next) => {
      currentMeds = next;
    },
    saveMedication: mockSaveMedication,
  });

  assert.strictEqual(res1.success, true);
  assert.strictEqual(res2.success, true);
  assert.strictEqual(res3.success, true);

  // In-memory / optimistic state check:
  const latestMed = currentMeds[0];
  const morningSlot = latestMed.timeSlots.find((s) => s.id === 'slot-morning');
  const eveningSlot = latestMed.timeSlots.find((s) => s.id === 'slot-evening');
  assert.strictEqual(morningSlot?.reminderEnabled, true, 'Slot morning must be true after toggling twice');
  assert.strictEqual(eveningSlot?.reminderEnabled, false, 'Slot evening must be false after toggle 3');

  // Await all persistence promises
  await Promise.all([res1.savePromise, res2.savePromise, res3.savePromise]);

  // Verify that all 3 saves were executed in chronological order
  assert.strictEqual(savedSnapshots.length, 3, 'Must have executed all 3 saves');

  // Final saved snapshot must match the latest in-memory state:
  const finalSaved = savedSnapshots[2];
  const finalSavedMorning = finalSaved.timeSlots.find((s) => s.id === 'slot-morning');
  const finalSavedEvening = finalSaved.timeSlots.find((s) => s.id === 'slot-evening');

  assert.strictEqual(
    finalSavedMorning?.reminderEnabled,
    true,
    'Final persisted snapshot MUST have morning slot enabled (true), not obsolete stale false'
  );
  assert.strictEqual(
    finalSavedEvening?.reminderEnabled,
    false,
    'Final persisted snapshot MUST have evening slot disabled (false)'
  );

  console.log('  ✓ Rapid consecutive toggles serialized correctly without obsolete snapshots');
}

// Run all tests
async function runAll() {
  try {
    testToggleEnabledToDisabled();
    testToggleDisabledToEnabled();
    await testPersistenceThroughRepository();
    await testFirestoreSyncBehavior();
    await testUnknownMedicationOrSlotGuards();
    testPreservesOtherSlotsAndFields();
    await testSurvivesRepositoryHydration();
    testNotificationExcludesDisabledSlot();
    testReenablingRestoresNotificationSchedule();
    await testRapidConsecutiveTogglesNoStaleSnapshot();

    console.log('\n======================================================');
    console.log(' ALL SLOT REMINDER PERSISTENCE REGRESSIONS PASSED (OK) ');
    console.log('======================================================\n');
  } catch (err) {
    console.error('\nFAILED: Slot Reminder Persistence Suite', err);
    process.exit(1);
  }
}

runAll();
