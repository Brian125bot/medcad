import { Pressable, Text, View } from "react-native";

import type { ScheduledDoseInstance } from "@/lib/domain/medication-data";
import type { DoseSection, SupplyWarning } from "@/lib/today/today-view-model";

import { DoseCard, type DoseCardProps } from "./DoseCard";

type Handlers = Omit<DoseCardProps, "dose" | "supplyWarning">;

/** Time-of-day sections with a "Take all" for the active block. */
export function DoseSectionList({
  sections,
  supplyWarnings,
  onTakeAll,
  ...handlers
}: Handlers & {
  sections: DoseSection[];
  supplyWarnings: Record<string, SupplyWarning>;
  onTakeAll: (doses: ScheduledDoseInstance[]) => void;
}) {
  return (
    <View className="px-5 pt-2">
      {sections.map((section) => (
        <View key={section.block} className="mt-4" testID={`dose-section-${section.block}`}>
          <View className="mb-2 flex-row items-center justify-between">
            <Text accessibilityRole="header" className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {section.block}
            </Text>
            {section.isActive && section.actionableCount > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Take all ${section.actionableCount} ${section.block.toLowerCase()} doses`}
                testID="today-take-all"
                hitSlop={8}
                onPress={() => onTakeAll(section.doses)}
                className="rounded-full bg-teal-50 px-3 py-1"
              >
                <Text className="text-sm font-semibold text-cadence-accent">Take all ({section.actionableCount})</Text>
              </Pressable>
            ) : null}
          </View>
          {section.doses.map((dose) => (
            <DoseCard key={dose.key} dose={dose} supplyWarning={supplyWarnings[dose.medication.id]} {...handlers} />
          ))}
        </View>
      ))}
    </View>
  );
}
