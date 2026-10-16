import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { cadenceTokens } from "@/constants/theme";
import { toDateKey, parseDateKey, isValidDateKey } from "@/lib/schedule/date-keys";
import { dateToTime, timeToDate } from "@/lib/wizard/medication-form";

type Props = {
  mode: "time" | "date";
  /** HH:mm for time mode, YYYY-MM-DD for date mode. */
  value: string;
  onChange: (value: string) => void;
  label: string;
  error?: string;
};

/**
 * Native iOS / Android date-time wheels (COR-75). iOS shows an inline
 * spinner when expanded; Android opens the system dialog.
 */
export function NativePickerField({ mode, value, onChange, label, error }: Props) {
  const [open, setOpen] = useState(false);
  const pickerValue =
    mode === "time"
      ? timeToDate(value)
      : isValidDateKey(value)
        ? parseDateKey(value)
        : new Date();

  const handleChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === "android") setOpen(false);
    if (event.type === "set" && date) {
      onChange(mode === "time" ? dateToTime(date) : toDateKey(date));
    }
  };

  return (
    <View className="mb-3">
      <Text className="mb-1 text-sm font-medium text-slate-700">{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || "not set"}`}
        onPress={() => setOpen((o) => !o)}
        className={`rounded-xl border bg-white px-4 py-3 ${error ? "border-cadence-alert" : "border-slate-200"}`}
      >
        <Text className="font-mono text-base text-slate-900">{value || "Select"}</Text>
      </Pressable>
      {open && (
        <DateTimePicker
          value={pickerValue}
          mode={mode}
          display="spinner"
          is24Hour
          onChange={handleChange}
          accentColor={cadenceTokens.accent}
        />
      )}
      {open && Platform.OS === "ios" && (
        <Pressable onPress={() => setOpen(false)} className="self-end px-2 py-1">
          <Text className="font-semibold text-cadence-accent">Done</Text>
        </Pressable>
      )}
      {error ? <Text className="mt-1 text-sm text-cadence-alert">{error}</Text> : null}
    </View>
  );
}
