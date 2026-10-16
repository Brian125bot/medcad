import { randomUUID } from "expo-crypto";
import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { cadenceTokens } from "@/constants/theme";
import type { Medication, ScheduleFrequency } from "@/lib/domain/medication-data";
import {
  firstInvalidStep,
  formToMedication,
  LIMITS,
  MEDICATION_FORMS,
  PILL_COLORS,
  PILL_SHAPES,
  slotErrors,
  validateForm,
  validateStep,
  WIZARD_STEPS,
  type FormErrors,
  type MedicationFormState,
  type WizardStep,
} from "@/lib/wizard/medication-form";

import { NativePickerField } from "./NativePickerField";
import { PillPreview } from "./PillPreview";

const STEP_TITLES: Record<WizardStep, string> = {
  basics: "Basic info",
  appearance: "Pill look",
  schedule: "Schedule",
  inventory: "Inventory",
};

const FREQUENCIES: { value: ScheduleFrequency; label: string }[] = [
  { value: "daily", label: "Every day" },
  { value: "specific_days", label: "Specific days" },
  { value: "interval", label: "Every N days" },
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Props = {
  initial: MedicationFormState;
  existing?: Medication;
  /** Persists through the COR-71 repository. Must not log the medication. */
  onSave: (med: Medication) => Promise<void>;
  onCancel: () => void;
};

export function MedicationWizard({ initial, existing, onSave, onCancel }: Props) {
  const [state, setState] = useState(initial);
  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const step = WIZARD_STEPS[stepIndex];
  const isLast = stepIndex === WIZARD_STEPS.length - 1;

  const update = (patch: Partial<MedicationFormState>) => {
    const next = { ...state, ...patch };
    setState(next);
    // Live re-validation once the user has seen errors on this step.
    if (Object.keys(errors).length > 0) setErrors(validateStep(step, next));
  };

  const updateSlot = (index: number, patch: Partial<MedicationFormState["timeSlots"][number]>) =>
    update({ timeSlots: state.timeSlots.map((s, i) => (i === index ? { ...s, ...patch } : s)) });

  const next = async () => {
    const stepErrors = validateStep(step, state);
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length > 0) return;
    if (!isLast) {
      setStepIndex(stepIndex + 1);
      return;
    }
    const all = validateForm(state);
    const bad = firstInvalidStep(state);
    if (bad) {
      setErrors(all);
      setStepIndex(WIZARD_STEPS.indexOf(bad));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(formToMedication(state, { newId: randomUUID, existing }));
    } catch {
      // Intentionally no details: the error may embed PHI.
      setSaveError("Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const back = () => {
    setErrors({});
    if (stepIndex === 0) onCancel();
    else setStepIndex(stepIndex - 1);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-cadence-background"
    >
      <View className="flex-row px-5 pt-4">
        {WIZARD_STEPS.map((s, i) => (
          <View key={s} className="mr-1 flex-1">
            <View className={`h-1.5 rounded-full ${i <= stepIndex ? "bg-cadence-accent" : "bg-slate-200"}`} />
            <Text className={`mt-1 text-xs ${i === stepIndex ? "font-semibold text-slate-900" : "text-slate-400"}`}>
              {STEP_TITLES[s]}
            </Text>
          </View>
        ))}
      </View>

      <ScrollView className="flex-1" contentContainerClassName="px-5 pb-8 pt-4" keyboardShouldPersistTaps="handled">
        {step === "basics" && (
          <>
            <Field label="Name" error={errors.name}>
              <Input value={state.name} onChangeText={(name) => update({ name })} placeholder="e.g. Atorvastatin" maxLength={LIMITS.nameMax} error={errors.name} />
            </Field>
            <Field label="Generic name (optional)" error={errors.genericName}>
              <Input value={state.genericName} onChangeText={(genericName) => update({ genericName })} maxLength={LIMITS.nameMax} error={errors.genericName} />
            </Field>
            <Field label="Strength" error={errors.strength}>
              <Input value={state.strength} onChangeText={(strength) => update({ strength })} placeholder="e.g. 20 mg" maxLength={LIMITS.strengthMax} error={errors.strength} />
            </Field>
            <Field label="Form" error={errors.form}>
              <Chips options={MEDICATION_FORMS.map((f) => ({ value: f, label: f }))} selected={[state.form]} onToggle={(form) => update({ form })} />
            </Field>
          </>
        )}

        {step === "appearance" && (
          <>
            <View className="mb-4 items-center rounded-2xl bg-white py-6 shadow-sm">
              <PillPreview appearance={state.appearance} />
            </View>
            <Field label="Shape" error={errors.shape}>
              <Chips
                options={PILL_SHAPES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
                selected={[state.appearance.shape]}
                onToggle={(shape) => update({ appearance: { ...state.appearance, shape } })}
              />
            </Field>
            <Field label="Primary color" error={errors.primaryColor}>
              <Swatches value={state.appearance.primaryColor} onChange={(primaryColor) => update({ appearance: { ...state.appearance, primaryColor } })} />
            </Field>
            <Field label="Secondary color" error={errors.secondaryColor}>
              <Swatches value={state.appearance.secondaryColor} onChange={(secondaryColor) => update({ appearance: { ...state.appearance, secondaryColor } })} />
            </Field>
          </>
        )}

        {step === "schedule" && (
          <>
            <Field label="How often" error={errors.frequency}>
              <Chips options={FREQUENCIES} selected={[state.frequency]} onToggle={(frequency) => update({ frequency })} />
            </Field>
            {state.frequency === "specific_days" && (
              <Field label="Days" error={errors.daysOfWeek}>
                <Chips
                  options={WEEKDAYS.map((label, value) => ({ value, label }))}
                  selected={state.daysOfWeek}
                  onToggle={(d) =>
                    update({
                      daysOfWeek: state.daysOfWeek.includes(d)
                        ? state.daysOfWeek.filter((x) => x !== d)
                        : [...state.daysOfWeek, d],
                    })
                  }
                />
              </Field>
            )}
            {state.frequency === "interval" && (
              <Field label="Repeat every (days)" error={errors.intervalDays}>
                <Input value={state.intervalDays} onChangeText={(intervalDays) => update({ intervalDays })} keyboardType="number-pad" error={errors.intervalDays} />
              </Field>
            )}
            <NativePickerField mode="date" label="Start date" value={state.startDate} onChange={(startDate) => update({ startDate })} error={errors.startDate} />

            <Text className="mb-2 mt-2 text-base font-semibold text-slate-900">Dose times</Text>
            {errors.timeSlots ? <Text className="mb-2 text-sm text-cadence-alert">{errors.timeSlots}</Text> : null}
            {state.timeSlots.map((slot, i) => {
              const se = slotErrors(errors, i);
              return (
                <View key={slot.id ?? `new-${i}`} className="mb-3 rounded-2xl bg-white p-4 shadow-sm">
                  <NativePickerField mode="time" label={`Time ${i + 1}`} value={slot.time} onChange={(time) => updateSlot(i, { time })} error={se.time} />
                  <View className="flex-row">
                    <View className="mr-2 flex-1">
                      <Field label="Dose units" error={se.doseUnits}>
                        <Input value={slot.doseUnits} onChangeText={(doseUnits) => updateSlot(i, { doseUnits })} keyboardType="decimal-pad" error={se.doseUnits} />
                      </Field>
                    </View>
                    <View className="flex-1">
                      <Field label="Remind min. before" error={se.leadMinutes}>
                        <Input value={slot.leadMinutes} onChangeText={(leadMinutes) => updateSlot(i, { leadMinutes })} keyboardType="number-pad" placeholder="Default" error={se.leadMinutes} />
                      </Field>
                    </View>
                  </View>
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center">
                      <Switch value={slot.reminderEnabled} onValueChange={(reminderEnabled) => updateSlot(i, { reminderEnabled })} trackColor={{ true: cadenceTokens.accent }} />
                      <Text className="ml-2 text-sm text-slate-700">Reminder</Text>
                    </View>
                    {state.timeSlots.length > 1 && (
                      <Pressable accessibilityRole="button" onPress={() => update({ timeSlots: state.timeSlots.filter((_, j) => j !== i) })}>
                        <Text className="text-sm font-semibold text-cadence-alert">Remove</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
            {state.timeSlots.length < LIMITS.slotsMax && (
              <Pressable
                accessibilityRole="button"
                onPress={() => update({ timeSlots: [...state.timeSlots, { time: "20:00", doseUnits: "1", leadMinutes: "", reminderEnabled: true }] })}
                className="items-center rounded-xl border border-dashed border-cadence-accent py-3"
              >
                <Text className="font-semibold text-cadence-accent">+ Add dose time</Text>
              </Pressable>
            )}
          </>
        )}

        {step === "inventory" && (
          <>
            <Field label="Units on hand" error={errors.currentUnits}>
              <Input value={state.currentUnits} onChangeText={(currentUnits) => update({ currentUnits })} keyboardType="number-pad" error={errors.currentUnits} />
            </Field>
            <Field label="Package size (units)" error={errors.capacityUnits}>
              <Input value={state.capacityUnits} onChangeText={(capacityUnits) => update({ capacityUnits })} keyboardType="number-pad" error={errors.capacityUnits} />
            </Field>
            <Field label="Low-stock alert at (units)" error={errors.lowThresholdUnits}>
              <Input value={state.lowThresholdUnits} onChangeText={(lowThresholdUnits) => update({ lowThresholdUnits })} keyboardType="number-pad" error={errors.lowThresholdUnits} />
            </Field>
            <NativePickerField mode="date" label="Last refilled" value={state.lastRefilledAt} onChange={(lastRefilledAt) => update({ lastRefilledAt })} error={errors.lastRefilledAt} />
            <Field label="Pharmacy notes (optional)" error={errors.pharmacyNote}>
              <Input value={state.pharmacyNote} onChangeText={(pharmacyNote) => update({ pharmacyNote })} placeholder="e.g. CVS #4102 · Rx #884920" maxLength={LIMITS.noteMax} multiline error={errors.pharmacyNote} />
            </Field>
          </>
        )}
        {saveError ? <Text className="mt-2 text-sm text-cadence-alert">{saveError}</Text> : null}
      </ScrollView>

      <View className="flex-row border-t border-slate-200 bg-white px-5 py-3">
        <Pressable accessibilityRole="button" onPress={back} disabled={saving} className="mr-3 flex-1 items-center rounded-xl border border-slate-300 py-3.5">
          <Text className="font-semibold text-slate-700">{stepIndex === 0 ? "Cancel" : "Back"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={next} disabled={saving} className="flex-1 items-center rounded-xl bg-cadence-accent py-3.5">
          {saving ? <ActivityIndicator color="#ffffff" /> : (
            <Text className="font-semibold text-white">{isLast ? (existing ? "Save changes" : "Add medication") : "Next"}</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <View className="mb-3">
      <Text className="mb-1 text-sm font-medium text-slate-700">{label}</Text>
      {children}
      {error ? <Text className="mt-1 text-sm text-cadence-alert">{error}</Text> : null}
    </View>
  );
}

function Input({ error, ...props }: React.ComponentProps<typeof TextInput> & { error?: string }) {
  return (
    <TextInput
      {...props}
      autoCorrect={false}
      placeholderTextColor={cadenceTokens.muted}
      className={`rounded-xl border bg-white px-4 py-3 text-base text-slate-900 ${error ? "border-cadence-alert" : "border-slate-200"}`}
    />
  );
}

function Chips<T extends string | number>({ options, selected, onToggle }: {
  options: { value: T; label: string }[];
  selected: readonly (T | "")[];
  onToggle: (value: T) => void;
}) {
  return (
    <View className="flex-row flex-wrap">
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onToggle(o.value)}
            className={`mb-2 mr-2 rounded-full border px-4 py-2 ${on ? "border-cadence-accent bg-cadence-accent" : "border-slate-300 bg-white"}`}
          >
            <Text className={on ? "font-semibold text-white" : "text-slate-700"}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Swatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <View className="flex-row flex-wrap">
      {PILL_COLORS.map((c) => (
        <Pressable
          key={c}
          accessibilityRole="button"
          accessibilityLabel={`Color ${c}`}
          accessibilityState={{ selected: c === value }}
          onPress={() => onChange(c)}
          className={`mb-2 mr-2 h-10 w-10 rounded-full border-2 ${c === value ? "border-cadence-accent" : "border-slate-200"}`}
          style={{ backgroundColor: c }}
        />
      ))}
    </View>
  );
}
