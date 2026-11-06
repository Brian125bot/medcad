/**
 * COR-76 schedule metadata carried inside a scheduled reminder's `data`, so
 * the reconciler can compare what the OS holds with what it wants after a cold
 * start (iOS reports DATE triggers back as relative intervals). Non-PHI only:
 * an epoch, a 32-bit content hash and whether the alarm was set as exact.
 */
import type { NotificationData } from './content';

export const SCHEDULE_META_KEY = 'sched';

export interface ScheduleMeta {
  /** Fire instant in epoch ms at schedule time. */
  at: number;
  /** `hashReminderContent` of the content without this metadata. */
  hash: string;
  /** Whether exact-alarm access was available when it was scheduled. */
  exact: boolean;
}

export type ScheduledData = NotificationData & { [SCHEDULE_META_KEY]: ScheduleMeta };

export function withScheduleMeta(data: NotificationData, meta: ScheduleMeta): ScheduledData {
  return { ...data, [SCHEDULE_META_KEY]: { at: meta.at, hash: meta.hash, exact: meta.exact } };
}

export function readScheduleMeta(data: unknown): ScheduleMeta | null {
  if (typeof data !== 'object' || data === null) return null;
  const meta = (data as Record<string, unknown>)[SCHEDULE_META_KEY];
  if (typeof meta !== 'object' || meta === null) return null;
  const { at, hash, exact } = meta as Record<string, unknown>;
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  if (typeof hash !== 'string' || typeof exact !== 'boolean') return null;
  return { at, hash, exact };
}

export function stripScheduleMeta<T extends object>(data: T): Omit<T, typeof SCHEDULE_META_KEY> {
  const { [SCHEDULE_META_KEY]: _meta, ...rest } = data as T & { [SCHEDULE_META_KEY]?: unknown };
  return rest;
}
