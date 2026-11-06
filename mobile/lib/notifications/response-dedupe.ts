/**
 * COR-77: dedupe lock-screen action deliveries (task, listener, cold start).
 */
export const PREF_HANDLED_ACTION_RESPONSES = 'notifications.handledActionResponses';
export const HANDLED_RESPONSES_MAX = 64;
export const HANDLED_RESPONSES_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface HandledResponse {
  key: string;
  at: number;
}

export function responseKey(input: {
  notificationId: string;
  actionIdentifier: string;
  deliveredAtMs: number;
}): string {
  return `${input.notificationId}|${input.actionIdentifier}|${input.deliveredAtMs}`;
}

export function hasHandled(store: readonly HandledResponse[], key: string): boolean {
  return store.some((entry) => entry.key === key);
}

export function recordHandled(store: readonly HandledResponse[], key: string, nowMs: number): HandledResponse[] {
  const cutoff = nowMs - HANDLED_RESPONSES_TTL_MS;
  const kept = store.filter((entry) => entry.at >= cutoff && entry.key !== key);
  return [{ key, at: nowMs }, ...kept].slice(0, HANDLED_RESPONSES_MAX);
}

export function parseHandledStore(raw: unknown): HandledResponse[] {
  if (!Array.isArray(raw)) return [];
  const parsed: HandledResponse[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.key !== 'string' || typeof record.at !== 'number' || !Number.isFinite(record.at)) continue;
    parsed.push({ key: record.key, at: record.at });
  }
  return parsed;
}

/** expo-notifications `Notification.date` is epoch ms on Android; seconds on some iOS paths. */
export function normalizeDeliveredAtMs(date: number): number {
  return date < 1e12 ? date * 1000 : date;
}
