import { Link } from "expo-router";
import { Moon, Pill } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { cadenceTokens } from "@/constants/theme";
import type { ScheduledDoseInstance } from "@/lib/domain/medication-data";
import { formatDayHeading, formatSlotTime } from "@/lib/today/today-view-model";

/** No medications yet: onboarding CTA into the COR-75 add wizard. */
export function NoMedicationsState() {
  return (
    <View testID="today-empty-no-medications" className="flex-1 items-center justify-center bg-cadence-background px-8">
      <Pill color={cadenceTokens.accent} size={40} />
      <Text className="mt-4 text-center text-lg font-semibold text-slate-900">Let&apos;s set up your first medication</Text>
      <Text className="mt-1 text-center text-sm text-slate-500">
        Add a medication and its schedule. Your doses will show up here each day.
      </Text>
      <Link href="/medication/new" asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add first medication"
          testID="today-add-first-medication"
          className="mt-6 rounded-full bg-cadence-accent px-6 py-3"
        >
          <Text className="text-base font-semibold text-white">Add First Medication</Text>
        </Pressable>
      </Link>
    </View>
  );
}

/** Nothing scheduled on the selected day: keep the streak visible and show what's next. */
export function RestDayState({
  streak,
  nextDose,
  todayKey,
}: {
  streak: number;
  nextDose: ScheduledDoseInstance | null;
  todayKey: string;
}) {
  return (
    <View testID="today-empty-rest-day" className="mx-5 mt-6 items-center rounded-2xl bg-white px-6 py-8 shadow-sm">
      <Moon color={cadenceTokens.muted} size={32} />
      <Text className="mt-3 text-base font-semibold text-slate-900">No doses scheduled</Text>
      <Text className="mt-1 text-center text-sm text-slate-500">
        Rest day. Your {streak}-day streak is safe.
      </Text>
      {nextDose ? (
        <Text testID="today-next-dose" className="mt-3 text-center text-sm text-slate-700">
          Next: {nextDose.medication.name}, {formatDayHeading(nextDose.dateKey, todayKey)} at{" "}
          {formatSlotTime(nextDose.slot.time)}
        </Text>
      ) : null}
    </View>
  );
}
