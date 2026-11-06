import { Pressable, Text, View } from "react-native";

import { formatLeadMinutes, leadChipLabel, leadChipOptions } from "@/lib/notifications/settings";

/** COR-76: lead-time picker. `null` = inherit the global default (only when `allowDefault`). */
export function LeadTimeChips({
  value,
  onChange,
  allowDefault = false,
  defaultLabel = "Default",
  testID,
}: {
  value: number | null | "mixed";
  onChange: (minutes: number | null) => void;
  allowDefault?: boolean;
  defaultLabel?: string;
  testID?: string;
}) {
  const options = leadChipOptions(value, allowDefault);
  return (
    <View testID={testID} className="mt-2 flex-row flex-wrap gap-2">
      {value === "mixed" ? (
        <View
          testID={testID ? `${testID}-mixed` : undefined}
          accessible
          accessibilityLabel="Mixed lead times"
          className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1.5"
        >
          <Text className="text-sm text-slate-600">Mixed</Text>
        </View>
      ) : null}
      {options.map((minutes) => {
        const selected = value === minutes;
        const label = minutes === null ? defaultLabel : leadChipLabel(minutes);
        return (
          <Pressable
            key={String(minutes)}
            testID={testID ? `${testID}-${minutes ?? "default"}` : undefined}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={minutes === null ? defaultLabel : formatLeadMinutes(minutes)}
            onPress={() => onChange(minutes)}
            className={`rounded-full border px-3 py-1.5 ${selected ? "border-cadence-accent bg-cadence-accent" : "border-slate-300 bg-white"}`}
          >
            <Text className={`text-sm ${selected ? "font-semibold text-white" : "text-slate-700"}`}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
