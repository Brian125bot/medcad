import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { msUntilNextLocalMidnight } from "@/lib/navigation/header";

/**
 * The current date for display only. Refreshes at local midnight and when the
 * app returns to the foreground. Never use it to decide schedule behaviour.
 */
export function useCurrentDate(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setTimeout(() => setNow(new Date()), msUntilNextLocalMidnight(now) + 1000);
    return () => clearTimeout(timer);
  }, [now]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") setNow(new Date());
    });
    return () => sub.remove();
  }, []);

  return now;
}
