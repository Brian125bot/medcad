'use client';

/**
 * CadenceRx — State Interface & Store Provider (COR-71)
 * 
 * Public state management store exposing offline-first encrypted persistence
 * for all views and state consumers.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import {
  DoseLogMap,
  Medication,
  toDateKey,
} from './medication-data';
import { medicationRepository } from './storage/repository';
import { StorageBenchmarkResult, StorageEngineInfo } from './storage/database';

export interface MedicationStoreState {
  medications: Medication[];
  logs: DoseLogMap;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  isReady: boolean;
  storageInfo: StorageEngineInfo;
  benchmarkResult: StorageBenchmarkResult | null;
  logDose: (
    dateKey: string,
    medicationId: string,
    slotId: string,
    status: 'taken' | 'skipped' | 'missed',
    note?: string
  ) => Promise<void>;
  undoDose: (
    dateKey: string,
    medicationId: string,
    slotId: string
  ) => Promise<void>;
  saveMedication: (med: Medication) => Promise<void>;
  deleteMedication: (id: string) => Promise<void>;
  toggleActiveMedication: (id: string) => Promise<void>;
  refillMedication: (
    id: string,
    unitsToAdd: number,
    notes?: string
  ) => Promise<void>;
  resetSampleData: () => Promise<void>;
  runLatencyBenchmark: () => Promise<StorageBenchmarkResult>;
  refreshFromDisk: () => Promise<void>;
}

const MedicationStoreContext = createContext<MedicationStoreState | null>(null);

export function MedicationStoreProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [medications, setMedications] = useState<Medication[]>([]);
  const [logs, setLogs] = useState<DoseLogMap>({});
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    toDateKey(new Date())
  );
  const [isReady, setIsReady] = useState<boolean>(false);
  const [storageInfo, setStorageInfo] = useState<StorageEngineInfo>(() =>
    medicationRepository.getStorageEngineInfo()
  );
  const [benchmarkResult, setBenchmarkResult] =
    useState<StorageBenchmarkResult | null>(null);

  // Initialize repository and execute migrations on mount
  useEffect(() => {
    let isMounted = true;

    async function bootstrap() {
      try {
        await medicationRepository.ensureReady();
        const loadedMeds = await medicationRepository.getAllMedications();
        const loadedLogs = await medicationRepository.getAllDoseLogs();

        if (isMounted) {
          setMedications(loadedMeds);
          setLogs(loadedLogs);
          setStorageInfo(medicationRepository.getStorageEngineInfo());
          setIsReady(true);
        }
      } catch (err) {
        console.error('Failed to initialize local encrypted repository:', err);
        if (isMounted) {
          setIsReady(true);
        }
      }
    }

    bootstrap();

    return () => {
      isMounted = false;
    };
  }, []);

  const refreshFromDisk = useCallback(async () => {
    const loadedMeds = await medicationRepository.getAllMedications();
    const loadedLogs = await medicationRepository.getAllDoseLogs();
    setMedications(loadedMeds);
    setLogs(loadedLogs);
    setStorageInfo(medicationRepository.getStorageEngineInfo());
  }, []);

  const logDose = useCallback(
    async (
      dateKey: string,
      medicationId: string,
      slotId: string,
      status: 'taken' | 'skipped' | 'missed',
      note?: string
    ) => {
      const { log, updatedMedication } = await medicationRepository.logDose(
        dateKey,
        medicationId,
        slotId,
        status,
        note
      );

      setLogs((prev) => ({
        ...prev,
        [log.key]: log,
      }));

      if (updatedMedication) {
        setMedications((prev) =>
          prev.map((m) => (m.id === medicationId ? updatedMedication : m))
        );
      }

      setStorageInfo(medicationRepository.getStorageEngineInfo());
    },
    []
  );

  const undoDose = useCallback(
    async (dateKey: string, medicationId: string, slotId: string) => {
      const { undoneKey, updatedMedication } = await medicationRepository.undoDose(
        dateKey,
        medicationId,
        slotId
      );

      setLogs((prev) => {
        const next = { ...prev };
        delete next[undoneKey];
        return next;
      });

      if (updatedMedication) {
        setMedications((prev) =>
          prev.map((m) => (m.id === medicationId ? updatedMedication : m))
        );
      }

      setStorageInfo(medicationRepository.getStorageEngineInfo());
    },
    []
  );

  const saveMedication = useCallback(async (med: Medication) => {
    const saved = await medicationRepository.saveMedication(med);
    setMedications((prev) => {
      const idx = prev.findIndex((m) => m.id === med.id);
      if (idx >= 0) {
        return prev.map((m) => (m.id === med.id ? saved : m));
      }
      return [...prev, saved];
    });
    setStorageInfo(medicationRepository.getStorageEngineInfo());
  }, []);

  const deleteMedication = useCallback(async (id: string) => {
    await medicationRepository.deleteMedication(id);
    setMedications((prev) => prev.filter((m) => m.id !== id));
    setStorageInfo(medicationRepository.getStorageEngineInfo());
  }, []);

  const toggleActiveMedication = useCallback(async (id: string) => {
    const updated = await medicationRepository.toggleActiveMedication(id);
    if (updated) {
      setMedications((prev) =>
        prev.map((m) => (m.id === id ? updated : m))
      );
      setStorageInfo(medicationRepository.getStorageEngineInfo());
    }
  }, []);

  const refillMedication = useCallback(
    async (id: string, unitsToAdd: number, notes?: string) => {
      const updated = await medicationRepository.refillMedication(
        id,
        unitsToAdd,
        notes
      );
      if (updated) {
        setMedications((prev) =>
          prev.map((m) => (m.id === id ? updated : m))
        );
        setStorageInfo(medicationRepository.getStorageEngineInfo());
      }
    },
    []
  );

  const resetSampleData = useCallback(async () => {
    const seeded = await medicationRepository.resetSampleData();
    setMedications(seeded.medications);
    setLogs(seeded.logs);
    setSelectedDate(toDateKey(new Date()));
    setStorageInfo(medicationRepository.getStorageEngineInfo());
  }, []);

  const runLatencyBenchmark = useCallback(async () => {
    const res = await medicationRepository.runBenchmark();
    setBenchmarkResult(res);
    setStorageInfo(medicationRepository.getStorageEngineInfo());
    return res;
  }, []);

  const value: MedicationStoreState = {
    medications,
    logs,
    selectedDate,
    setSelectedDate,
    isReady,
    storageInfo,
    benchmarkResult,
    logDose,
    undoDose,
    saveMedication,
    deleteMedication,
    toggleActiveMedication,
    refillMedication,
    resetSampleData,
    runLatencyBenchmark,
    refreshFromDisk,
  };

  return (
    <MedicationStoreContext.Provider value={value}>
      {children}
    </MedicationStoreContext.Provider>
  );
}

export function useMedicationStore(): MedicationStoreState {
  const context = useContext(MedicationStoreContext);
  if (!context) {
    throw new Error(
      'useMedicationStore must be used within a MedicationStoreProvider'
    );
  }
  return context;
}
