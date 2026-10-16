import { X } from "lucide-react-native";
import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";

import { cadenceTokens } from "@/constants/theme";
import type { TodayUndoEntry } from "@/lib/today/today-store";

export const UNDO_SNACKBAR_MS = 5000;

/** Non-blocking error banner (load failures, rolled-back writes). */
export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID="today-error-banner"
      className="mx-5 mt-3 flex-row items-center rounded-xl bg-red-50 px-4 py-3"
    >
      <Text className="flex-1 text-sm text-red-800">{message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss error"
        hitSlop={8}
        onPress={onDismiss}
        testID="today-error-dismiss"
      >
        <X color="#991b1b" size={18} />
      </Pressable>
    </View>
  );
}

/** Temporary bottom snackbar offering to undo the latest dose action. */
export function UndoSnackbar({
  entry,
  onUndo,
  onDismiss,
}: {
  entry: TodayUndoEntry;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, UNDO_SNACKBAR_MS);
    return () => clearTimeout(timer);
  }, [entry.id, onDismiss]);

  return (
    <View
      accessibilityLiveRegion="polite"
      testID="today-undo-snackbar"
      className="absolute bottom-4 left-5 right-5 flex-row items-center rounded-xl bg-slate-900 px-4 py-3 shadow-lg"
    >
      <Text className="flex-1 text-sm text-white" numberOfLines={2}>
        {entry.label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Undo: ${entry.label}`}
        hitSlop={8}
        onPress={onUndo}
        testID="today-undo-action"
      >
        <Text style={{ color: "#5eead4" }} className="text-sm font-bold">
          UNDO
        </Text>
      </Pressable>
    </View>
  );
}

/** Subtle banner once every dose of the day is taken. */
export function AllDoneBanner() {
  return (
    <View
      accessible
      accessibilityLiveRegion="polite"
      testID="today-all-done"
      className="mx-5 mt-3 rounded-xl bg-emerald-50 px-4 py-3"
    >
      <Text style={{ color: cadenceTokens.adherence }} className="text-sm font-semibold">
        All doses taken. Nice work!
      </Text>
    </View>
  );
}
