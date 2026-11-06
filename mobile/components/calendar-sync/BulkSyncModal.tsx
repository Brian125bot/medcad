import { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { cadenceTokens } from "@/constants/theme";
import { syncAll, type CalendarSyncProgress } from "@/lib/calendar";
import type { Medication } from "@/lib/domain/medication-data";

type RowState = "pending" | "syncing" | "done" | "failed";

const ROW_LABEL: Record<RowState, string> = {
  pending: "Pending",
  syncing: "Syncing…",
  done: "Done",
  failed: "Failed",
};

const ROW_COLOR: Record<RowState, string> = {
  pending: "#64748b",
  syncing: "#2563eb",
  done: "#15803d",
  failed: "#b91c1c",
};

function pendingRows(medications: Medication[]): Record<string, RowState> {
  return Object.fromEntries(medications.map((med) => [med.id, "pending" as RowState]));
}

/** Runs one bulk sync pass; progress events update the row states. */
function BulkSyncContent({ medications, onClose }: { medications: Medication[]; onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, RowState>>(() => pendingRows(medications));
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [running, setRunning] = useState(true);
  const [finished, setFinished] = useState(false);
  const [failedCount, setFailedCount] = useState(0);

  const execute = useCallback(async () => {
    const onProgress = (event: CalendarSyncProgress) => {
      setDone(event.done);
      setTotal(event.total);
      if (event.medicationId) {
        setRows((prev) => ({ ...prev, [event.medicationId as string]: event.state }));
      }
    };
    try {
      const status = await syncAll(onProgress);
      setFailedCount(status.failedCount);
      // Medications the plan skipped (overdue, paused) had no op: they are done.
      setRows((prev) => {
        const next = { ...prev };
        for (const med of medications) {
          if (next[med.id] === "pending" || next[med.id] === "syncing") next[med.id] = "done";
        }
        return next;
      });
    } finally {
      setRunning(false);
      setFinished(true);
    }
  }, [medications]);

  useEffect(() => {
    void execute();
  }, [execute]);

  const retry = () => {
    setRows(pendingRows(medications));
    setDone(0);
    setTotal(0);
    setFailedCount(0);
    setFinished(false);
    setRunning(true);
    void execute();
  };

  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <View className="w-full rounded-2xl bg-white p-5">
      <Text className="text-lg font-semibold text-slate-900">Sync all medications</Text>

      <View
        testID="bulk-sync-progress"
        accessibilityRole="progressbar"
        accessibilityLabel="Bulk sync progress"
        accessibilityValue={{ min: 0, max: Math.max(total, 1), now: done }}
        className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200"
      >
        <View className="h-2 rounded-full bg-cadence-accent" style={{ width: `${percent}%` }} />
      </View>
      <Text className="mt-1 text-xs text-slate-500">{total === 0 ? "Preparing…" : `${done} of ${total} done`}</Text>

      <ScrollView className="mt-3 max-h-72" testID="bulk-sync-rows">
        {medications.map((med) => {
          const state = rows[med.id] ?? "pending";
          return (
            <View
              key={med.id}
              testID={`bulk-sync-row-${med.id}`}
              accessibilityLabel={`${med.name}: ${ROW_LABEL[state]}`}
              className="flex-row items-center justify-between border-b border-slate-100 py-2"
            >
              <Text className="flex-1 pr-3 text-sm text-slate-800" numberOfLines={1}>
                {med.name}
              </Text>
              <Text className="text-xs font-semibold" style={{ color: ROW_COLOR[state] }}>
                {ROW_LABEL[state]}
              </Text>
            </View>
          );
        })}
        {medications.length === 0 ? <Text className="py-3 text-sm text-slate-500">No active medications to sync.</Text> : null}
      </ScrollView>

      {finished && failedCount > 0 ? (
        <Text accessibilityRole="alert" className="mt-3 text-sm text-red-700">
          {failedCount} {failedCount === 1 ? "medication" : "medications"} could not be synced.
        </Text>
      ) : null}

      <View className="mt-4 flex-row justify-end gap-3">
        {finished && failedCount > 0 ? (
          <Pressable
            testID="bulk-sync-retry"
            accessibilityRole="button"
            accessibilityLabel="Retry failed medications"
            onPress={retry}
            className="rounded-xl bg-slate-100 px-4 py-2"
          >
            <Text className="text-sm font-semibold" style={{ color: cadenceTokens.ink }}>
              Retry
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          testID="bulk-sync-done"
          accessibilityRole="button"
          accessibilityLabel="Done"
          accessibilityState={{ disabled: running }}
          disabled={running}
          onPress={onClose}
          className={`rounded-xl px-4 py-2 ${running ? "bg-slate-200" : "bg-cadence-accent"}`}
        >
          <Text className={`text-sm font-semibold ${running ? "text-slate-500" : "text-white"}`}>Done</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Bulk sync modal: one row per active medication with live progress from
 * `syncAll`. Done enables when the run ends; a failed run offers Retry.
 * Content mounts fresh per opening so each run starts from pending rows.
 */
export function BulkSyncModal({
  visible,
  medications,
  onClose,
}: {
  visible: boolean;
  medications: Medication[];
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        {visible ? <BulkSyncContent medications={medications} onClose={onClose} /> : null}
      </View>
    </Modal>
  );
}
