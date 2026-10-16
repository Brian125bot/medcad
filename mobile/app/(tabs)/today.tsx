import * as Haptics from "expo-haptics";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { DoseSectionList } from "@/components/today/DoseSectionList";
import { SkipReasonSheet } from "@/components/today/SkipReasonSheet";
import { AllDoneBanner, ErrorBanner, UndoSnackbar } from "@/components/today/StatusBanners";
import { TodayHeader } from "@/components/today/TodayHeader";
import { NoMedicationsState, RestDayState } from "@/components/today/TodayEmptyState";
import { cadenceTokens } from "@/constants/theme";
import { useTodaySchedule } from "@/hooks/useTodaySchedule";
import type { ScheduledDoseInstance } from "@/lib/domain/medication-data";

const ignore = () => undefined;

/** Today tab: the daily dose protocol (COR-74). */
export default function TodayScreen() {
  const { store, state, viewModel: vm } = useTodaySchedule();
  const [skipTarget, setSkipTarget] = useState<ScheduledDoseInstance | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const take = useCallback(
    (dose: ScheduledDoseInstance) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(ignore);
      void store.markDoseTaken(dose);
    },
    [store],
  );
  const takeAll = useCallback(
    (doses: ScheduledDoseInstance[]) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(ignore);
      void store.takeAll(doses);
    },
    [store],
  );
  const skip = useCallback(
    (dose: ScheduledDoseInstance, reason?: string) => {
      Haptics.selectionAsync().catch(ignore);
      setSkipTarget(null);
      void store.markDoseSkipped(dose, reason);
    },
    [store],
  );
  const undo = useCallback((dose: ScheduledDoseInstance) => void store.resetDoseToPending(dose), [store]);
  const dismissUndo = useCallback(() => store.dismissUndo(), [store]);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    await store.load();
    setRefreshing(false);
  }, [store]);

  if (state.status === "idle" || state.status === "loading") {
    return (
      <View className="flex-1 items-center justify-center bg-cadence-background" testID="today-loading">
        <ActivityIndicator color={cadenceTokens.accent} accessibilityLabel="Loading today's doses" />
      </View>
    );
  }

  if (state.status === "error") {
    return (
      <View className="flex-1 items-center justify-center bg-cadence-background px-8">
        <Text className="text-center text-base text-slate-700">{state.error}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void store.load()}
          className="mt-4 rounded-full bg-cadence-accent px-5 py-2.5"
        >
          <Text className="font-semibold text-white">Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (vm.emptyState === "no-medications") return <NoMedicationsState />;

  return (
    <View className="flex-1 bg-cadence-background">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 96 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={cadenceTokens.accent} />}
      >
        <TodayHeader
          viewModel={vm}
          onSelectDate={(dateKey) => store.selectDate(dateKey)}
          onJumpToToday={() => store.goToToday()}
        />
        {state.error ? <ErrorBanner message={state.error} onDismiss={() => store.dismissError()} /> : null}
        {vm.celebrate ? <AllDoneBanner /> : null}
        {vm.emptyState === "rest-day" ? (
          <RestDayState streak={vm.streak.current} nextDose={vm.nextDose} todayKey={vm.todayKey} />
        ) : (
          <DoseSectionList
            sections={vm.sections}
            supplyWarnings={vm.supplyWarnings}
            onTake={take}
            onSkip={skip}
            onSkipWithReason={setSkipTarget}
            onUndo={undo}
            onTakeAll={takeAll}
          />
        )}
      </ScrollView>
      {state.undo ? <UndoSnackbar entry={state.undo} onUndo={() => void store.undoLastAction()} onDismiss={dismissUndo} /> : null}
      <SkipReasonSheet dose={skipTarget} onSkip={skip} onClose={() => setSkipTarget(null)} />
    </View>
  );
}
