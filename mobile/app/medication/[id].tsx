import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { MedicationWizard } from "@/components/medication-wizard/MedicationWizard";
import { cadenceTokens } from "@/constants/theme";
import type { Medication } from "@/lib/domain/medication-data";
import { getStorageContext } from "@/lib/storage";
import { toDateKey } from "@/lib/schedule/date-keys";
import { medicationToForm, type MedicationFormState } from "@/lib/wizard/medication-form";

export default function EditMedicationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loaded, setLoaded] = useState<{ med: Medication; form: MedicationFormState } | null | "missing">(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { repository } = await getStorageContext();
      const med = await repository.getMedicationById(String(id));
      if (!alive) return;
      setLoaded(med ? { med, form: medicationToForm(med, toDateKey(new Date())) } : "missing");
    })().catch(() => alive && setLoaded("missing"));
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <>
      <Stack.Screen options={{ title: "Edit medication" }} />
      {loaded === null ? (
        <View className="flex-1 items-center justify-center bg-cadence-background">
          <ActivityIndicator color={cadenceTokens.accent} />
        </View>
      ) : loaded === "missing" ? (
        <View className="flex-1 items-center justify-center bg-cadence-background">
          <Text className="text-slate-500">Medication not found.</Text>
        </View>
      ) : (
        <MedicationWizard
          initial={loaded.form}
          existing={loaded.med}
          onCancel={() => router.back()}
          onSave={async (med) => {
            const { repository } = await getStorageContext();
            await repository.saveMedication(med);
            router.back();
          }}
        />
      )}
    </>
  );
}
