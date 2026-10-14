import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  writeBatch,
  Unsubscribe,
  serverTimestamp,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { Medication, DoseLogMap, DoseLogEntry } from './medication-data';

export type DoseLog = DoseLogEntry & { id?: string };

export interface UserSettingsDoc {
  userId: string;
  migrationCompleted: boolean;
  lastSyncedAt?: string;
  remindersEnabled?: boolean;
}

// Subscribe to real-time changes in user medications collection
export function subscribeToUserMedications(
  userId: string,
  onMedicationsChange: (meds: Medication[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const collPath = `users/${userId}/medications`;
  const collRef = collection(db, 'users', userId, 'medications');

  return onSnapshot(
    collRef,
    (snapshot) => {
      const medications: Medication[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as Medication;
        medications.push(data);
      });
      onMedicationsChange(medications);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, collPath);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

// Subscribe to real-time changes in user doseLogs collection
export function subscribeToUserDoseLogs(
  userId: string,
  onLogsChange: (logs: DoseLogMap) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const collPath = `users/${userId}/doseLogs`;
  const collRef = collection(db, 'users', userId, 'doseLogs');

  return onSnapshot(
    collRef,
    (snapshot) => {
      const logMap: DoseLogMap = {};
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as DoseLog;
        const logKey = data.key || data.id || docSnap.id;
        if (logKey && data.status) {
          logMap[logKey] = {
            key: logKey,
            dateKey: data.dateKey,
            medicationId: data.medicationId,
            slotId: data.slotId,
            status: data.status,
            loggedAt: data.loggedAt,
            note: data.note,
          };
        }
      });
      onLogsChange(logMap);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, collPath);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

// Check whether user has cloud data or needs migration
export async function checkUserCloudDataState(userId: string): Promise<{
  hasCloudData: boolean;
  medicationCount: number;
  logCount: number;
}> {
  const medsPath = `users/${userId}/medications`;
  try {
    const medsSnap = await getDocs(
      collection(db, 'users', userId, 'medications')
    );
    const logsSnap = await getDocs(
      collection(db, 'users', userId, 'doseLogs')
    );
    return {
      hasCloudData: !medsSnap.empty,
      medicationCount: medsSnap.size,
      logCount: logsSnap.size,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, medsPath);
  }
}

// Save or update a single medication in Firestore
export async function saveMedicationToFirestore(
  userId: string,
  medication: Medication
): Promise<void> {
  const docPath = `users/${userId}/medications/${medication.id}`;
  try {
    const docRef = doc(db, 'users', userId, 'medications', medication.id);
    const sanitizedMed: Record<string, unknown> = {
      ...medication,
      updatedAt: new Date().toISOString(),
      serverTimestamp: serverTimestamp(),
    };
    await setDoc(docRef, sanitizedMed, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, docPath);
  }
}

// Delete a medication from Firestore
export async function deleteMedicationFromFirestore(
  userId: string,
  medicationId: string
): Promise<void> {
  const docPath = `users/${userId}/medications/${medicationId}`;
  try {
    const docRef = doc(db, 'users', userId, 'medications', medicationId);
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}

// Save or update a dose log in Firestore
export async function saveDoseLogToFirestore(
  userId: string,
  log: DoseLog
): Promise<void> {
  const docId = log.id || log.key;
  if (!docId) return;
  const docPath = `users/${userId}/doseLogs/${docId}`;
  try {
    const docRef = doc(db, 'users', userId, 'doseLogs', docId);
    const sanitizedLog: Record<string, unknown> = {
      ...log,
      id: docId,
      key: log.key || docId,
      updatedAt: new Date().toISOString(),
      serverTimestamp: serverTimestamp(),
    };
    await setDoc(docRef, sanitizedLog, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, docPath);
  }
}

// Delete a dose log from Firestore (e.g. on Undo)
export async function deleteDoseLogFromFirestore(
  userId: string,
  logId: string
): Promise<void> {
  const docPath = `users/${userId}/doseLogs/${logId}`;
  try {
    const docRef = doc(db, 'users', userId, 'doseLogs', logId);
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}

// Migrate local browser state into Firestore in a batch
export async function migrateLocalDataToFirestore(
  userId: string,
  medications: Medication[],
  logs: DoseLogMap,
  userEmail?: string | null,
  displayName?: string | null
): Promise<{ migratedMeds: number; migratedLogs: number }> {
  const batch = writeBatch(db);

  // 1. User profile root document
  const userDocRef = doc(db, 'users', userId);
  batch.set(
    userDocRef,
    {
      uid: userId,
      email: userEmail || '',
      displayName: displayName || '',
      updatedAt: new Date().toISOString(),
      serverTimestamp: serverTimestamp(),
    },
    { merge: true }
  );

  // 2. Settings document
  const settingsDocRef = doc(db, 'users', userId, 'settings', 'preferences');
  batch.set(
    settingsDocRef,
    {
      userId,
      migrationCompleted: true,
      lastSyncedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  // 3. Medications
  medications.forEach((med) => {
    const medRef = doc(db, 'users', userId, 'medications', med.id);
    batch.set(
      medRef,
      {
        ...med,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  });

  // 4. Dose Logs (write up to batch limits)
  const logKeys = Object.keys(logs);
  logKeys.slice(0, 400).forEach((logKey) => {
    const log = logs[logKey];
    if (log) {
      const docId = log.key || logKey;
      const logRef = doc(db, 'users', userId, 'doseLogs', docId);
      batch.set(
        logRef,
        {
          ...log,
          id: docId,
          key: docId,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }
  });

  try {
    await batch.commit();
    return {
      migratedMeds: medications.length,
      migratedLogs: Math.min(logKeys.length, 400),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${userId}`);
  }
}
