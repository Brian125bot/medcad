/**
 * Google Calendar event body for one refill date. Generic by default; the
 * names setting adds the medication name and nothing else. Times are built
 * from the civil date key by string concatenation (no `Date`).
 */
import type { Medication } from '../domain/medication-data';
import { isValidDateKey } from '../schedule/date-keys';

export const GENERIC_EVENT_SUMMARY = 'Medication refill';
export const GENERIC_EVENT_DESCRIPTION = 'Refill due. Open CadenceRx to check your supply.';
export const EVENT_START_TIME = '09:00:00';
export const EVENT_END_TIME = '09:15:00';

export interface CalendarEventBody {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  reminders: { useDefault: false; overrides: { method: 'popup'; minutes: number }[] };
  transparency: 'transparent';
  extendedProperties: { private: { cadencerx: '1'; med: string } };
}

export function buildEventContent(input: {
  medication: Pick<Medication, 'id' | 'name'>;
  fillDateKey: string;
  showNames: boolean;
  timeZone: string;
}): CalendarEventBody {
  const { medication, fillDateKey, showNames, timeZone } = input;
  if (!isValidDateKey(fillDateKey)) throw new RangeError('Invalid fill date key');
  const name = showNames ? medication.name.trim() : '';
  return {
    summary: name ? `Refill: ${name}` : GENERIC_EVENT_SUMMARY,
    description: name ? `Refill due for ${name}. Open CadenceRx to check your supply.` : GENERIC_EVENT_DESCRIPTION,
    start: { dateTime: `${fillDateKey}T${EVENT_START_TIME}`, timeZone },
    end: { dateTime: `${fillDateKey}T${EVENT_END_TIME}`, timeZone },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
    transparency: 'transparent',
    extendedProperties: { private: { cadencerx: '1', med: medication.id } },
  };
}
