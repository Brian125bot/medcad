import { router, Stack } from "expo-router";
import { useState } from "react";

import { MedicationWizard } from "@/components/medication-wizard/MedicationWizard";
import { getStorageContext } from "@/lib/storage";
import { toDateKey } from "@/lib/schedule/date-keys";
import { createEmptyForm } from "@/lib/wizard/medication-form";

export default function NewMedicationScreen() {
  const [initial] = useState(() => createEmptyForm(toDateKey(new Date())));
  return (
    <>
      <Stack.Screen options={{ title: "Add medication" }} />
      <MedicationWizard
        initial={initial}
        onCancel={() => router.back()}
        onSave={async (med) => {
          const { repository } = await getStorageContext();
          await repository.saveMedication(med);
          router.back();
        }}
      />
    </>
  );
}
