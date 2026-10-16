import { Link, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";

import type { Medication } from "@/lib/domain/medication-data";
import { getStorageContext } from "@/lib/storage";

/** Minimal medication list: entry point for the COR-75 add / edit wizard. */
export default function MedicationsScreen() {
  const [meds, setMeds] = useState<Medication[]>([]);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getStorageContext()
        .then(({ repository }) => repository.getAllMedications())
        .then((list) => alive && (setMeds(list), setFailed(false)))
        .catch(() => alive && setFailed(true));
      return () => {
        alive = false;
      };
    }, []),
  );

  return (
    <View className="flex-1 bg-cadence-background">
      <FlatList
        data={meds}
        keyExtractor={(m) => m.id}
        contentContainerClassName="px-5 pb-28 pt-4"
        ListEmptyComponent={
          <Text className="mt-10 text-center text-slate-500">
            {failed ? "Could not load medications." : "No medications yet."}
          </Text>
        }
        renderItem={({ item }) => (
          <Link href={{ pathname: "/medication/[id]", params: { id: item.id } }} asChild>
            <Pressable className="mb-3 rounded-2xl bg-white p-4 shadow-sm">
              <Text className="text-base font-semibold text-slate-900">{item.name}</Text>
              <Text className="mt-0.5 text-sm text-slate-500">
                {item.strength} · {item.form} · {item.timeSlots.length}× per dose day
              </Text>
            </Pressable>
          </Link>
        )}
      />
      <Link href="/medication/new" asChild>
        <Pressable accessibilityRole="button" className="absolute bottom-6 left-5 right-5 items-center rounded-xl bg-cadence-accent py-3.5">
          <Text className="text-base font-semibold text-white">+ Add medication</Text>
        </Pressable>
      </Link>
    </View>
  );
}
