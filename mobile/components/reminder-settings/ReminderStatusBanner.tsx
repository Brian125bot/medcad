import { Pressable, Text, View } from "react-native";

import type { ReminderStatus } from "@/lib/notifications";

const COPY: Record<Exclude<ReminderStatus["state"], "ok">, { title: string; body: string; action: string }> = {
  "permission-denied": {
    title: "Notifications are off",
    body: "CadenceRx can't remind you about doses until notifications are allowed.",
    action: "Open settings",
  },
  "exact-alarm-denied": {
    title: "Reminders may be late",
    body: "Allow \"Alarms & reminders\" so doses ring on time.",
    action: "Allow alarms",
  },
  error: {
    title: "Reminders couldn't be updated",
    body: "We'll retry next time you open the app.",
    action: "Retry now",
  },
};

/** COR-76: explains why reminders are not (reliably) scheduled, with a fix action. */
export function ReminderStatusBanner({
  status,
  onOpenNotificationSettings,
  onOpenExactAlarmSettings,
  onRetry,
}: {
  status: ReminderStatus;
  onOpenNotificationSettings: () => void;
  onOpenExactAlarmSettings: () => void;
  onRetry: () => void;
}) {
  if (status.state === "ok") return null;
  const copy = COPY[status.state];
  const onPress =
    status.state === "permission-denied"
      ? onOpenNotificationSettings
      : status.state === "exact-alarm-denied"
        ? onOpenExactAlarmSettings
        : onRetry;
  return (
    <View accessibilityRole="alert" testID="reminder-status-banner" className="mx-5 mt-4 rounded-xl bg-amber-50 px-4 py-3">
      <Text className="text-sm font-semibold text-amber-900">{copy.title}</Text>
      <Text className="mt-1 text-sm text-amber-900">{copy.body}</Text>
      <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8} className="mt-2 self-start">
        <Text className="text-sm font-semibold text-cadence-accent">{copy.action}</Text>
      </Pressable>
    </View>
  );
}
