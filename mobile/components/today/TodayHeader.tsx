import { Flame } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { cadenceTokens } from "@/constants/theme";
import type { TodayViewModel } from "@/lib/today/today-view-model";

import { ProgressRing } from "./ProgressRing";

/** Date heading, 7-day strip, daily progress ring and streak badge. */
export function TodayHeader({
  viewModel: vm,
  onSelectDate,
  onJumpToToday,
}: {
  viewModel: TodayViewModel;
  onSelectDate: (dateKey: string) => void;
  onJumpToToday: () => void;
}) {
  const { progress, streak } = vm;
  return (
    <View className="px-5 pt-4">
      <View className="flex-row items-center justify-between">
        <Text accessibilityRole="header" testID="today-heading" className="text-2xl font-bold text-slate-900">
          {vm.heading}
        </Text>
        {!vm.isViewingToday ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Jump to today"
            testID="today-jump-to-today"
            hitSlop={8}
            onPress={onJumpToToday}
            className="rounded-full bg-teal-50 px-3 py-1.5"
          >
            <Text className="text-sm font-semibold text-cadence-accent">Today</Text>
          </Pressable>
        ) : null}
      </View>

      <View className="mt-3 flex-row justify-between" accessibilityRole="tablist">
        {vm.dateStrip.map((day) => (
          <Pressable
            key={day.dateKey}
            accessibilityRole="tab"
            accessibilityLabel={`${day.isToday ? "Today, " : ""}${day.weekday} ${day.dayOfMonth}`}
            accessibilityState={{ selected: day.isSelected }}
            testID={`today-date-${day.dateKey}`}
            onPress={() => onSelectDate(day.dateKey)}
            className={`w-11 items-center rounded-2xl py-2 ${day.isSelected ? "bg-cadence-accent" : "bg-white"}`}
          >
            <Text className={`text-xs ${day.isSelected ? "text-teal-50" : "text-slate-500"}`}>{day.weekday}</Text>
            <Text className={`mt-0.5 text-base font-semibold ${day.isSelected ? "text-white" : "text-slate-900"}`}>
              {day.dayOfMonth}
            </Text>
            {day.isToday ? (
              <View className={`mt-0.5 h-1 w-1 rounded-full ${day.isSelected ? "bg-white" : "bg-cadence-accent"}`} />
            ) : null}
          </Pressable>
        ))}
      </View>

      <View className="mt-4 flex-row items-center rounded-2xl bg-white p-4 shadow-sm">
        <ProgressRing taken={progress.taken} total={progress.total} />
        <View className="ml-4 flex-1">
          <Text className="text-base font-semibold text-slate-900">
            {progress.taken} of {progress.total} doses taken
          </Text>
          <Text className="mt-0.5 text-sm text-slate-500">
            {progress.pending > 0
              ? `${progress.pending} still to take`
              : progress.missed > 0
                ? `${progress.missed} missed`
                : progress.total > 0
                  ? "All logged"
                  : "Nothing scheduled"}
          </Text>
        </View>
        <View
          accessible
          accessibilityLabel={`Current streak ${streak.current} ${streak.current === 1 ? "day" : "days"}, best ${streak.best}${
            streak.todayComplete ? ", today complete" : ""
          }`}
          className={`items-center rounded-2xl px-3 py-2 ${streak.todayComplete ? "bg-orange-50" : "bg-slate-100"}`}
        >
          <View className="flex-row items-center">
            <Flame color={streak.todayComplete ? "#ea580c" : cadenceTokens.muted} size={18} />
            <Text testID="today-streak-count" className="ml-1 text-lg font-bold text-slate-900">
              {streak.current}
            </Text>
          </View>
          <Text className="text-[11px] text-slate-500">Best {streak.best}</Text>
        </View>
      </View>
    </View>
  );
}
