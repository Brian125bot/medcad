import { useSyncExternalStore } from "react";

import { getReminderStatus, subscribeReminderStatus, type ReminderStatus } from "@/lib/notifications";

/** COR-76: live reminder engine status for screens. */
export function useReminderStatus(): ReminderStatus {
  return useSyncExternalStore(subscribeReminderStatus, getReminderStatus, getReminderStatus);
}
