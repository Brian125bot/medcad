/**
 * COR-76 device clock adapter. The only caller of `civilToLocalDate`.
 */
import { toDateKey } from '../schedule/date-keys';
import { civilToLocalDate } from './fire-time';
import type { ClockPort } from './ports';

export const expoClock: ClockPort = {
  now() {
    const now = new Date();
    return { todayKey: toDateKey(now), minuteOfDay: now.getHours() * 60 + now.getMinutes() };
  },
  toEpochMs: (dateKey, minuteOfDay) => civilToLocalDate(dateKey, minuteOfDay).getTime(),
  formatTime: (dateKey, minuteOfDay) =>
    civilToLocalDate(dateKey, minuteOfDay).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  nowIso: () => new Date().toISOString(),
};
