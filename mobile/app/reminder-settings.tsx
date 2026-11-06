import { Stack } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";

import { LeadTimeChips } from "@/components/reminder-settings/LeadTimeChips";
import { MedicationAlertRow, SHOWS_VIBRATION_SWITCH } from "@/components/reminder-settings/MedicationAlertRow";
import { ReminderStatusBanner } from "@/components/reminder-settings/ReminderStatusBanner";
import { cadenceTokens } from "@/constants/theme";
import { useReminderStatus } from "@/hooks/useReminderStatus";
import type { Medication } from "@/lib/domain/medication-data";
import {
  ensureReminderPermission,
  openExactAlarmSettings,
  openNotificationSettings,
  refreshReminders,
} from "@/lib/notifications";
import {
  DEFAULT_REMINDER_SETTINGS,
  PREF_DEFAULT_LEAD_MINUTES,
  PREF_SHOW_MEDICATION_NAMES,
  readReminderSettings,
  withAlert,
  withLeadMinutes,
} from "@/lib/notifications/settings";
import type { ReminderSettings } from "@/lib/notifications/types";
import { getStorageContext } from "@/lib/storage";

/**
 * COR-76 reminder settings. Every change is saved through the repository;
 * the reminder engine reschedules from the resulting change event.
 */
export default function ReminderSettingsScreen() {
  const status = useReminderStatus();
  const [medications, setMedications] = useState<Medication[] | null>(null);
  const [settings, setSettings] = useState<ReminderSettings>(DEFAULT_REMINDER_SETTINGS);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { repository } = await getStorageContext();
      const [meds, prefs] = await Promise.all([repository.getAllMedications(), readReminderSettings(repository)]);
      if (!alive) return;
      setMedications(meds.filter((m) => m.active));
      setSettings(prefs);
    })().catch(() => alive && setMedications([]));
    void ensureReminderPermission();
    return () => {
      alive = false;
    };
  }, []);

  const saveMedication = useCallback(async (next: Medication) => {
    setMedications((list) => list?.map((m) => (m.id === next.id ? next : m)) ?? list);
    setSaveError(null);
    try {
      const { repository } = await getStorageContext();
      // Baseline = the stock we edited from, so concurrent dose logs keep their inventory change.
      await repository.saveMedication(next, { inventoryBaseline: next.inventory.currentUnits });
    } catch {
      setSaveError("Could not save. Please try again.");
    }
  }, []);

  const savePreference = useCallback(async (patch: Partial<ReminderSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    setSaveError(null);
    try {
      const { repository } = await getStorageContext();
      if (patch.defaultLeadMinutes !== undefined) await repository.setPreference(PREF_DEFAULT_LEAD_MINUTES, patch.defaultLeadMinutes);
      if (patch.showMedicationNames !== undefined) await repository.setPreference(PREF_SHOW_MEDICATION_NAMES, patch.showMedicationNames);
    } catch {
      setSaveError("Could not save. Please try again.");
    }
  }, []);

  return (
    <>
      <Stack.Screen options={{ title: "Reminders" }} />
      <ScrollView className="flex-1 bg-cadence-background" contentContainerClassName="pb-10">
        <ReminderStatusBanner
          status={status}
          onOpenNotificationSettings={() => void openNotificationSettings()}
          onOpenExactAlarmSettings={() => void openExactAlarmSettings()}
          onRetry={() => void refreshReminders()}
        />
        {saveError ? (
          <Text accessibilityRole="alert" className="mx-5 mt-3 text-sm text-red-700">
            {saveError}
          </Text>
        ) : null}

        <Text className="mx-5 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">All reminders</Text>
        <View className="mx-5 mt-2 rounded-xl bg-white px-4 py-3">
          <Text className="text-sm text-slate-700">Default reminder time</Text>
          <LeadTimeChips
            value={settings.defaultLeadMinutes}
            onChange={(minutes) => void savePreference({ defaultLeadMinutes: minutes ?? 0 })}
            testID="reminder-default-lead"
          />
          <View className="mt-4 flex-row items-center justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-sm text-slate-700">Show medication names in notifications</Text>
              <Text className="mt-0.5 text-xs text-slate-500">Off keeps names off your lock screen.</Text>
            </View>
            <Switch
              accessibilityLabel="Show medication names in notifications"
              value={settings.showMedicationNames}
              onValueChange={(showMedicationNames) => void savePreference({ showMedicationNames })}
              trackColor={{ true: cadenceTokens.accent }}
            />
          </View>
          {Platform.OS === "android" ? (
            <Pressable accessibilityRole="button" onPress={() => void openExactAlarmSettings()} className="mt-4">
              <Text className="text-sm font-semibold text-cadence-accent">Alarms &amp; reminders access</Text>
              <Text className="mt-0.5 text-xs text-slate-500">Needed on Android 12+ for reminders to ring on time.</Text>
            </Pressable>
          ) : null}
        </View>

        <Text className="mx-5 mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">Per medication</Text>
        {!SHOWS_VIBRATION_SWITCH ? (
          <Text className="mx-5 mt-1 text-xs text-slate-500">
            On iPhone, vibration follows Settings › Sounds &amp; Haptics.
          </Text>
        ) : null}
        {medications === null ? (
          <ActivityIndicator className="mt-6" color={cadenceTokens.accent} />
        ) : medications.length === 0 ? (
          <Text className="mx-5 mt-3 text-sm text-slate-500">No active medications.</Text>
        ) : (
          medications.map((medication) => (
            <MedicationAlertRow
              key={medication.id}
              medication={medication}
              defaultLeadMinutes={settings.defaultLeadMinutes}
              onChangeAlert={(patch) => void saveMedication(withAlert(medication, patch))}
              onChangeLead={(minutes) => void saveMedication(withLeadMinutes(medication, minutes))}
            />
          ))
        )}
      </ScrollView>
    </>
  );
}
