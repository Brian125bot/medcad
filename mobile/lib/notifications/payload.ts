/**
 * COR-77: parse opaque notification `data` payloads (no Expo imports).
 */
import type { NotificationData } from './content';

export class MalformedNotificationPayloadError extends Error {
  constructor(message = 'Malformed notification payload') {
    super(message);
    this.name = 'MalformedNotificationPayloadError';
  }
}

export interface DosePayloadRef {
  dateKey: string;
  medicationId: string;
  slotId: string;
}

export function parseDoseGroupPayload(data: unknown): DosePayloadRef[] {
  if (!data || typeof data !== 'object') throw new MalformedNotificationPayloadError();
  const record = data as Record<string, unknown>;
  if (record.v !== 1 || record.kind !== 'dose-group') throw new MalformedNotificationPayloadError();
  if (!Array.isArray(record.doses) || record.doses.length === 0) throw new MalformedNotificationPayloadError();
  return record.doses.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new MalformedNotificationPayloadError();
    const dose = entry as Record<string, unknown>;
    if (typeof dose.d !== 'string' || typeof dose.m !== 'string' || typeof dose.s !== 'string') {
      throw new MalformedNotificationPayloadError();
    }
    return { dateKey: dose.d, medicationId: dose.m, slotId: dose.s };
  });
}

export function isActionableNotificationData(data: unknown): data is Extract<NotificationData, { kind: 'dose-group' }> {
  try {
    parseDoseGroupPayload(data);
    return true;
  } catch {
    return false;
  }
}
