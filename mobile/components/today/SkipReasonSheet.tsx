import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ScheduledDoseInstance } from "@/lib/domain/medication-data";

export const SKIP_REASONS = ["Felt unwell", "Ran out", "Doctor's advice", "Forgot"] as const;

/** Bottom action sheet shown on swipe-left: skip with an optional reason. */
export function SkipReasonSheet({
  dose,
  onSkip,
  onClose,
}: {
  dose: ScheduledDoseInstance | null;
  onSkip: (dose: ScheduledDoseInstance, reason?: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const options: { label: string; reason?: string }[] = [
    { label: "Skip" },
    ...SKIP_REASONS.map((reason) => ({ label: reason, reason })),
  ];

  return (
    <Modal visible={dose !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" className="flex-1 bg-black/30" onPress={onClose} />
      <View
        testID="skip-reason-sheet"
        style={{ paddingBottom: insets.bottom + 12 }}
        className="rounded-t-3xl bg-white px-5 pt-5"
      >
        <Text accessibilityRole="header" className="text-base font-semibold text-slate-900">
          Skip {dose?.medication.name}?
        </Text>
        <Text className="mb-3 mt-0.5 text-sm text-slate-500">Choose a reason (optional).</Text>
        {options.map(({ label, reason }) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={reason ? `Skip: ${reason}` : "Skip without a reason"}
            onPress={() => dose && onSkip(dose, reason)}
            className="border-b border-slate-100 py-3.5"
          >
            <Text className="text-base text-slate-800">{label}</Text>
          </Pressable>
        ))}
        <Pressable accessibilityRole="button" onPress={onClose} className="mt-2 items-center py-3.5">
          <Text className="text-base font-semibold text-cadence-accent">Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
