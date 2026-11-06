import { Pressable, Text, View } from "react-native";

import { PillPreview } from "@/components/medication-wizard/PillPreview";
import { SupplyBar } from "@/components/cabinet/SupplyBar";
import { cadenceTokens } from "@/constants/theme";
import type { CabinetRow } from "@/lib/cabinet/cabinet-view-model";
import type { PillAppearance } from "@/lib/wizard/medication-form";

const FALLBACK_APPEARANCE: PillAppearance = { shape: "round", primaryColor: cadenceTokens.accent, secondaryColor: "#cbd5e1" };

function Badge({ level }: { level: 'out' | 'low' }) {
  const out = level === 'out';
  return (
    <View
      className="rounded-full px-2 py-0.5"
      style={{ backgroundColor: out ? '#fee2e2' : '#fef3c7' }}
    >
      <Text className="text-xs font-semibold" style={{ color: out ? '#b91c1c' : cadenceTokens.alert }}>
        {out ? 'out' : 'low'}
      </Text>
    </View>
  );
}

/** One Cabinet row: pill, name, supply bar, days left and refill actions. */
export function CabinetRowView({
  row,
  pending,
  onRefillQuick,
  onRefillCustom,
}: {
  row: CabinetRow;
  pending: boolean;
  onRefillQuick: () => void;
  onRefillCustom: () => void;
}) {
  const { medication } = row;
  const id = medication.id;
  return (
    <View testID={`cabinet-row-${id}`} className="mb-3 rounded-2xl bg-white p-4 shadow-sm">
      <View className="flex-row items-center gap-3">
        <PillPreview appearance={medication.appearance ?? FALLBACK_APPEARANCE} size={44} />
        <View className="flex-1">
          <Text className="text-base font-semibold text-slate-900" numberOfLines={1}>
            {medication.name}
          </Text>
          <Text className="text-sm text-slate-500" numberOfLines={1}>
            {medication.strength} · {row.unitsLabel} units
          </Text>
        </View>
        {row.warning && <Badge level={row.warning.level} />}
      </View>

      <View className="mt-3">
        <SupplyBar ratio={row.fillRatio} overCapacity={row.overCapacity} label={`${medication.name} supply`} />
      </View>

      <View className="mt-2 flex-row items-center justify-between">
        <Text className="text-sm" style={{ color: cadenceTokens.muted }}>
          {row.daysLeftLabel}
        </Text>
        <View className="flex-row gap-2">
          <Pressable
            testID={`cabinet-refill-30-${id}`}
            disabled={pending}
            onPress={onRefillQuick}
            className="rounded-xl bg-slate-100 px-3 py-1.5"
            style={{ opacity: pending ? 0.5 : 1 }}
          >
            <Text className="text-sm font-semibold" style={{ color: cadenceTokens.ink }}>+30</Text>
          </Pressable>
          <Pressable
            testID={`cabinet-refill-custom-${id}`}
            disabled={pending}
            onPress={onRefillCustom}
            className="rounded-xl px-3 py-1.5"
            style={{ backgroundColor: cadenceTokens.accent, opacity: pending ? 0.5 : 1 }}
          >
            <Text className="text-sm font-semibold text-white">Refill…</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
