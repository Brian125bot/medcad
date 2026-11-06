import { useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";

import { cadenceTokens } from "@/constants/theme";
import { formatUnits, parseRefillUnits, refillPresets } from "@/lib/cabinet/cabinet-view-model";

/** Custom-amount refill sheet with preset chips and inline validation. */
export function RefillSheet({
  visible,
  capacityUnits,
  onClose,
  onApply,
}: {
  visible: boolean;
  capacityUnits: number;
  onClose: () => void;
  onApply: (units: number) => void;
}) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const presets = refillPresets(capacityUnits);

  const apply = () => {
    try {
      const units = parseRefillUnits(input);
      onApply(units);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enter a valid amount.");
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="w-full rounded-2xl bg-white p-5">
          <Text className="text-lg font-semibold text-slate-900">Refill supply</Text>

          <View className="mt-4 flex-row flex-wrap gap-2">
            {presets.map((preset) => (
              <Pressable
                key={preset}
                testID={`refill-preset-${preset}`}
                onPress={() => {
                  setInput(String(preset));
                  setError(null);
                }}
                className="rounded-xl bg-slate-100 px-3 py-2"
              >
                <Text className="text-sm font-semibold" style={{ color: cadenceTokens.ink }}>
                  {formatUnits(preset)}
                </Text>
              </Pressable>
            ))}
          </View>

          <TextInput
            testID="refill-sheet-input"
            value={input}
            onChangeText={(value) => {
              setInput(value);
              setError(null);
            }}
            placeholder="Custom amount"
            keyboardType="decimal-pad"
            className="mt-4 rounded-xl border border-slate-300 px-3 py-2 text-base text-slate-900"
          />
          {error && <Text className="mt-2 text-sm" style={{ color: "#b91c1c" }}>{error}</Text>}

          <View className="mt-5 flex-row justify-end gap-2">
            <Pressable testID="refill-sheet-cancel" onPress={onClose} className="rounded-xl bg-slate-100 px-4 py-2">
              <Text className="text-sm font-semibold" style={{ color: cadenceTokens.ink }}>Cancel</Text>
            </Pressable>
            <Pressable testID="refill-sheet-apply" onPress={apply} className="rounded-xl px-4 py-2" style={{ backgroundColor: cadenceTokens.accent }}>
              <Text className="text-sm font-semibold text-white">Apply</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
