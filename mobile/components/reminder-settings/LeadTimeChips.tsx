import { Pressable, Text, View } from "react-native";

import { formatLeadMinutes, LEAD_TIME_OPTIONS } from "@/lib/notifications/settings";

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
  const options: (number | null)[] = allowDefault ? [null, ...LEAD_TIME_OPTIONS] : [...LEAD_TIME_OPTIONS];
  return (
    <View testID={testID} className="mt-2 flex-row flex-wrap gap-2">
      {value === "mixed" ? (
        <View className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1.5">
          <Text className="text-sm text-slate-600">Mixed</Text>
        </View>
      ) : null}
      {options.map((minutes) => {
        const selected = value === minutes;
        const label = minutes === null ? defaultLabel : minutes === 0 ? "At time" : `${minutes} min`;
        return (
          <Pressable
            key={String(minutes)}
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
