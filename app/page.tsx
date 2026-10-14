'use client';

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useSyncExternalStore,
} from 'react';
import {
  Plus,
  CheckCircle2,
  AlertTriangle,
  Download,
  Bell,
  BellOff,
  Calendar,
} from 'lucide-react';
import {
  Medication,
  DoseLogMap,
  ScheduledDoseInstance,
  toDateKey,
  createInitialSeedData,
  buildDoseKey,
  getScheduledDosesForDate,
  computeAdherenceAnalytics,
  diffDaysBetweenKeys,
  computeRecommendedNextFillDate,
  getEffectiveLeadMinutes,
} from '@/lib/medication-data';
import {
  ReminderSettings,
  SnoozedReminder,
  ActiveAlertItem,
  DEFAULT_REMINDER_SETTINGS,
  STORAGE_REMINDERS_KEY,
  STORAGE_SNOOZED_KEY,
  playReminderChime,
  dispatchNativeNotification,
} from '@/lib/reminders';
import {
  initAuth,
  googleSignIn,
  getAccessToken,
  logoutGoogle,
  listCalendarRefillEvents,
  createCalendarFillEvent,
  updateCalendarFillEvent,
  deleteCalendarFillEvent,
  GoogleCalendarEventItem,
} from '@/lib/google-calendar';
import {
  auth as firebaseAuth,
  FirebaseUser,
  testConnection,
} from '@/lib/firebase';
import {
  subscribeToUserMedications,
  subscribeToUserDoseLogs,
  checkUserCloudDataState,
  migrateLocalDataToFirestore,
  saveMedicationToFirestore,
  deleteMedicationFromFirestore,
  saveDoseLogToFirestore,
  deleteDoseLogFromFirestore,
} from '@/lib/firestore-sync';
import { CloudSyncStatus } from '@/components/CloudSyncStatus';
import DailyLogView from '@/components/DailyLogView';
import WeeklyMatrixView from '@/components/WeeklyMatrixView';
import MonthlyAnalyticsView from '@/components/MonthlyAnalyticsView';
import CabinetInventoryView from '@/components/CabinetInventoryView';
import MedicationModal from '@/components/MedicationModal';
import RemindersHubModal from '@/components/RemindersHubModal';
import ActiveReminderBanner from '@/components/ActiveReminderBanner';
import BulkSyncProgressModal, {
  BulkSyncItemProgress,
} from '@/components/BulkSyncProgressModal';
import StorageEncryptionBadge from '@/components/StorageEncryptionBadge';
import NotificationPermissionModal from '@/components/NotificationPermissionModal';
import {
  initNotificationEngine,
  rescheduleAllMedicationReminders,
  scheduleSnoozeNotification,
  addNotificationResponseReceivedListener,
  ACTION_TAKE_DOSE,
  ACTION_SNOOZE_15,
  checkNotificationPermission,
  getNotificationPreferences,
  saveNotificationPreferences,
  cancelAllScheduledNotifications,
  handleNotificationAction,
} from '@/lib/notifications';
import { medicationRepository } from '@/lib/storage/repository';
import { StorageBenchmarkResult, StorageEngineInfo } from '@/lib/storage/database';

type WorkspaceView = 'daily' | 'weekly' | 'monthly' | 'cabinet';

const STORAGE_MEDS_KEY = 'cadencerx_medications_v1';
const STORAGE_LOGS_KEY = 'cadencerx_logs_v1';

const subscribeNoop = () => () => {};

export default function CadenceRxPage() {
  const isHydrated = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false
  );

  if (!isHydrated) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-8">
          <span
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
            style={{fontFamily: 'var(--font-display), sans-serif'}}
          >
            CadenceRx
          </span>
          <div className="text-xs text-slate-500">
            Loading medication workspace...
          </div>
        </header>
      </div>
    );
  }

  return <CadenceRxWorkspace />;
}

function CadenceRxWorkspace() {
  const [todayKey] = useState<string>(() => toDateKey(new Date()));
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    toDateKey(new Date())
  );
  const [activeView, setActiveView] = useState<WorkspaceView>('daily');
  const [medications, setMedications] = useState<Medication[]>(() => {
    const tKey = toDateKey(new Date());
    try {
      const saved = localStorage.getItem(STORAGE_MEDS_KEY);
      if (saved) {
        const parsed: Medication[] = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((m) => ({
            ...m,
            inventory: {
              ...m.inventory,
              nextFillDate:
                m.inventory.nextFillDate ||
                computeRecommendedNextFillDate(m, tKey),
            },
          }));
        }
      }
    } catch {}
    return createInitialSeedData(tKey).medications;
  });
  const [logs, setLogs] = useState<DoseLogMap>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_LOGS_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {}
    return createInitialSeedData(toDateKey(new Date())).logs;
  });

  // Local Encrypted Relational Storage Engine State (COR-71)
  const [storageInfo, setStorageInfo] = useState<StorageEngineInfo>(() =>
    medicationRepository.getStorageEngineInfo()
  );
  const [benchmarkResult, setBenchmarkResult] =
    useState<StorageBenchmarkResult | null>(null);

  // Hydrate state from local encrypted vault on mount
  useEffect(() => {
    let isCancelled = false;
    async function loadEncryptedVault() {
      try {
        await medicationRepository.ensureReady();
        const loadedMeds = await medicationRepository.getAllMedications();
        const loadedLogs = await medicationRepository.getAllDoseLogs();
        if (!isCancelled) {
          if (loadedMeds.length > 0) {
            setMedications(loadedMeds);
          }
          if (Object.keys(loadedLogs).length > 0) {
            setLogs(loadedLogs);
          }
          setStorageInfo(medicationRepository.getStorageEngineInfo());
        }
      } catch (err) {
        console.error('Failed to hydrate from encrypted vault:', err);
      }
    }
    loadEncryptedVault();
    return () => {
      isCancelled = true;
    };
  }, []);

  const handleRunStorageBenchmark = useCallback(async (): Promise<StorageBenchmarkResult> => {
    const res = await medicationRepository.runBenchmark();
    setBenchmarkResult(res);
    setStorageInfo(medicationRepository.getStorageEngineInfo());
    return res;
  }, []);

  // Modal & Toast Feedback State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingMedication, setEditingMedication] =
    useState<Medication | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  const triggerFeedback = useCallback((message: string) => {
    setFeedbackBanner(message);
  }, []);

  // Google Calendar Integration State
  const [isGoogleAuthenticated, setIsGoogleAuthenticated] =
    useState<boolean>(false);
  const [googleUserEmail, setGoogleUserEmail] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);
  const [isSyncingCalendar, setIsSyncingCalendar] = useState<boolean>(false);
  const [calendarEvents, setCalendarEvents] = useState<
    GoogleCalendarEventItem[]
  >([]);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  // Firebase Cloud Data Persistence & Real-time Sync State
  const [cloudUser, setCloudUser] = useState<FirebaseUser | null>(() => firebaseAuth.currentUser);
  const [isCloudSyncing, setIsCloudSyncing] = useState<boolean>(false);
  const [isCloudMigrating, setIsCloudMigrating] = useState<boolean>(false);
  const [cloudSyncError, setCloudSyncError] = useState<string | null>(null);
  const hasAttemptedMigrationRef = useRef<boolean>(false);

  // Bulk Sync Progress State
  const [isBulkSyncModalOpen, setIsBulkSyncModalOpen] =
    useState<boolean>(false);
  const [isBulkSyncProcessing, setIsBulkSyncProcessing] =
    useState<boolean>(false);
  const [bulkSyncItems, setBulkSyncItems] = useState<BulkSyncItemProgress[]>(
    []
  );
  const [bulkSyncCurrentIndex, setBulkSyncCurrentIndex] = useState<number>(0);

  // Reminders & Alerts State
  const [isRemindersHubOpen, setIsRemindersHubOpen] = useState<boolean>(false);
  const [reminderSettings, setReminderSettings] = useState<ReminderSettings>(
    () => {
      try {
        const saved = localStorage.getItem(STORAGE_REMINDERS_KEY);
        if (saved) return JSON.parse(saved);
      } catch {}
      return DEFAULT_REMINDER_SETTINGS;
    }
  );
  const [snoozedReminders, setSnoozedReminders] = useState<SnoozedReminder[]>(
    () => {
      try {
        const saved = localStorage.getItem(STORAGE_SNOOZED_KEY);
        if (saved) return JSON.parse(saved);
      } catch {}
      return [];
    }
  );
  const [activeAlerts, setActiveAlerts] = useState<ActiveAlertItem[]>([]);

  // Prevent multiple alerts within the same minute for the same slot
  const alertedSlotsSetRef = useRef<Set<string>>(new Set());

  // Native Background Alarm & Notification Engine State (COR-76)
  const [
    isNotificationPermissionModalOpen,
    setIsNotificationPermissionModalOpen,
  ] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const prefs = getNotificationPreferences();
    const perm = checkNotificationPermission();
    return !prefs.hasSeenPermissionPrompt && perm === 'undetermined';
  });

  // Initialize Notification Engine on mount
  useEffect(() => {
    initNotificationEngine().catch((err) =>
      console.error('Failed to initialize notification engine:', err)
    );
  }, []);

  // Reactive notification rescheduling (COR-76 / Requirement 2)
  // Automatically reschedules whenever medications change (created, edited, paused, deleted)
  // or user changes their lead-time alert preference, browserAlertsEnabled, or globalMute
  useEffect(() => {
    // Keep notification preferences in sync with reminderSettings
    saveNotificationPreferences({
      enabled: reminderSettings.browserAlertsEnabled,
      globalMute: reminderSettings.globalMute,
      leadTimeMinutes: reminderSettings.leadTimeMinutes ?? 0,
      criticalChimeEnabled: reminderSettings.soundChimeEnabled,
    });

    if (!reminderSettings.globalMute && reminderSettings.browserAlertsEnabled) {
      rescheduleAllMedicationReminders(
        medications,
        reminderSettings.leadTimeMinutes ?? 0
      ).catch((err) =>
        console.error('Failed to reschedule medication reminders:', err)
      );
    } else {
      // Disabling alerts or enabling global mute cancels active timers and persisted schedules
      cancelAllScheduledNotifications();
    }
  }, [
    medications,
    reminderSettings.leadTimeMinutes,
    reminderSettings.browserAlertsEnabled,
    reminderSettings.globalMute,
    reminderSettings.soundChimeEnabled,
  ]);

  const latestMedsRef = useRef(medications);
  const latestLogsRef = useRef(logs);

  useEffect(() => {
    latestMedsRef.current = medications;
  }, [medications]);

  useEffect(() => {
    latestLogsRef.current = logs;
  }, [logs]);

  // Connection check on mount
  useEffect(() => {
    testConnection().catch(() => {});
  }, []);

  // Initialize Firebase Auth listener for Google Calendar and Firestore Cloud Persistence
  useEffect(() => {
    let unsubMeds: (() => void) | null = null;
    let unsubLogs: (() => void) | null = null;

    const unsubscribeAuth = initAuth(
      async (user, token) => {
        setIsGoogleAuthenticated(true);
        setGoogleUserEmail(user.email || user.displayName || 'Connected');
        setCloudUser(user);

        listCalendarRefillEvents(token)
          .then((items) => setCalendarEvents(items))
          .catch(() => {});

        // Auto-migration check: If user cloud account is new/empty, migrate local browser data
        if (!hasAttemptedMigrationRef.current) {
          hasAttemptedMigrationRef.current = true;
          try {
            setIsCloudSyncing(true);
            const state = await checkUserCloudDataState(user.uid);
            const currentLocalMeds = latestMedsRef.current;
            const currentLocalLogs = latestLogsRef.current;
            if (!state.hasCloudData && currentLocalMeds.length > 0) {
              setIsCloudMigrating(true);
              const migrationResult = await migrateLocalDataToFirestore(
                user.uid,
                currentLocalMeds,
                currentLocalLogs,
                user.email,
                user.displayName
              );
              triggerFeedback(
                `Migrated ${migrationResult.migratedMeds} medications and ${migrationResult.migratedLogs} logs to your Google Cloud account`
              );
              setIsCloudMigrating(false);
            }
          } catch (err: unknown) {
            console.error('Cloud migration error:', err);
            setCloudSyncError(
              err instanceof Error ? err.message : 'Cloud sync initialization failed'
            );
          } finally {
            setIsCloudSyncing(false);
            setIsCloudMigrating(false);
          }
        }

        // Set up real-time multi-device Firestore subscriptions
        if (unsubMeds) unsubMeds();
        if (unsubLogs) unsubLogs();

        unsubMeds = subscribeToUserMedications(
          user.uid,
          (cloudMeds) => {
            if (cloudMeds && cloudMeds.length > 0) {
              setMedications(cloudMeds);
            }
          },
          (err) => setCloudSyncError(err.message)
        );

        unsubLogs = subscribeToUserDoseLogs(
          user.uid,
          (cloudLogs) => {
            if (cloudLogs && Object.keys(cloudLogs).length > 0) {
              setLogs(cloudLogs);
            }
          },
          (err) => setCloudSyncError(err.message)
        );
      },
      () => {
        setIsGoogleAuthenticated(false);
        setGoogleUserEmail(null);
        setCloudUser(null);
        if (unsubMeds) {
          unsubMeds();
          unsubMeds = null;
        }
        if (unsubLogs) {
          unsubLogs();
          unsubLogs = null;
        }
      }
    );

    return () => {
      unsubscribeAuth();
      if (unsubMeds) unsubMeds();
      if (unsubLogs) unsubLogs();
    };
  }, [triggerFeedback]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_REMINDERS_KEY,
        JSON.stringify(reminderSettings)
      );
      localStorage.setItem(
        STORAGE_SNOOZED_KEY,
        JSON.stringify(snoozedReminders)
      );
    } catch {
      // Ignore quota errors
    }
  }, [reminderSettings, snoozedReminders]);

  useEffect(() => {
    if (!feedbackBanner) return;
    const timer = setTimeout(() => setFeedbackBanner(null), 3200);
    return () => clearTimeout(timer);
  }, [feedbackBanner]);

  const getCurrentTimestamp = (): string => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  // --- Background Reminder Scheduler Tick Runner ---
  useEffect(() => {
    const checkScheduledReminders = () => {
      if (reminderSettings.globalMute) return;

      const now = new Date();
      const currentH = now.getHours();
      const currentM = now.getMinutes();
      const currentMinutesOfDay = currentH * 60 + currentM;
      const nowMs = now.getTime();

      // 1. Check Snoozed Reminders for maturity
      if (snoozedReminders.length > 0) {
        const matureSnoozed = snoozedReminders.filter(
          (s) => nowMs >= s.fireAtTimestamp
        );
        if (matureSnoozed.length > 0) {
          // Remove from snoozed list
          setSnoozedReminders((prev) =>
            prev.filter((s) => nowMs < s.fireAtTimestamp)
          );

          matureSnoozed.forEach((s) => {
            // Check if already taken or skipped in logs
            const doseKey = s.doseKey;
            const existingLog = logs[doseKey];
            if (existingLog && existingLog.status !== 'missed') {
              return; // already handled
            }

            const alertItem: ActiveAlertItem = {
              id: `alert-snooze-${s.id}-${Date.now()}`,
              doseKey: s.doseKey,
              dateKey: s.dateKey,
              medicationId: s.medicationId,
              slotId: s.slotId,
              medicationName: s.medicationName,
              strength: s.strength,
              instructions: s.instructions,
              time: s.time,
              doseUnits: 1,
              form: 'Dose',
              isSnoozed: true,
              triggeredAt: getCurrentTimestamp(),
            };

            setActiveAlerts((prev) => {
              if (prev.some((a) => a.doseKey === alertItem.doseKey))
                return prev;
              return [alertItem, ...prev];
            });

            if (reminderSettings.soundChimeEnabled) {
              playReminderChime();
            }
            if (reminderSettings.browserAlertsEnabled) {
              dispatchNativeNotification(
                `CadenceRx Snooze: ${s.medicationName} (${s.strength})`,
                {
                  body: `Scheduled for ${s.time}. ${s.instructions || 'Dose is now due.'}`,
                  tag: `cadencerx-${s.doseKey}`,
                }
              );
            }
          });
        }
      }

      // 2. Check Today's Scheduled Pending Doses
      const todayDoses = getScheduledDosesForDate(
        medications,
        logs,
        todayKey,
        todayKey
      );

      for (const inst of todayDoses) {
        // Skip if reminder is explicitly turned off for this slot
        if (inst.slot.reminderEnabled === false) continue;
        // Skip if already taken or skipped
        if (inst.effectiveStatus !== 'pending') continue;

        const [slotH, slotM] = inst.slot.time.split(':').map(Number);
        const slotMinutesOfDay = slotH * 60 + slotM;
        const slotLead = getEffectiveLeadMinutes(
          inst.slot.leadMinutes,
          reminderSettings.leadTimeMinutes ?? 0
        );
        const targetAlertMinute = slotMinutesOfDay - slotLead;

        // Check if current minute matches target alert minute
        if (currentMinutesOfDay === targetAlertMinute) {
          const alertKey = `${todayKey}_${inst.medication.id}_${inst.slot.id}_${inst.slot.time}`;
          if (alertedSlotsSetRef.current.has(alertKey)) {
            continue; // already alerted today in this window
          }

          alertedSlotsSetRef.current.add(alertKey);

          const alertItem: ActiveAlertItem = {
            id: `alert-${inst.key}-${Date.now()}`,
            doseKey: inst.key,
            dateKey: inst.dateKey,
            medicationId: inst.medication.id,
            slotId: inst.slot.id,
            medicationName: inst.medication.name,
            strength: inst.medication.strength,
            instructions: inst.medication.instructions,
            time: inst.slot.time,
            doseUnits: inst.slot.doseUnits,
            form: inst.medication.form,
            triggeredAt: getCurrentTimestamp(),
          };

          setActiveAlerts((prev) => {
            if (prev.some((a) => a.doseKey === alertItem.doseKey)) return prev;
            return [alertItem, ...prev];
          });

          if (reminderSettings.soundChimeEnabled) {
            playReminderChime();
          }
          if (reminderSettings.browserAlertsEnabled) {
            dispatchNativeNotification(
              `CadenceRx Reminder: ${inst.medication.name} (${inst.medication.strength})`,
              {
                body: `Scheduled for ${inst.slot.time} (${inst.slot.label}). ${inst.medication.instructions || 'Take as directed'}`,
                tag: `cadencerx-${inst.key}`,
              }
            );
          }
        }
      }
    };

    // Run check every 12 seconds
    const intervalId = setInterval(checkScheduledReminders, 12000);
    return () => clearInterval(intervalId);
  }, [
    reminderSettings,
    snoozedReminders,
    medications,
    logs,
    todayKey,
  ]);

  const handleLogDose = (
    dateKey: string,
    medicationId: string,
    slotId: string,
    status: 'taken' | 'skipped' | 'missed',
    note?: string
  ) => {
    const key = buildDoseKey(dateKey, medicationId, slotId);
    const existingLog = logs[key];
    const med = medications.find((m) => m.id === medicationId);
    const slot = med?.timeSlots.find((s) => s.id === slotId);
    const doseUnits = slot?.doseUnits || 1;

    // Adjust inventory if transitioning to/from 'taken'
    if (med) {
      const wasTaken = existingLog?.status === 'taken';
      const willBeTaken = status === 'taken';

      if (!wasTaken && willBeTaken) {
        setMedications((prev) =>
          prev.map((m) =>
            m.id === medicationId
              ? {
                  ...m,
                  inventory: {
                    ...m.inventory,
                    currentUnits: Math.max(
                      0,
                      m.inventory.currentUnits - doseUnits
                    ),
                  },
                }
              : m
          )
        );
      } else if (wasTaken && !willBeTaken) {
        setMedications((prev) =>
          prev.map((m) =>
            m.id === medicationId
              ? {
                  ...m,
                  inventory: {
                    ...m.inventory,
                    currentUnits: m.inventory.currentUnits + doseUnits,
                  },
                }
              : m
          )
        );
      }
    }

    const nowStamp = getCurrentTimestamp();
    const newLogItem = {
      id: key,
      key,
      dateKey,
      medicationId,
      slotId,
      status,
      loggedAt: nowStamp,
      note,
    };

    setLogs((prev) => ({
      ...prev,
      [key]: newLogItem,
    }));

    if (cloudUser) {
      saveDoseLogToFirestore(cloudUser.uid, newLogItem).catch((err) =>
        console.error('Failed to sync dose log to cloud:', err)
      );
      if (med) {
        const wasTaken = existingLog?.status === 'taken';
        const willBeTaken = status === 'taken';
        let nextUnits = med.inventory.currentUnits;
        if (!wasTaken && willBeTaken) {
          nextUnits = Math.max(0, med.inventory.currentUnits - doseUnits);
        } else if (wasTaken && !willBeTaken) {
          nextUnits = med.inventory.currentUnits + doseUnits;
        }
        if (nextUnits !== med.inventory.currentUnits) {
          saveMedicationToFirestore(cloudUser.uid, {
            ...med,
            inventory: {
              ...med.inventory,
              currentUnits: nextUnits,
            },
          }).catch((err) =>
            console.error('Failed to sync medication units to cloud:', err)
          );
        }
      }
    }

    // Persist to local encrypted vault with sub-15ms write latency (COR-71)
    medicationRepository
      .logDose(dateKey, medicationId, slotId, status, note)
      .then(() => setStorageInfo(medicationRepository.getStorageEngineInfo()))
      .catch((err) =>
        console.error('Failed to log dose in local encrypted storage:', err)
      );

    // Dismiss any active alert or snooze for this dose
    setActiveAlerts((prev) => prev.filter((a) => a.doseKey !== key));
    setSnoozedReminders((prev) => prev.filter((s) => s.doseKey !== key));

    if (med) {
      triggerFeedback(
        status === 'taken'
          ? `Logged ${med.name} (${med.strength}) as taken`
          : `Marked ${med.name} (${med.strength}) as ${status}`
      );
    }
  };

  const handleUndoDose = (
    dateKey: string,
    medicationId: string,
    slotId: string
  ) => {
    const key = buildDoseKey(dateKey, medicationId, slotId);
    const existingLog = logs[key];
    if (!existingLog) return;

    const med = medications.find((m) => m.id === medicationId);
    const slot = med?.timeSlots.find((s) => s.id === slotId);
    const doseUnits = slot?.doseUnits || 1;

    if (existingLog.status === 'taken' && med) {
      const restoredUnits = med.inventory.currentUnits + doseUnits;
      setMedications((prev) =>
        prev.map((m) =>
          m.id === medicationId
            ? {
                ...m,
                inventory: {
                  ...m.inventory,
                  currentUnits: restoredUnits,
                },
              }
            : m
        )
      );
      if (cloudUser) {
        saveMedicationToFirestore(cloudUser.uid, {
          ...med,
          inventory: {
            ...med.inventory,
            currentUnits: restoredUnits,
          },
        }).catch((err) =>
          console.error('Failed to restore medication units in cloud:', err)
        );
      }
    }

    setLogs((prev) => {
      const next = {...prev};
      delete next[key];
      return next;
    });

    // Persist to local encrypted vault with sub-15ms write latency (COR-71)
    medicationRepository
      .undoDose(dateKey, medicationId, slotId)
      .then(() => setStorageInfo(medicationRepository.getStorageEngineInfo()))
      .catch((err) =>
        console.error('Failed to undo dose in local encrypted storage:', err)
      );

    if (cloudUser) {
      deleteDoseLogFromFirestore(cloudUser.uid, key).catch((err) =>
        console.error('Failed to delete dose log in cloud:', err)
      );
    }

    if (med) {
      triggerFeedback(`Reverted log for ${med.name}`);
    }
  };

  const handleLogAllBlock = (instances: ScheduledDoseInstance[]) => {
    if (instances.length === 0) return;
    const nowStamp = getCurrentTimestamp();

    const unitDeductions: Record<string, number> = {};
    const nextLogs: DoseLogMap = {...logs};

    for (const inst of instances) {
      const existing = nextLogs[inst.key];
      if (existing?.status !== 'taken') {
        unitDeductions[inst.medication.id] =
          (unitDeductions[inst.medication.id] || 0) + inst.slot.doseUnits;
      }
      const newLog = {
        key: inst.key,
        id: inst.key,
        dateKey: inst.dateKey,
        medicationId: inst.medication.id,
        slotId: inst.slot.id,
        status: 'taken' as const,
        loggedAt: nowStamp,
      };
      nextLogs[inst.key] = newLog;

      if (cloudUser) {
        saveDoseLogToFirestore(cloudUser.uid, newLog).catch((err) =>
          console.error('Failed to sync block dose log to cloud:', err)
        );
      }
    }

    setLogs(nextLogs);
    setMedications((prev) =>
      prev.map((m) => {
        const deduct = unitDeductions[m.id];
        if (!deduct) return m;
        const updatedUnits = Math.max(0, m.inventory.currentUnits - deduct);
        if (cloudUser) {
          saveMedicationToFirestore(cloudUser.uid, {
            ...m,
            inventory: {
              ...m.inventory,
              currentUnits: updatedUnits,
            },
          }).catch((err) =>
            console.error('Failed to sync block medication deduction to cloud:', err)
          );
        }
        return {
          ...m,
          inventory: {
            ...m.inventory,
            currentUnits: updatedUnits,
          },
        };
      })
    );

    // Persist bulk block to local encrypted repository
    medicationRepository
      .bulkSaveDoseLogs(nextLogs)
      .then(() => setStorageInfo(medicationRepository.getStorageEngineInfo()))
      .catch((err) =>
        console.error('Failed to save bulk logs to encrypted storage:', err)
      );

    // Dismiss active alerts for these instances
    const instanceKeys = new Set(instances.map((i) => i.key));
    setActiveAlerts((prev) => prev.filter((a) => !instanceKeys.has(a.doseKey)));

    triggerFeedback(`Marked ${instances.length} scheduled doses as taken`);
  };

  // Cycle status in Weekly Matrix: pending/missed -> taken -> skipped -> pending
  const handleCycleCellStatus = (
    dateKey: string,
    medicationId: string,
    slotId: string
  ) => {
    const key = buildDoseKey(dateKey, medicationId, slotId);
    const existing = logs[key];
    const isPast = diffDaysBetweenKeys(todayKey, dateKey) < 0;

    if (!existing) {
      handleLogDose(dateKey, medicationId, slotId, 'taken');
    } else if (existing.status === 'taken') {
      handleLogDose(
        dateKey,
        medicationId,
        slotId,
        'skipped',
        'Adjusted in weekly matrix'
      );
    } else if (existing.status === 'skipped' && isPast) {
      handleLogDose(dateKey, medicationId, slotId, 'missed');
    } else {
      handleUndoDose(dateKey, medicationId, slotId);
    }
  };

  const handleRefillMedication = (medicationId: string, addedUnits: number) => {
    const med = medications.find((m) => m.id === medicationId);
    if (!med) return;

    const updatedMed: Medication = {
      ...med,
      inventory: {
        ...med.inventory,
        currentUnits: med.inventory.currentUnits + addedUnits,
        capacityUnits: Math.max(
          med.inventory.capacityUnits,
          med.inventory.currentUnits + addedUnits
        ),
        lastRefilledAt: todayKey,
      },
    };

    setMedications((prev) =>
      prev.map((m) => (m.id === medicationId ? updatedMed : m))
    );

    // Persist to local encrypted vault (COR-71)
    medicationRepository
      .saveMedication(updatedMed)
      .then(() => setStorageInfo(medicationRepository.getStorageEngineInfo()))
      .catch((err) =>
        console.error('Failed to save refill in local encrypted storage:', err)
      );

    if (cloudUser) {
      saveMedicationToFirestore(cloudUser.uid, updatedMed).catch((err) =>
        console.error('Failed to sync refill to cloud:', err)
      );
    }

    triggerFeedback(
      `Added +${addedUnits} units to ${med.name} cabinet inventory`
    );
  };

  const handleSaveMedication = (savedMed: Medication) => {
    setMedications((prev) => {
      const exists = prev.some((m) => m.id === savedMed.id);
      if (exists) {
        return prev.map((m) => (m.id === savedMed.id ? savedMed : m));
      }
      return [...prev, savedMed];
    });

    // Persist to local encrypted vault (COR-71)
    medicationRepository
      .saveMedication(savedMed)
      .then(() => setStorageInfo(medicationRepository.getStorageEngineInfo()))
      .catch((err) =>
        console.error('Failed to save medication to local encrypted storage:', err)
      );

    if (cloudUser) {
      saveMedicationToFirestore(cloudUser.uid, savedMed).catch((err) =>
        console.error('Failed to save medication to cloud:', err)
      );
    }

    triggerFeedback(`Saved ${savedMed.name} (${savedMed.strength}) to regimen`);
  };

  const handleToggleActiveMedication = (medicationId: string) => {
    const target = medications.find((m) => m.id === medicationId);
    if (!target) return;

    const updatedMed: Medication = {...target, active: !target.active};
    setMedications((prev) =>
      prev.map((m) => (m.id === medicationId ? updatedMed : m))
    );

    // Persist to local encrypted vault (COR-71)
    medicationRepository
      .toggleActiveMedication(medicationId)
      .then(() => setStorageInfo(medicationRepository.getStorageEngineInfo()))
      .catch((err) =>
        console.error('Failed to toggle active medication in local encrypted storage:', err)
      );

    if (cloudUser) {
      saveMedicationToFirestore(cloudUser.uid, updatedMed).catch((err) =>
        console.error('Failed to toggle active medication in cloud:', err)
      );
    }
  };

  const handleDeleteMedication = (medicationId: string) => {
    const target = medications.find((m) => m.id === medicationId);
    setMedications((prev) => prev.filter((m) => m.id !== medicationId));

    // Persist to local encrypted vault (COR-71)
    medicationRepository
      .deleteMedication(medicationId)
      .then(() => setStorageInfo(medicationRepository.getStorageEngineInfo()))
      .catch((err) =>
        console.error('Failed to delete medication from local encrypted storage:', err)
      );

    if (cloudUser) {
      deleteMedicationFromFirestore(cloudUser.uid, medicationId).catch((err) =>
        console.error('Failed to delete medication from cloud:', err)
      );
    }

    if (target) {
      triggerFeedback(`Removed ${target.name} from regimen`);
    }
  };

  const handleResetSampleData = () => {
    // Reset local encrypted repository to curated demo dataset (COR-71)
    medicationRepository
      .resetSampleData()
      .then((seeded) => {
        setMedications(seeded.medications);
        setLogs(seeded.logs);
        setStorageInfo(medicationRepository.getStorageEngineInfo());
      })
      .catch(() => {
        const seeded = createInitialSeedData(todayKey);
        setMedications(seeded.medications);
        setLogs(seeded.logs);
      });

    setSelectedDate(todayKey);
    setActiveAlerts([]);
    setSnoozedReminders([]);
    alertedSlotsSetRef.current.clear();
    triggerFeedback('Restored curated sample medication dataset');
  };

  const handleExportReportJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      reminderSettings,
      medications,
      logs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cadencerx-regimen-${todayKey}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    triggerFeedback('Exported medication schedule & adherence history (JSON)');
  };

  // Toggle reminder enabled/muted for a specific time slot (COR-76 / Requirement 6)
  const handleToggleSlotReminder = (medicationId: string, slotId: string) => {
    let updatedMedication: Medication | null = null;
    let nextVal = true;

    setMedications((prev) =>
      prev.map((m) => {
        if (m.id !== medicationId) return m;
        const updatedSlots = m.timeSlots.map((s) => {
          if (s.id !== slotId) return s;
          nextVal = s.reminderEnabled === false ? true : false;
          return { ...s, reminderEnabled: nextVal };
        });
        updatedMedication = { ...m, timeSlots: updatedSlots };
        return updatedMedication;
      })
    );

    if (updatedMedication) {
      const med = updatedMedication as Medication;
      const targetSlot = med.timeSlots.find((s) => s.id === slotId);

      // 1. Persist through encrypted repository (survives reload)
      medicationRepository
        .saveMedication(med)
        .then(() => setStorageInfo(medicationRepository.getStorageEngineInfo()))
        .catch((err) =>
          console.error('Failed to persist slot reminder toggle in storage:', err)
        );

      // 2. Sync to Firestore if authenticated
      if (cloudUser) {
        saveMedicationToFirestore(cloudUser.uid, med).catch((err) =>
          console.error('Failed to sync slot reminder toggle to cloud:', err)
        );
      }

      // 3. User feedback
      triggerFeedback(
        nextVal
          ? `Enabled reminder alert for ${med.name} (${targetSlot?.time || ''})`
          : `Muted reminder alert for ${med.name} (${targetSlot?.time || ''})`
      );
    }
  };

  // Reminder alert actions
  const handleTakeActiveAlert = (alert: ActiveAlertItem) => {
    handleNotificationAction(
      ACTION_TAKE_DOSE,
      {
        doseKey: alert.doseKey,
        medicationId: alert.medicationId,
        slotId: alert.slotId,
        dateKey: alert.dateKey,
      },
      {
        onTakeDose: (payload) => {
          handleLogDose(payload.dateKey, payload.medicationId, payload.slotId, 'taken');
        },
      }
    );
  };

  const handleSnoozeActiveAlert = (
    alert: ActiveAlertItem,
    minutes: number
  ) => {
    setActiveAlerts((prev) => prev.filter((a) => a.id !== alert.id));
    const snoozedItem: SnoozedReminder = {
      id: `snooze-${Date.now()}`,
      doseKey: alert.doseKey,
      dateKey: alert.dateKey,
      medicationId: alert.medicationId,
      slotId: alert.slotId,
      medicationName: alert.medicationName,
      strength: alert.strength,
      instructions: alert.instructions,
      time: alert.time,
      fireAtTimestamp: Date.now() + minutes * 60 * 1000,
    };
    setSnoozedReminders((prev) => [snoozedItem, ...prev]);

    // Schedule in background notification engine (COR-76)
    const targetMed = medications.find((m) => m.id === alert.medicationId);
    const targetSlot = targetMed?.timeSlots.find((s) => s.id === alert.slotId);
    if (targetMed && targetSlot) {
      scheduleSnoozeNotification(targetMed, targetSlot, alert.dateKey, minutes);
    }

    triggerFeedback(
      `Snoozed ${alert.medicationName} reminder for ${minutes} minutes`
    );
  };

  const handleLogDoseRef = useRef(handleLogDose);
  useEffect(() => {
    handleLogDoseRef.current = handleLogDose;
  });

  // Register notification interactive response listener (COR-76 / Requirement 3)
  useEffect(() => {
    const sub = addNotificationResponseReceivedListener((response) => {
      const action = response.actionIdentifier;
      const data = response.notification.request.content.data;

      handleNotificationAction(action, data, {
        onTakeDose: (payload) => {
          handleLogDoseRef.current(
            payload.dateKey,
            payload.medicationId,
            payload.slotId,
            'taken'
          );
        },
        onSnooze: (payload, minutes) => {
          const targetMed = latestMedsRef.current.find(
            (m) => m.id === payload.medicationId
          );
          const targetSlot = targetMed?.timeSlots.find(
            (s) => s.id === payload.slotId
          );
          if (targetMed && targetSlot) {
            scheduleSnoozeNotification(targetMed, targetSlot, payload.dateKey, minutes);
            triggerFeedback(`Snoozed ${targetMed.name} for ${minutes} minutes`);
          }
        },
      });
    });

    return () => sub.remove();
  }, [triggerFeedback]);

  const handleSkipActiveAlert = (alert: ActiveAlertItem) => {
    handleLogDose(
      alert.dateKey,
      alert.medicationId,
      alert.slotId,
      'skipped',
      'Skipped from reminder alert'
    );
  };

  const handleDismissAlert = (alertId: string) => {
    setActiveAlerts((prev) => prev.filter((a) => a.id !== alertId));
  };

  const handleTriggerTestAlert = () => {
    if (reminderSettings.soundChimeEnabled) {
      playReminderChime();
    }
    if (reminderSettings.browserAlertsEnabled) {
      dispatchNativeNotification('CadenceRx Test Reminder Alert', {
        body: 'Audio chime and browser notifications are operating smoothly! Scheduled reminders will alert you when doses are due.',
      });
    }

    const testAlert: ActiveAlertItem = {
      id: `test-alert-${Date.now()}`,
      doseKey: 'test-dose-key',
      dateKey: todayKey,
      medicationId: medications[0]?.id || 'test-med',
      slotId: 'test-slot',
      medicationName: medications[0]?.name || 'Lisinopril',
      strength: medications[0]?.strength || '10 mg',
      instructions:
        medications[0]?.instructions ||
        'Take with water · Demonstration alert test',
      time: getCurrentTimestamp(),
      doseUnits: 1,
      form: 'Tablet',
      triggeredAt: getCurrentTimestamp(),
    };

    setActiveAlerts((prev) => [testAlert, ...prev]);
    triggerFeedback('Dispatched test medication alert and audio chime');
  };

  // --- Google Calendar Integration Handlers ---
  const handleGoogleSignIn = async () => {
    setIsAuthenticating(true);
    setCalendarError(null);
    try {
      const res = await googleSignIn();
      if (res) {
        setIsGoogleAuthenticated(true);
        setGoogleUserEmail(
          res.user.email || res.user.displayName || 'Google Calendar'
        );
        const events = await listCalendarRefillEvents(res.accessToken);
        setCalendarEvents(events);
        triggerFeedback(
          `Connected Google Calendar (${res.user.email || 'Authenticated'})`
        );
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to sign in with Google Calendar.';
      setCalendarError(msg);
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleGoogleSignOut = async () => {
    await logoutGoogle();
    setIsGoogleAuthenticated(false);
    setGoogleUserEmail(null);
    setCalendarEvents([]);
    triggerFeedback('Disconnected Google Calendar session');
  };

  const handleRefreshCalendarEvents = async () => {
    setIsSyncingCalendar(true);
    setCalendarError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setIsGoogleAuthenticated(false);
        return;
      }
      const events = await listCalendarRefillEvents(token);
      setCalendarEvents(events);
      triggerFeedback('Refreshed upcoming fill events from Google Calendar');
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Could not refresh Google Calendar events.';
      setCalendarError(msg);
    } finally {
      setIsSyncingCalendar(false);
    }
  };

  const handleUpdateMedicationFillInfo = (
    medicationId: string,
    nextFillDate: string,
    pharmacyNote?: string
  ) => {
    setMedications((prev) =>
      prev.map((m) =>
        m.id === medicationId
          ? {
              ...m,
              inventory: {
                ...m.inventory,
                nextFillDate: nextFillDate || undefined,
                pharmacyNote:
                  pharmacyNote !== undefined
                    ? pharmacyNote
                    : m.inventory.pharmacyNote,
              },
            }
          : m
      )
    );
  };

  const handleSyncMedicationToCalendar = async (med: Medication) => {
    if (!med.inventory.nextFillDate) return;
    setIsSyncingCalendar(true);
    setCalendarError(null);
    try {
      let token = await getAccessToken();
      if (!token) {
        const signInRes = await googleSignIn();
        if (!signInRes) return;
        token = signInRes.accessToken;
        setIsGoogleAuthenticated(true);
        setGoogleUserEmail(
          signInRes.user.email ||
            signInRes.user.displayName ||
            'Google Calendar'
        );
      }

      const payload = {
        medicationId: med.id,
        medicationName: med.name,
        strength: med.strength,
        fillDate: med.inventory.nextFillDate,
        quantityToFill: med.inventory.capacityUnits,
        form: med.form,
        pharmacyNote: med.inventory.pharmacyNote,
        prescriber: med.prescriber,
      };

      const savedEvent = med.inventory.googleCalendarEventId
        ? await updateCalendarFillEvent(
            token,
            med.inventory.googleCalendarEventId,
            payload
          )
        : await createCalendarFillEvent(token, payload);

      setMedications((prev) =>
        prev.map((m) =>
          m.id === med.id
            ? {
                ...m,
                inventory: {
                  ...m.inventory,
                  googleCalendarEventId: savedEvent.id,
                },
              }
            : m
        )
      );

      const events = await listCalendarRefillEvents(token);
      setCalendarEvents(events);
      triggerFeedback(
        `Synced ${med.name} fill date (${med.inventory.nextFillDate}) to Google Calendar`
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to sync fill date to Google Calendar.';
      setCalendarError(msg);
    } finally {
      setIsSyncingCalendar(false);
    }
  };

  const handleSyncAllToCalendar = async (medsToSync: Medication[]) => {
    const validMeds = medsToSync.filter((m) => m.inventory.nextFillDate);
    if (validMeds.length === 0) {
      triggerFeedback('No medications with scheduled fill dates found to sync.');
      return;
    }

    setCalendarError(null);

    let token = await getAccessToken();
    if (!token) {
      try {
        const signInRes = await googleSignIn();
        if (!signInRes) return;
        token = signInRes.accessToken;
        setIsGoogleAuthenticated(true);
        setGoogleUserEmail(
          signInRes.user.email ||
            signInRes.user.displayName ||
            'Google Calendar'
        );
      } catch (err: unknown) {
        setCalendarError(
          err instanceof Error ? err.message : 'Google authentication failed'
        );
        return;
      }
    }

    const initialItems: BulkSyncItemProgress[] = validMeds.map((med) => ({
      medicationId: med.id,
      medicationName: med.name,
      strength: med.strength,
      fillDate: med.inventory.nextFillDate!,
      status: 'pending',
      isExistingEvent: Boolean(med.inventory.googleCalendarEventId),
    }));

    setBulkSyncItems(initialItems);
    setBulkSyncCurrentIndex(0);
    setIsBulkSyncModalOpen(true);
    setIsBulkSyncProcessing(true);
    setIsSyncingCalendar(true);

    let createdCount = 0;
    let updatedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < validMeds.length; i++) {
      const med = validMeds[i];
      setBulkSyncCurrentIndex(i);

      // Set current item to in_progress
      setBulkSyncItems((prev) =>
        prev.map((item, idx) =>
          idx === i ? {...item, status: 'in_progress'} : item
        )
      );

      // Small delay for clean progress visualization
      await new Promise((resolve) => setTimeout(resolve, 280));

      try {
        const payload = {
          medicationId: med.id,
          medicationName: med.name,
          strength: med.strength,
          fillDate: med.inventory.nextFillDate!,
          quantityToFill: med.inventory.capacityUnits,
          form: med.form,
          pharmacyNote: med.inventory.pharmacyNote,
          prescriber: med.prescriber,
        };

        const isUpdate = Boolean(med.inventory.googleCalendarEventId);
        const evt = isUpdate
          ? await updateCalendarFillEvent(
              token,
              med.inventory.googleCalendarEventId!,
              payload
            )
          : await createCalendarFillEvent(token, payload);

        if (isUpdate) updatedCount++;
        else createdCount++;

        setBulkSyncItems((prev) =>
          prev.map((item, idx) =>
            idx === i
              ? {
                  ...item,
                  status: 'success',
                  actionTaken: isUpdate ? 'updated' : 'created',
                }
              : item
          )
        );

        // Progressively update medication in local state with event ID
        setMedications((prev) =>
          prev.map((m) =>
            m.id === med.id
              ? {
                  ...m,
                  inventory: {
                    ...m.inventory,
                    googleCalendarEventId: evt.id,
                  },
                }
              : m
          )
        );
      } catch (err: unknown) {
        errorCount++;
        const errMsg =
          err instanceof Error ? err.message : 'Failed to sync event';
        setBulkSyncItems((prev) =>
          prev.map((item, idx) =>
            idx === i ? {...item, status: 'error', errorMessage: errMsg} : item
          )
        );
      }
    }

    try {
      const events = await listCalendarRefillEvents(token);
      setCalendarEvents(events);
    } catch {
      // Ignore background refresh failure
    }

    setIsBulkSyncProcessing(false);
    setIsSyncingCalendar(false);

    if (errorCount === 0) {
      triggerFeedback(
        `Bulk sync completed: ${createdCount} created, ${updatedCount} updated on Google Calendar`
      );
    } else {
      triggerFeedback(
        `Bulk sync finished: ${createdCount + updatedCount} synced, ${errorCount} failed.`
      );
    }
  };

  const handleRetryBulkSyncFailed = async () => {
    let token = await getAccessToken();
    if (!token) {
      const signInRes = await googleSignIn();
      if (!signInRes) return;
      token = signInRes.accessToken;
    }

    const failedIndexes = bulkSyncItems
      .map((item, index) => (item.status === 'error' ? index : -1))
      .filter((index) => index !== -1);

    if (failedIndexes.length === 0) return;

    setIsBulkSyncProcessing(true);
    setIsSyncingCalendar(true);

    for (const idx of failedIndexes) {
      setBulkSyncCurrentIndex(idx);
      const targetItem = bulkSyncItems[idx];
      const med = medications.find((m) => m.id === targetItem.medicationId);
      if (!med || !med.inventory.nextFillDate) continue;

      setBulkSyncItems((prev) =>
        prev.map((item, i) =>
          i === idx
            ? {...item, status: 'in_progress', errorMessage: undefined}
            : item
        )
      );

      await new Promise((resolve) => setTimeout(resolve, 280));

      try {
        const payload = {
          medicationId: med.id,
          medicationName: med.name,
          strength: med.strength,
          fillDate: med.inventory.nextFillDate,
          quantityToFill: med.inventory.capacityUnits,
          form: med.form,
          pharmacyNote: med.inventory.pharmacyNote,
          prescriber: med.prescriber,
        };

        const isUpdate = Boolean(med.inventory.googleCalendarEventId);
        const evt = isUpdate
          ? await updateCalendarFillEvent(
              token,
              med.inventory.googleCalendarEventId!,
              payload
            )
          : await createCalendarFillEvent(token, payload);

        setBulkSyncItems((prev) =>
          prev.map((item, i) =>
            i === idx
              ? {
                  ...item,
                  status: 'success',
                  actionTaken: isUpdate ? 'updated' : 'created',
                }
              : item
          )
        );

        setMedications((prev) =>
          prev.map((m) =>
            m.id === med.id
              ? {
                  ...m,
                  inventory: {
                    ...m.inventory,
                    googleCalendarEventId: evt.id,
                  },
                }
              : m
          )
        );
      } catch (err: unknown) {
        const errMsg =
          err instanceof Error ? err.message : 'Retry attempt failed';
        setBulkSyncItems((prev) =>
          prev.map((item, i) =>
            i === idx
              ? {...item, status: 'error', errorMessage: errMsg}
              : item
          )
        );
      }
    }

    try {
      const events = await listCalendarRefillEvents(token);
      setCalendarEvents(events);
    } catch {}

    setIsBulkSyncProcessing(false);
    setIsSyncingCalendar(false);
  };

  const handleDeleteCalendarEvent = async (med: Medication) => {
    const eventId = med.inventory.googleCalendarEventId;
    if (!eventId) return;

    setIsSyncingCalendar(true);
    setCalendarError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setIsGoogleAuthenticated(false);
        return;
      }

      await deleteCalendarFillEvent(token, eventId);

      setMedications((prev) =>
        prev.map((m) =>
          m.id === med.id
            ? {
                ...m,
                inventory: {
                  ...m.inventory,
                  googleCalendarEventId: undefined,
                },
              }
            : m
        )
      );

      const events = await listCalendarRefillEvents(token);
      setCalendarEvents(events);
      triggerFeedback(
        `Removed ${med.name} fill date event from Google Calendar`
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to delete event from Google Calendar.';
      setCalendarError(msg);
    } finally {
      setIsSyncingCalendar(false);
    }
  };

  // --- Firebase Cloud Data Persistence Handlers ---
  const handleCloudSignIn = async () => {
    setIsCloudSyncing(true);
    setCloudSyncError(null);
    try {
      const res = await googleSignIn();
      if (res?.user) {
        setCloudUser(res.user);
        setIsGoogleAuthenticated(true);
        setGoogleUserEmail(res.user.email || res.user.displayName || 'Connected');
        triggerFeedback(`Connected to Google Cloud: ${res.user.email || 'Ready'}`);
      }
    } catch (err: unknown) {
      setCloudSyncError(
        err instanceof Error ? err.message : 'Google sign-in failed'
      );
    } finally {
      setIsCloudSyncing(false);
    }
  };

  const handleCloudSignOut = async () => {
    try {
      await logoutGoogle();
      setCloudUser(null);
      setIsGoogleAuthenticated(false);
      setGoogleUserEmail(null);
      triggerFeedback('Signed out of Google Cloud. Local offline storage active.');
    } catch (err: unknown) {
      console.error('Sign-out error:', err);
    }
  };

  const handleManualCloudSync = async () => {
    if (!cloudUser) return;
    setIsCloudSyncing(true);
    setCloudSyncError(null);
    try {
      const res = await migrateLocalDataToFirestore(
        cloudUser.uid,
        medications,
        logs,
        cloudUser.email,
        cloudUser.displayName
      );
      triggerFeedback(
        `Cloud sync complete: ${res.migratedMeds} medications and ${res.migratedLogs} logs synchronized.`
      );
    } catch (err: unknown) {
      setCloudSyncError(
        err instanceof Error ? err.message : 'Cloud sync failed'
      );
    } finally {
      setIsCloudSyncing(false);
    }
  };

  // Compute global KPI strip numbers
  const todayDoses = getScheduledDosesForDate(
    medications,
    logs,
    todayKey,
    todayKey
  );
  const todayTaken = todayDoses.filter(
    (d) => d.effectiveStatus === 'taken'
  ).length;
  const analytics = computeAdherenceAnalytics(medications, logs, todayKey);
  const lowSupplyCount = medications.filter(
    (m) => m.active && m.inventory.currentUnits <= m.inventory.lowThresholdUnits
  ).length;

  const activeRemindersTodayCount = todayDoses.filter(
    (d) => d.slot.reminderEnabled !== false
  ).length;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-8">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('daily');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          style={{fontFamily: 'var(--font-display), sans-serif'}}
        >
          CadenceRx
        </a>

        {/* Zone 2: 4 concise single-line text navigation links */}
        <nav className="flex items-center gap-6 text-sm font-medium text-slate-600 overflow-x-auto">
          {(
            [
              {id: 'daily', label: 'Daily Log'},
              {id: 'weekly', label: 'Weekly Matrix'},
              {id: 'monthly', label: 'Monthly Analytics'},
              {id: 'cabinet', label: 'Cabinet & Refills'},
            ] as const
          ).map((navItem) => {
            const isActive = activeView === navItem.id;
            return (
              <button
                key={navItem.id}
                type="button"
                onClick={() => setActiveView(navItem.id)}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                  isActive
                    ? 'text-slate-900 font-semibold border-teal-600'
                    : 'text-slate-600 hover:text-slate-900 border-transparent hover:border-slate-300'
                }`}
              >
                {navItem.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Primary action + Reminders Hub Action + Cloud Sync + Local Encrypted Vault */}
        <div className="flex items-center gap-2.5 shrink-0">
          <StorageEncryptionBadge
            storageInfo={storageInfo}
            benchmarkResult={benchmarkResult}
            onRunBenchmark={handleRunStorageBenchmark}
          />

          <CloudSyncStatus
            user={cloudUser}
            isSyncing={isCloudSyncing}
            syncError={cloudSyncError}
            isMigrating={isCloudMigrating}
            medicationCount={medications.length}
            logCount={Object.keys(logs).length}
            onSignIn={handleCloudSignIn}
            onSignOut={handleCloudSignOut}
            onManualSync={handleManualCloudSync}
          />

          <button
            type="button"
            onClick={() => setIsRemindersHubOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            title="Configure Medication Reminders & Alerts"
          >
            {reminderSettings.globalMute ? (
              <BellOff className="w-3.5 h-3.5 text-slate-400" />
            ) : (
              <Bell className="w-3.5 h-3.5 text-teal-600" />
            )}
            <span>Reminders</span>
            {activeRemindersTodayCount > 0 && !reminderSettings.globalMute && (
              <span className="font-mono tabular-nums text-[11px] text-teal-700 font-semibold bg-teal-50 px-1.5 py-0.2 rounded">
                {activeRemindersTodayCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setEditingMedication(null);
              setIsModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Medication
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Executive Overview & Multi-Horizon Horizon Header */}
        <section className="bg-white border border-slate-200 rounded-lg p-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-1.5 max-w-2xl">
              <h1
                className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900"
                style={{
                  fontFamily: 'var(--font-display), sans-serif',
                  textWrap: 'balance',
                }}
              >
                Personal Medication & Adherence Command Center
              </h1>
              <p className="text-sm text-slate-600">
                Track daily time-blocked doses with scheduled reminders, inspect
                7-day weekly regimen consistency, analyze 30-day adherence
                heatmaps, and sync prescription fill dates with Google Calendar.
              </p>
            </div>

            {/* Compact Tabular Telemetry Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 lg:gap-6 pt-4 lg:pt-0 border-t lg:border-t-0 border-slate-200 shrink-0">
              <div>
                <div className="text-xs text-slate-500">Today&apos;s Regimen</div>
                <div className="mt-0.5 text-lg font-bold font-mono tabular-nums text-slate-900">
                  {todayTaken}/{todayDoses.length} taken
                </div>
              </div>

              <div>
                <div className="text-xs text-slate-500">30-Day Adherence</div>
                <div className="mt-0.5 text-lg font-bold font-mono tabular-nums text-teal-700">
                  {analytics.thirtyDayAdherencePct}%
                </div>
              </div>

              <div>
                <div className="text-xs text-slate-500">Fill Dates & Cal</div>
                <button
                  type="button"
                  onClick={() => setActiveView('cabinet')}
                  className="mt-0.5 text-lg font-bold font-mono tabular-nums inline-flex items-center gap-1 cursor-pointer hover:underline text-slate-900"
                >
                  <Calendar className="w-4 h-4 text-teal-600 shrink-0" />
                  <span>
                    {
                      medications.filter(
                        (m) => m.active && m.inventory.nextFillDate
                      ).length
                    }{' '}
                    set
                  </span>
                </button>
              </div>

              <div>
                <div className="text-xs text-slate-500">Scheduled Alerts</div>
                <button
                  type="button"
                  onClick={() => setIsRemindersHubOpen(true)}
                  className="mt-0.5 text-lg font-bold font-mono tabular-nums inline-flex items-center gap-1 cursor-pointer hover:underline text-teal-700"
                >
                  <Bell className="w-4 h-4 text-teal-600 shrink-0" />
                  <span>
                    {reminderSettings.globalMute
                      ? 'Muted'
                      : `${activeRemindersTodayCount} active`}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Inline Action Confirmation Banner */}
          {feedbackBanner && (
            <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between text-xs font-medium text-teal-800">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                {feedbackBanner}
              </span>
              <button
                type="button"
                onClick={() => setFeedbackBanner(null)}
                className="text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}
        </section>

        {/* Active Horizon Workspace View */}
        {activeView === 'daily' && (
          <DailyLogView
            selectedDate={selectedDate}
            todayKey={todayKey}
            onSelectDate={setSelectedDate}
            medications={medications}
            logs={logs}
            onLogDose={handleLogDose}
            onUndoDose={handleUndoDose}
            onLogAllBlock={handleLogAllBlock}
            onRefillMedication={handleRefillMedication}
            onOpenAddModal={() => {
              setEditingMedication(null);
              setIsModalOpen(true);
            }}
            onNavigateToCabinet={() => setActiveView('cabinet')}
            onOpenRemindersHub={() => setIsRemindersHubOpen(true)}
            onToggleSlotReminder={handleToggleSlotReminder}
            remindersActiveCount={activeRemindersTodayCount}
          />
        )}

        {activeView === 'weekly' && (
          <WeeklyMatrixView
            selectedDate={selectedDate}
            todayKey={todayKey}
            onSelectDate={setSelectedDate}
            medications={medications}
            logs={logs}
            onCycleCellStatus={handleCycleCellStatus}
            onOpenAddModal={() => {
              setEditingMedication(null);
              setIsModalOpen(true);
            }}
          />
        )}

        {activeView === 'monthly' && (
          <MonthlyAnalyticsView
            selectedDate={selectedDate}
            todayKey={todayKey}
            onSelectDate={setSelectedDate}
            medications={medications}
            logs={logs}
            onLogDose={handleLogDose}
            onUndoDose={handleUndoDose}
          />
        )}

        {activeView === 'cabinet' && (
          <CabinetInventoryView
            medications={medications}
            todayKey={todayKey}
            googleUserEmail={googleUserEmail}
            isGoogleAuthenticated={isGoogleAuthenticated}
            isAuthenticating={isAuthenticating}
            isSyncingCalendar={isSyncingCalendar}
            calendarEvents={calendarEvents}
            calendarError={calendarError}
            onGoogleSignIn={handleGoogleSignIn}
            onGoogleSignOut={handleGoogleSignOut}
            onRefreshCalendarEvents={handleRefreshCalendarEvents}
            onUpdateMedicationFillInfo={handleUpdateMedicationFillInfo}
            onRequestSyncMedicationToCalendar={handleSyncMedicationToCalendar}
            onRequestSyncAllToCalendar={handleSyncAllToCalendar}
            onRequestDeleteCalendarEvent={handleDeleteCalendarEvent}
            onRefillMedication={handleRefillMedication}
            onEditMedication={(med) => {
              setEditingMedication(med);
              setIsModalOpen(true);
            }}
            onToggleActiveMedication={handleToggleActiveMedication}
            onDeleteMedication={handleDeleteMedication}
            onOpenAddModal={() => {
              setEditingMedication(null);
              setIsModalOpen(true);
            }}
            onResetSampleData={handleResetSampleData}
          />
        )}
      </main>

      {/* Clean Utilitarian Footer */}
      <footer className="bg-white border-t border-slate-200 px-6 py-4 mt-12">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div>
            CadenceRx Personal Medication & Regimen Workspace · Local Browser
            Storage Active
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handleExportReportJson}
              className="inline-flex items-center gap-1.5 text-slate-600 hover:text-slate-900 font-medium cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Export Regimen & Logs (JSON)
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={handleResetSampleData}
              className="text-slate-600 hover:text-slate-900 font-medium cursor-pointer"
            >
              Restore Sample Dataset
            </button>
          </div>
        </div>
      </footer>

      {/* Add / Edit Medication Modal */}
      <MedicationModal
        isOpen={isModalOpen}
        initialMedication={editingMedication}
        todayKey={todayKey}
        onClose={() => {
          setIsModalOpen(false);
          setEditingMedication(null);
        }}
        onSave={handleSaveMedication}
      />

      {/* Reminders & Alerts Management Hub Modal */}
      <RemindersHubModal
        isOpen={isRemindersHubOpen}
        onClose={() => setIsRemindersHubOpen(false)}
        settings={reminderSettings}
        onUpdateSettings={setReminderSettings}
        snoozedReminders={snoozedReminders}
        onCancelSnooze={(id) =>
          setSnoozedReminders((prev) => prev.filter((s) => s.id !== id))
        }
        onTakeSnoozed={(snooze) => {
          handleLogDose(
            snooze.dateKey,
            snooze.medicationId,
            snooze.slotId,
            'taken'
          );
        }}
        medications={medications}
        logs={logs}
        todayKey={todayKey}
        onToggleSlotReminder={handleToggleSlotReminder}
        onTriggerTestAlert={handleTriggerTestAlert}
      />

      {/* Immediate Active In-App Reminder Alert Banner / Card */}
      <ActiveReminderBanner
        alerts={activeAlerts}
        snoozeMinutes={reminderSettings.snoozeDurationMinutes}
        onLogTaken={handleTakeActiveAlert}
        onSnooze={handleSnoozeActiveAlert}
        onSkip={handleSkipActiveAlert}
        onDismiss={handleDismissAlert}
        onDismissAll={() => setActiveAlerts([])}
      />

      {/* Bulk Sync Progress & Results Modal */}
      <BulkSyncProgressModal
        isOpen={isBulkSyncModalOpen}
        isProcessing={isBulkSyncProcessing}
        items={bulkSyncItems}
        currentIndex={bulkSyncCurrentIndex}
        onClose={() => setIsBulkSyncModalOpen(false)}
        onRetryFailed={handleRetryBulkSyncFailed}
      />

      {/* Clinical Explanation Notification Permission Dialog (COR-76) */}
      <NotificationPermissionModal
        isOpen={isNotificationPermissionModalOpen}
        onClose={() => setIsNotificationPermissionModalOpen(false)}
        onPermissionResolved={(status) => {
          if (status === 'granted') {
            setReminderSettings((prev) => ({
              ...prev,
              browserAlertsEnabled: true,
            }));
            triggerFeedback('Clinical dose reminders enabled');
          }
        }}
      />
    </div>
  );
}
