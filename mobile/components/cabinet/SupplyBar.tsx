import { View } from "react-native";

import { cadenceTokens } from "@/constants/theme";

/** Capacity progress bar for one Cabinet row. */
export function SupplyBar({ ratio, overCapacity, label }: { ratio: number; overCapacity: boolean; label: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  const color = overCapacity ? cadenceTokens.alert : cadenceTokens.accent;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
    >
      <View className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: color }} />
    </View>
  );
}
