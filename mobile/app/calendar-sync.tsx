import { Stack } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";

import { BulkSyncModal } from "@/components/calendar-sync/BulkSyncModal";
import { cadenceTokens } from "@/constants/theme";
import {
  connectCalendar,
  disconnect,
  PREF_CALENDAR_SHOW_MEDICATION_NAMES,
  PREF_CALENDAR_SYNC_ENABLED,
  readCalendarSyncSettings,
  syncNow,
  useCalendarSyncStatus,
  type CalendarSyncStatus,
} from "@/lib/calendar";
import type { Medication } from "@/lib/domain/medication-data";
import { getStorageContext } from "@/lib/storage";

const STATE_MESSAGE: Record<CalendarSyncStatus["state"], string> = {
  disabled: "Calendar sync is off.",
  "not-configured": "Calendar sync is not set up in this build.",
  "signed-out": "Connect Google Calendar to keep refill events in sync.",
  "reauth-required": "Google access expired. Reconnect to keep syncing.",
  offline: "Offline. Sync resumes when you are back online.",
  error: "Sync hit an error. It retries on the next change.",
  ok: "Refill events are up to date.",
};

const CONNECTABLE = new Set<CalendarSyncStatus["state"]>(["disabled", "signed-out", "reauth-required"]);

/**
 * Calendar sync settings: connect Google, toggle medication names on events,
 * sync now or in bulk, and disconnect with or without removing events.
 */
export default function CalendarSyncScreen() {
  const status = useCalendarSyncStatus();
  const [names, setNames] = useState(false);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkVisible, setBulkVisible] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { repository } = await getStorageContext();
      const [settings, meds] = await Promise.all([readCalendarSyncSettings(repository), repository.getAllMedications()]);
      if (!alive) return;
      setNames(settings.showMedicationNames);
      setMedications(meds.filter((med) => med.active));
    })().catch(() => {
      if (alive) setMedications([]);
    });
    return () => {
      alive = false;
    };
  }, []);

  const setPreference = useCallback(async (key: string, value: boolean) => {
    setError(null);
    try {
      const { repository } = await getStorageContext();
      await repository.setPreference(key, value);
    } catch {
      setError("Could not save. Please try again.");
    }
  }, []);

  const onConnect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await connectCalendar();
      if (result === "connected") await setPreference(PREF_CALENDAR_SYNC_ENABLED, true);
    } catch {
      setError("Could not connect to Google. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [setPreference]);

  const runDisconnect = useCallback(
    async (removeEvents: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const result = await disconnect({ removeEvents });
        if (result === "remote-delete-failed") {
          setError("Could not delete the Google calendar. Try again, or keep the events.");
        }
      } catch {
        setError("Could not disconnect. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const onDisconnect = useCallback(() => {
    Alert.alert("Disconnect calendar sync", "What should happen to your refill events in Google Calendar?", [
      { text: "Cancel", style: "cancel" },
      { text: "Keep events", onPress: () => void runDisconnect(false) },
      { text: "Remove events", style: "destructive", onPress: () => void runDisconnect(true) },
    ]);
  }, [runDisconnect]);

  const onSyncNow = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await syncNow();
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <>
      <Stack.Screen options={{ title: "Calendar sync" }} />
      <ScrollView className="flex-1 bg-cadence-background" contentContainerClassName="pb-10">
        <View
          testID="calendar-sync-status"
          accessibilityLabel={`Calendar sync status: ${STATE_MESSAGE[status.state]}`}
          className={`mx-5 mt-4 rounded-xl px-4 py-3 ${status.state === "error" ? "bg-red-50" : "bg-white"}`}
        >
          <Text className="text-sm text-slate-800">{STATE_MESSAGE[status.state]}</Text>
          {status.pendingCount > 0 ? (
            <Text className="mt-1 text-xs text-slate-500">{status.pendingCount} waiting to sync.</Text>
          ) : null}
          {status.failedCount > 0 ? (
            <Text className="mt-1 text-xs text-red-700">{status.failedCount} could not be synced.</Text>
          ) : null}
        </View>

        {error ? (
          <Text accessibilityRole="alert" className="mx-5 mt-3 text-sm text-red-700">
            {error}
          </Text>
        ) : null}

        {CONNECTABLE.has(status.state) ? (
          <View className="mx-5 mt-4 rounded-xl bg-white px-4 py-3">
            {status.state === "not-configured" ? (
              <Text className="text-sm text-slate-500">
                This build has no Google sign-in configured. Add the Google client ids to enable calendar sync.
              </Text>
            ) : null}
            <Pressable
              testID="calendar-sync-connect"
              accessibilityRole="button"
              accessibilityLabel={status.state === "reauth-required" ? "Reconnect Google Calendar" : "Connect Google Calendar"}
              accessibilityState={{ disabled: busy || status.state === "not-configured" }}
              disabled={busy || status.state === "not-configured"}
              onPress={() => void onConnect()}
              className={`mt-2 rounded-xl px-4 py-2.5 ${busy || status.state === "not-configured" ? "bg-slate-200" : "bg-cadence-accent"}`}
            >
              {busy ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text className={`text-center text-sm font-semibold ${busy || status.state === "not-configured" ? "text-slate-500" : "text-white"}`}>
                  {status.state === "reauth-required" ? "Reconnect" : "Connect"}
                </Text>
              )}
            </Pressable>
          </View>
        ) : (
          <View className="mx-5 mt-4 rounded-xl bg-white px-4 py-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text className="text-sm text-slate-700">Show medication names in calendar events</Text>
                <Text className="mt-0.5 text-xs text-slate-500">
                  Google stores calendar events and shows them on every device signed in to that account.
                </Text>
              </View>
              <Switch
                testID="calendar-sync-names"
                accessibilityLabel="Show medication names in calendar events"
                value={names}
                onValueChange={(value) => {
                  setNames(value);
                  void setPreference(PREF_CALENDAR_SHOW_MEDICATION_NAMES, value);
                }}
                trackColor={{ true: cadenceTokens.accent }}
              />
            </View>

            <View className="mt-4 flex-row gap-3">
              <Pressable
                testID="calendar-sync-now"
                accessibilityRole="button"
                accessibilityLabel="Sync now"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={() => void onSyncNow()}
                className={`flex-1 rounded-xl px-4 py-2.5 ${busy ? "bg-slate-200" : "bg-cadence-accent"}`}
              >
                <Text className={`text-center text-sm font-semibold ${busy ? "text-slate-500" : "text-white"}`}>Sync now</Text>
              </Pressable>
              <Pressable
                testID="calendar-sync-all"
                accessibilityRole="button"
                accessibilityLabel="Sync all medications"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={() => setBulkVisible(true)}
                className={`flex-1 rounded-xl px-4 py-2.5 ${busy ? "bg-slate-200" : "bg-slate-100"}`}
              >
                <Text className={`text-center text-sm font-semibold ${busy ? "text-slate-500" : "text-slate-800"}`}>Sync all</Text>
              </Pressable>
            </View>

            <Pressable
              testID="calendar-sync-disconnect"
              accessibilityRole="button"
              accessibilityLabel="Disconnect calendar sync"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={onDisconnect}
              className="mt-3 rounded-xl px-4 py-2.5"
            >
              <Text className="text-center text-sm font-semibold text-red-700">Disconnect</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
      <BulkSyncModal visible={bulkVisible} medications={medications} onClose={() => setBulkVisible(false)} />
    </>
  );
}
