import * as Haptics from "expo-haptics";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";

import { CabinetRowView } from "@/components/cabinet/CabinetRow";
import { RefillSheet } from "@/components/cabinet/RefillSheet";
import { EmptyTabState } from "@/components/EmptyTabState";
import { cadenceTokens } from "@/constants/theme";
import { useCabinet } from "@/hooks/useCabinet";
import { QUICK_REFILL_UNITS, type CabinetRow } from "@/lib/cabinet/cabinet-view-model";
import type { Medication } from "@/lib/domain/medication-data";

const ignore = () => undefined;

/** Cabinet tab: inventory, refills and low-stock alerts (COR-78). */
export default function CabinetScreen() {
  const { store, state, viewModel } = useCabinet();
  const [refillTarget, setRefillTarget] = useState<Medication | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refill = (medication: Medication, units: number) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(ignore);
    void store.refill(medication.id, units);
  };

  if (state.status === "idle" || state.status === "loading") {
    return (
      <View className="flex-1 items-center justify-center bg-cadence-background">
        <ActivityIndicator color={cadenceTokens.accent} />
      </View>
    );
  }

  if (state.status === "error") {
    return (
      <View className="flex-1 items-center justify-center bg-cadence-background px-8">
        <Text className="text-center text-base font-semibold text-slate-900">Could not load your cabinet.</Text>
        <Pressable onPress={() => void store.load()} className="mt-4 rounded-xl px-4 py-2" style={{ backgroundColor: cadenceTokens.accent }}>
          <Text className="text-sm font-semibold text-white">Try again</Text>
        </Pressable>
      </View>
    );
  }

  const renderRow = ({ item }: { item: CabinetRow }) => (
    <CabinetRowView
      row={item}
      pending={false}
      onRefillQuick={() => refill(item.medication, QUICK_REFILL_UNITS)}
      onRefillCustom={() => setRefillTarget(item.medication)}
    />
  );

  return (
    <View className="flex-1 bg-cadence-background">
      {state.error && (
        <View className="mx-4 mt-3 flex-row items-center justify-between rounded-xl bg-amber-50 px-3 py-2">
          <Text className="flex-1 text-sm" style={{ color: cadenceTokens.alert }}>{state.error}</Text>
          <Pressable onPress={store.dismissError}>
            <Text className="text-sm font-semibold" style={{ color: cadenceTokens.ink }}>Dismiss</Text>
          </Pressable>
        </View>
      )}

      {viewModel.rows.length === 0 && viewModel.inactive.length === 0 ? (
        <EmptyTabState title="Cabinet is empty" message="Add a medication in Regimen to track its supply." />
      ) : (
        <FlatList
          data={viewModel.rows}
          keyExtractor={(row) => row.medication.id}
          contentContainerClassName="px-4 pt-4 pb-10"
          renderItem={renderRow}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void store.load().finally(() => setRefreshing(false));
              }}
            />
          }
          ListFooterComponent={
            viewModel.inactive.length > 0 ? (
              <View className="mt-2">
                <Text className="mb-2 text-sm font-semibold" style={{ color: cadenceTokens.muted }}>Paused</Text>
                {viewModel.inactive.map((row) => (
                  <CabinetRowView
                    key={row.medication.id}
                    row={row}
                    pending={false}
                    onRefillQuick={() => undefined}
                    onRefillCustom={() => undefined}
                  />
                ))}
              </View>
            ) : null
          }
        />
      )}

      <RefillSheet
        key={refillTarget ? `${refillTarget.id}-open` : "closed"}
        visible={refillTarget !== null}
        capacityUnits={refillTarget?.inventory.capacityUnits ?? 0}
        onClose={() => setRefillTarget(null)}
        onApply={(units) => {
          if (refillTarget) refill(refillTarget, units);
        }}
      />
    </View>
  );
}
