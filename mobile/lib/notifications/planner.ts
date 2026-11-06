/**
 * COR-76 notification planner: (medications, logs, settings, now) -> plan.
 *
 * Pure and deterministic. Uses the schedule public API for "is this dose
 * due on this day"; it never re-implements frequency rules.
 */
import {
  DEFAULT_MEDICATION_ALERT,
  getEffectiveLeadMinutes,
  type DoseLogMap,
  type Medication,
} from '../domain/medication-data';
import { addDaysToKey, diffDaysBetweenKeys } from '../schedule/date-keys';
import { getScheduledDosesForDate } from '../schedule/doses';
import {
  civilInstantKey,
  compareCivil,
  computeFireInstant,
  parseSlotTime,
  shiftCivil,
} from './fire-time';
import {
  DOSE_NAMESPACE,
  MAX_PENDING_NOTIFICATIONS,
  PLANNING_HORIZON_DAYS,
  SENTINEL_DELAY_MINUTES,
  SENTINEL_ID,
  SENTINEL_WINDOW_END_MINUTE,
  type AlertProfile,
  type CivilInstant,
  type CivilNow,
  type NotificationPlan,
  type PlannedDose,
  type PlannedNotification,
  type ReminderSettings,
} from './types';

export interface PlanInput {
  medications: Medication[];
  logs: DoseLogMap;
  settings: ReminderSettings;
  now: CivilNow;
  horizonDays?: number;
  budget?: number;
}

/** Inclusive dose-date range the planner reads logs for. */
export function planningDateRange(todayKey: string, horizonDays = PLANNING_HORIZON_DAYS) {
  return { startKey: todayKey, endKey: addDaysToKey(todayKey, horizonDays) };
}

export function mergeProfiles(a: AlertProfile, b: AlertProfile): AlertProfile {
  return { sound: a.sound || b.sound, vibrate: a.vibrate || b.vibrate };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareDoses(a: PlannedDose, b: PlannedDose): number {
  return (
    compareText(a.dateKey, b.dateKey) ||
    a.doseMinuteOfDay - b.doseMinuteOfDay ||
    compareText(a.medicationId, b.medicationId) ||
    compareText(a.slotId, b.slotId)
  );
}

export function planNotifications(input: PlanInput): NotificationPlan {
  const horizonDays = input.horizonDays ?? PLANNING_HORIZON_DAYS;
  const budget = Math.max(1, input.budget ?? MAX_PENDING_NOTIFICATIONS);
  const { todayKey } = input.now;
  const nowInstant: CivilInstant = { dateKey: todayKey, minuteOfDay: input.now.minuteOfDay };
  const active = input.medications.filter((m) => m.active);

  const groups = new Map<string, PlannedNotification>();

  // Dose dates run one day past the horizon: a lead time can pull a dose's
  // fire instant back onto the last day inside it.
  for (let offset = 0; offset <= horizonDays; offset++) {
    const dateKey = addDaysToKey(todayKey, offset);
    for (const dose of getScheduledDosesForDate(active, input.logs, dateKey, todayKey)) {
      if (dose.slot.reminderEnabled === false || dose.log) continue;
      const doseMinuteOfDay = parseSlotTime(dose.slot.time);
      const lead = getEffectiveLeadMinutes(dose.slot.leadMinutes, input.settings.defaultLeadMinutes);
      const fireAt = computeFireInstant(dateKey, doseMinuteOfDay, lead);
      if (compareCivil(fireAt, nowInstant) <= 0) continue;
      if (diffDaysBetweenKeys(todayKey, fireAt.dateKey) >= horizonDays) continue;

      const id = `${DOSE_NAMESPACE}${civilInstantKey(fireAt)}`;
      const profile = dose.medication.alert ?? DEFAULT_MEDICATION_ALERT;
      const planned: PlannedDose = {
        dateKey,
        medicationId: dose.medication.id,
        slotId: dose.slot.id,
        medicationName: dose.medication.name,
        doseMinuteOfDay,
      };
      const existing = groups.get(id);
      if (existing) {
        existing.doses.push(planned);
        existing.profile = mergeProfiles(existing.profile, profile);
      } else {
        groups.set(id, { id, kind: 'dose-group', fireAt, doses: [planned], profile: { ...profile } });
      }
    }
  }

  const ordered = [...groups.values()].sort((a, b) => compareCivil(a.fireAt, b.fireAt));
  for (const group of ordered) group.doses.sort(compareDoses);

  // Any reminder-enabled slot gets a sentinel, even if nothing falls inside the
  // window, so reminders never stop silently when the app isn't opened.
  const hasReminders = active.some((m) => m.timeSlots.some((slot) => slot.reminderEnabled !== false));
  if (!hasReminders) return { notifications: [], truncated: false };

  const truncated = ordered.length > budget - 1;
  const kept = ordered.slice(0, budget - 1);
  let fireAt: CivilInstant;
  if (truncated) {
    const anchor = kept.length > 0 ? kept[kept.length - 1].fireAt : nowInstant;
    fireAt = shiftCivil(anchor, SENTINEL_DELAY_MINUTES);
  } else {
    const windowEnd: CivilInstant = { dateKey: addDaysToKey(todayKey, horizonDays - 1), minuteOfDay: SENTINEL_WINDOW_END_MINUTE };
    const earliest = shiftCivil(nowInstant, SENTINEL_DELAY_MINUTES);
    fireAt = compareCivil(windowEnd, earliest) < 0 ? earliest : windowEnd;
  }
  const sentinel: PlannedNotification = {
    id: SENTINEL_ID,
    kind: 'sentinel',
    fireAt,
    doses: [],
    profile: { ...DEFAULT_MEDICATION_ALERT },
  };
  // Stable sort keeps the sentinel after a dose group sharing its instant.
  const notifications = [...kept, sentinel].sort((a, b) => compareCivil(a.fireAt, b.fireAt));
  return { notifications, truncated };
}
