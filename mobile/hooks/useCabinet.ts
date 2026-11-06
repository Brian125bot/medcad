import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { useEffect } from "react";

import { msUntilNextLocalMidnight } from "@/lib/navigation/header";
import { getStorageContext } from "@/lib/storage";
import { buildCabinetViewModel } from "@/lib/cabinet/cabinet-view-model";
import { CabinetStore, type CabinetRepository } from "@/lib/cabinet/cabinet-store";

const repository: CabinetRepository = {
  getAllMedications: async () => (await getStorageContext()).repository.getAllMedications(),
  refillMedication: async (...args) => (await getStorageContext()).repository.refillMedication(...args),
  subscribe: (listener) => {
    let unsub: (() => void) | null = null;
    void getStorageContext().then(({ repository: repo }) => {
      unsub = repo.subscribe(listener);
    });
    return () => unsub?.();
  },
};

let sharedStore: CabinetStore | null = null;

/** One Cabinet store per app, shared by the screen and any badge. */
export function getCabinetStore(): CabinetStore {
  sharedStore ??= new CabinetStore(repository);
  return sharedStore;
}

/**
 * Cabinet screen state: medications plus the pure view model. Reloads on focus,
 * at local midnight and when the app returns to the foreground.
 */
export function useCabinet() {
  const store = getCabinetStore();
  const state = useSyncExternalStore(store.subscribe, store.getState);

  useFocusEffect(
    useCallback(() => {
      store.syncClock();
      void store.load();
    }, [store]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      store.syncClock();
      void store.load();
    });
    return () => sub.remove();
  }, [store]);

  useEffect(() => {
    const timer = setTimeout(() => store.syncClock(), msUntilNextLocalMidnight(new Date()) + 1000);
    return () => clearTimeout(timer);
  }, [state.todayKey, store]);

  const viewModel = useMemo(
    () => buildCabinetViewModel({ medications: state.medications, todayKey: state.todayKey }),
    [state.medications, state.todayKey],
  );

  return { store, state, viewModel };
}
