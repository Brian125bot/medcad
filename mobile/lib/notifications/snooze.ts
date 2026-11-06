/**
 * COR-77: snooze notification ids and fire instants (pure).
 */
import { buildDoseKey } from '../schedule/doses';
import { civilInstantKey, shiftCivil } from './fire-time';
import type { CivilInstant } from './types';
import { SNOOZE_DELAY_MINUTES, SNOOZE_NAMESPACE } from './types';
import type { DosePayloadRef } from './payload';

export function snoozeFireInstant(from: CivilInstant, delayMinutes = SNOOZE_DELAY_MINUTES): CivilInstant {
  return shiftCivil(from, delayMinutes);
}

/** `cx.snooze.<fireDateKey>.<HHmm>` with numeric suffixes when a slot is already taken. */
export function buildSnoozeNotificationId(fireAt: CivilInstant, reserved: ReadonlySet<string>): string {
  const base = `${SNOOZE_NAMESPACE}${civilInstantKey(fireAt)}`;
  if (!reserved.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix++) {
    const candidate = `${base}.${suffix}`;
    if (!reserved.has(candidate)) return candidate;
  }
  return `${base}.${Date.now()}`;
}

export function doseKeysFromPayload(doses: DosePayloadRef[]): string[] {
  return doses.map((d) => buildDoseKey(d.dateKey, d.medicationId, d.slotId));
}

export function collectSnoozedDoseKeys(
  scheduled: ReadonlyArray<{ id: string; fireAtMs: number | null; doses?: DosePayloadRef[] }>,
  nowMs: number,
): Set<string> {
  const keys = new Set<string>();
  for (const entry of scheduled) {
    if (!entry.id.startsWith(SNOOZE_NAMESPACE) || !entry.doses?.length) continue;
    if (entry.fireAtMs !== null && entry.fireAtMs <= nowMs) continue;
    for (const key of doseKeysFromPayload(entry.doses)) keys.add(key);
  }
  return keys;
}
