import { AlertTriangle, Check, Clock, SkipForward } from "lucide-react-native";
import { useRef } from "react";
import { Pressable, Text, View } from "react-native";
import Swipeable, { type SwipeableMethods, SwipeDirection } from "react-native-gesture-handler/ReanimatedSwipeable";

import { cadenceTokens } from "@/constants/theme";
import type { ScheduledDoseInstance } from "@/lib/domain/medication-data";
import {
  type DoseAction,
  formatDoseDetail,
  formatSlotTime,
  getDoseActionLabel,
  getDoseActions,
  type SupplyWarning,
} from "@/lib/today/today-view-model";

type Status = ScheduledDoseInstance["effectiveStatus"];

const STATUS_TEXT: Record<Status, string> = {
  pending: "Due",
  missed: "Missed",
  taken: "Taken",
  skipped: "Skipped",
};

const CARD_STYLE: Record<Status, string> = {
  pending: "bg-white",
  missed: "bg-white border border-amber-300",
  taken: "bg-emerald-50",
  skipped: "bg-slate-100",
};

const BADGE_STYLE: Record<Status, { box: string; text: string }> = {
  pending: { box: "bg-slate-100", text: "text-slate-600" },
  missed: { box: "bg-amber-100", text: "text-amber-800" },
  taken: { box: "bg-emerald-100", text: "text-emerald-800" },
  skipped: { box: "bg-slate-200", text: "text-slate-600" },
};

export interface DoseCardProps {
  dose: ScheduledDoseInstance;
  supplyWarning?: SupplyWarning;
  onTake: (dose: ScheduledDoseInstance) => void;
  onSkip: (dose: ScheduledDoseInstance) => void;
  /** Swipe left: choose a skip reason. */
  onSkipWithReason: (dose: ScheduledDoseInstance) => void;
  onUndo: (dose: ScheduledDoseInstance) => void;
}

function SwipePanel({ action }: { action: "take" | "skip" }) {
  const take = action === "take";
  return (
    <View
      style={{ backgroundColor: take ? cadenceTokens.adherence : cadenceTokens.alert }}
      className={`mb-3 flex-1 justify-center rounded-2xl px-6 ${take ? "items-start" : "items-end"}`}
    >
      {take ? <Check color="white" size={22} /> : <SkipForward color="white" size={22} />}
      <Text className="mt-1 text-xs font-semibold text-white">{take ? "Take" : "Skip"}</Text>
    </View>
  );
}

/**
 * One scheduled dose. Swipe right to take, left to skip with a reason; the
 * buttons offer the same actions for screen-reader and non-gesture users.
 */
export function DoseCard({ dose, supplyWarning, onTake, onSkip, onSkipWithReason, onUndo }: DoseCardProps) {
  const swipeRef = useRef<SwipeableMethods>(null);
  const { medication, slot, effectiveStatus: status, log } = dose;
  const actions = getDoseActions(status);
  const canSwipeTake = actions.includes("take");
  const canSwipeSkip = actions.includes("skip");
  const time = formatSlotTime(slot.time);
  const statusLine =
    status === "taken" && log
      ? `Taken at ${formatSlotTime(log.loggedAt)}`
      : status === "skipped" && log?.note
        ? `Skipped · ${log.note}`
        : STATUS_TEXT[status];

  const handlers: Record<DoseAction, () => void> = {
    take: () => onTake(dose),
    skip: () => onSkip(dose),
    undo: () => onUndo(dose),
  };

  const handleSwipe = (direction: SwipeDirection.LEFT | SwipeDirection.RIGHT) => {
    swipeRef.current?.close();
    if (direction === SwipeDirection.RIGHT) onTake(dose);
    else onSkipWithReason(dose);
  };

  return (
    <Swipeable
      ref={swipeRef}
      friction={2}
      leftThreshold={80}
      rightThreshold={80}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={canSwipeTake ? () => <SwipePanel action="take" /> : undefined}
      renderRightActions={canSwipeSkip ? () => <SwipePanel action="skip" /> : undefined}
      onSwipeableWillOpen={handleSwipe}
    >
      <View
        testID={`dose-card-${medication.id}-${slot.time}`}
        className={`mb-3 rounded-2xl p-4 shadow-sm ${CARD_STYLE[status]}`}
      >
        <View
          accessible
          accessibilityLabel={`${medication.name}, ${formatDoseDetail(medication, slot)}, ${time}, ${statusLine}`}
          className="flex-row items-start"
        >
          <View className="flex-1">
            <Text
              className={`text-base font-semibold ${status === "taken" ? "text-slate-500" : "text-slate-900"}`}
              numberOfLines={1}
            >
              {medication.name}
            </Text>
            <Text className="mt-0.5 text-sm text-slate-500" numberOfLines={2}>
              {formatDoseDetail(medication, slot)}
            </Text>
          </View>
          <View className="ml-3 items-end">
            <View className="flex-row items-center">
              <Clock color={cadenceTokens.muted} size={14} />
              <Text className="ml-1 text-sm font-medium text-slate-700">{time}</Text>
            </View>
            <View className={`mt-1.5 rounded-full px-2 py-0.5 ${BADGE_STYLE[status].box}`}>
              <Text className={`text-xs font-semibold ${BADGE_STYLE[status].text}`}>{statusLine}</Text>
            </View>
          </View>
        </View>

        {supplyWarning ? (
          <View
            accessible
            accessibilityLabel={`Supply warning: ${supplyWarning.label}`}
            testID={`dose-supply-warning-${medication.id}`}
            className={`mt-3 flex-row items-center self-start rounded-full px-2.5 py-1 ${
              supplyWarning.level === "out" ? "bg-red-50" : "bg-amber-50"
            }`}
          >
            <AlertTriangle color={supplyWarning.level === "out" ? "#b91c1c" : cadenceTokens.alert} size={13} />
            <Text
              className={`ml-1 text-xs font-medium ${supplyWarning.level === "out" ? "text-red-700" : "text-amber-800"}`}
            >
              {supplyWarning.label}
            </Text>
          </View>
        ) : null}

        <View className="mt-3 flex-row gap-2">
          {actions.map((action) => {
            const label = getDoseActionLabel(action, status);
            const primary = action === "take";
            return (
              <Pressable
                key={action}
                accessibilityRole="button"
                accessibilityLabel={`${label}: ${medication.name} at ${time}`}
                testID={`dose-action-${action}`}
                hitSlop={4}
                onPress={handlers[action]}
                className={`min-h-[40px] flex-1 items-center justify-center rounded-xl px-3 ${
                  primary ? "bg-cadence-accent" : "border border-slate-300 bg-white"
                }`}
              >
                <Text className={`text-sm font-semibold ${primary ? "text-white" : "text-slate-700"}`}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Swipeable>
  );
}
