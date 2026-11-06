import { Platform, Switch, Text, View } from "react-native";

import { cadenceTokens } from "@/constants/theme";
import type { Medication } from "@/lib/domain/medication-data";
import { formatLeadMinutes, getMedicationAlert, summarizeLeadMinutes } from "@/lib/notifications/settings";

import { LeadTimeChips } from "./LeadTimeChips";

/** iOS has no per-notification vibration control; vibration follows the system Sounds & Haptics settings. */
export const SHOWS_VIBRATION_SWITCH = Platform.OS !== "ios";

/** COR-76: one medication's sound, vibration, and lead time. */
export function MedicationAlertRow({
  medication,
  defaultLeadMinutes,
  onChangeAlert,
  onChangeLead,
}: {
  medication: Medication;
  defaultLeadMinutes: number;
  onChangeAlert: (patch: { sound?: boolean; vibrate?: boolean }) => void;
  onChangeLead: (minutes: number | null) => void;
}) {
  const alert = getMedicationAlert(medication);
  const lead = summarizeLeadMinutes(medication);
  const remindersOff = medication.timeSlots.length > 0 && medication.timeSlots.every((s) => s.reminderEnabled === false);
  return (
    <View testID={`reminder-med-${medication.id}`} className="mx-5 mt-3 rounded-xl bg-white px-4 py-3">
      <Text className="text-base font-semibold text-slate-900">{medication.name}</Text>
      {remindersOff ? <Text className="mt-1 text-xs text-slate-500">Reminders are off for every time of this medication.</Text> : null}
      <View className="mt-2 flex-row items-center justify-between">
        <Text className="text-sm text-slate-700">Sound</Text>
        <Switch
          accessibilityLabel={`Sound for ${medication.name}`}
          value={alert.sound}
          onValueChange={(sound) => onChangeAlert({ sound })}
          trackColor={{ true: cadenceTokens.accent }}
        />
      </View>
      {SHOWS_VIBRATION_SWITCH ? (
        <View className="mt-2 flex-row items-center justify-between">
          <Text className="text-sm text-slate-700">Vibration</Text>
          <Switch
            accessibilityLabel={`Vibration for ${medication.name}`}
            value={alert.vibrate}
            onValueChange={(vibrate) => onChangeAlert({ vibrate })}
            trackColor={{ true: cadenceTokens.accent }}
          />
        </View>
      ) : null}
      <Text className="mt-3 text-sm text-slate-700">Remind me</Text>
      <LeadTimeChips
        allowDefault
        defaultLabel={`Default (${formatLeadMinutes(defaultLeadMinutes).toLowerCase()})`}
        value={lead.kind === "mixed" ? "mixed" : lead.kind === "default" ? null : lead.minutes}
        onChange={onChangeLead}
        testID={`reminder-lead-${medication.id}`}
      />
    </View>
  );
}
