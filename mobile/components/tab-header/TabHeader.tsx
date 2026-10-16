import { Link } from "expo-router";
import { CloudOff } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { cadenceTokens } from "@/constants/theme";
import { formatHeaderDate, SYNC_STATUS_LABEL } from "@/lib/navigation/header";

import { useCurrentDate } from "./useCurrentDate";

/** Shared tab header title: screen title over today's date (COR-73). */
export function TabHeaderTitle({ title }: { title: string }) {
  const today = formatHeaderDate(useCurrentDate());
  return (
    <View accessible accessibilityRole="header" accessibilityLabel={`${title}, ${today}`}>
      <Text className="text-lg font-semibold text-slate-900">{title}</Text>
      <Text className="text-xs text-slate-500">{today}</Text>
    </View>
  );
}

/** Shared tab header actions: sync status pill and the quick "+ Add" action. */
export function TabHeaderActions() {
  return (
    <View className="mr-4 flex-row items-center">
      <View
        accessible
        accessibilityLabel={`Sync status: ${SYNC_STATUS_LABEL}`}
        className="flex-row items-center rounded-full bg-slate-100 px-2.5 py-1"
      >
        <CloudOff color={cadenceTokens.muted} size={14} />
        <Text className="ml-1 text-xs font-medium text-slate-600">{SYNC_STATUS_LABEL}</Text>
      </View>
      <Link href="/medication/new" asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add medication"
          hitSlop={8}
          className="ml-2 rounded-full bg-cadence-accent px-3 py-1.5"
        >
          <Text className="text-sm font-semibold text-white">+ Add</Text>
        </Pressable>
      </Link>
    </View>
  );
}
