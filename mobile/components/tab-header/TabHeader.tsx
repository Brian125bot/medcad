import { Link } from "expo-router";
import { Bell, CloudOff } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { cadenceTokens } from "@/constants/theme";
import { formatHeaderDate, SYNC_STATUS_LABEL } from "@/lib/navigation/header";

import { useCurrentDate } from "./useCurrentDate";

/** Shared tab header title: today's date with the sync status pill beside it (COR-73). */
export function TabHeaderTitle() {
  const today = formatHeaderDate(useCurrentDate());
  return (
    <View className="flex-row items-center">
      <Text accessibilityRole="header" numberOfLines={1} className="text-lg font-semibold text-slate-900">
        {today}
      </Text>
      <View
        accessible
        accessibilityLabel={`Sync status: ${SYNC_STATUS_LABEL}`}
        className="ml-2 flex-row items-center rounded-full bg-slate-100 px-2.5 py-1"
      >
        <CloudOff color={cadenceTokens.muted} size={14} />
        <Text className="ml-1 text-xs font-medium text-slate-600">{SYNC_STATUS_LABEL}</Text>
      </View>
    </View>
  );
}

/** Shared tab header actions: the quick "+ Add" link, plus the reminder settings bell on Regimen (COR-76). */
export function TabHeaderActions({ showReminderSettings = false }: { showReminderSettings?: boolean }) {
  return (
    <View className="mr-4 flex-row items-center">
      {showReminderSettings ? (
        <Link href="/reminder-settings" asChild>
          <Pressable accessibilityRole="button" accessibilityLabel="Reminder settings" hitSlop={8} className="mr-3 p-1">
            <Bell color={cadenceTokens.ink} size={20} />
          </Pressable>
        </Link>
      ) : null}
      <Link href="/medication/new" asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add medication"
          hitSlop={8}
          className="rounded-full bg-cadence-accent px-3 py-1.5"
        >
          <Text className="text-sm font-semibold text-white">+ Add</Text>
        </Pressable>
      </Link>
    </View>
  );
}
