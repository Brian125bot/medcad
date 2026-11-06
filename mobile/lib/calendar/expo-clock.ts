/** Device clock for calendar sync: civil today key and the device IANA zone. */
import { toDateKey } from '../schedule/date-keys';
import type { CalendarClockPort } from './ports';

export const expoCalendarClock: CalendarClockPort = {
  todayKey: () => toDateKey(new Date()),
  timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  nowIso: () => new Date().toISOString(),
};
