import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { msUntilNextLocalMidnight } from "@/lib/navigation/header";
import { getStorageContext } from "@/lib/storage";
import { TodayStore, type TodayRepository } from "@/lib/today/today-store";
import { buildTodayViewModel, countPendingDoses } from "@/lib/today/today-view-model";

const repository: TodayRepository = {
  getAllMedications: async () => (await getStorageContext()).repository.getAllMedications(),
  getAllDoseLogs: async () => (await getStorageContext()).repository.getAllDoseLogs(),
  logDose: async (...args) => (await getStorageContext()).repository.logDose(...args),
  undoDose: async (...args) => (await getStorageContext()).repository.undoDose(...args),
};

let sharedStore: TodayStore | null = null;

/** One Today store per app, shared by the screen and the tab badge. */
export function getTodayStore(): TodayStore {
  sharedStore ??= new TodayStore(repository);
  return sharedStore;
}

const MINUTE_MS = 60_000;

/**
 * Today screen state: the COR-74 view model plus the dose actions.
 * Reloads on focus, re-reads the clock every minute, at local midnight and
 * when the app returns to the foreground.
 */
export function useTodaySchedule() {
  const store = getTodayStore();
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const [nowTime, setNowTime] = useState(() => store.nowTime());

  const tick = useCallback(() => {
    store.syncClock();
    setNowTime(store.nowTime());
  }, [store]);

  useFocusEffect(
    useCallback(() => {
      tick();
      void store.load();
    }, [store, tick]),
  );

  useEffect(() => {
    const interval = setInterval(tick, MINUTE_MS);
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      tick();
      void store.load();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [store, tick]);

  useEffect(() => {
    const timer = setTimeout(tick, msUntilNextLocalMidnight(new Date()) + 1000);
    return () => clearTimeout(timer);
  }, [state.todayKey, tick]);

  const viewModel = useMemo(
    () =>
      buildTodayViewModel({
        medications: state.medications,
        logs: state.logs,
        todayKey: state.todayKey,
        selectedDateKey: state.selectedDateKey,
        nowTime,
      }),
    [state.medications, state.logs, state.todayKey, state.selectedDateKey, nowTime],
  );

  return { store, state, viewModel };
}

/** Doses still pending today, for the Today tab badge (undefined until loaded). */
export function useTodayPendingCount(): number | undefined {
  const store = getTodayStore();
  const state = useSyncExternalStore(store.subscribe, store.getState);

  useEffect(() => {
    void store.ensureLoaded();
  }, [store]);

  return useMemo(
    () => (state.status === "ready" ? countPendingDoses(state.medications, state.logs, state.todayKey) : undefined),
    [state.status, state.medications, state.logs, state.todayKey],
  );
}
