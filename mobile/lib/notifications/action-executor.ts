/**
 * COR-77: runs repository / scheduler work for a lock-screen action (no Expo).
 */
import { DEFAULT_MEDICATION_ALERT, type Medication } from '../domain/medication-data';
import { mergeProfiles } from './planner';
import { buildDoseKey } from '../schedule/doses';
import { errorClassName, planNotificationAction } from './actions';
import { computeTodayPendingBadgeCount } from './badge-count';
import { buildReminderContent } from './content';
import { parseSlotTime } from './fire-time';
import { MalformedNotificationPayloadError } from './payload';
import type { ClockPort, NotificationSchedulerPort, ReminderRepositoryPort } from './ports';
import { readReminderSettings } from './settings';
import { buildSnoozeNotificationId, snoozeFireInstant } from './snooze';
import type { CivilInstant, PlannedDose } from './types';
import { DOSE_NAMESPACE, DOSE_REMINDER_CATEGORY } from './types';

export interface ActionLogRepositoryPort extends ReminderRepositoryPort {
  logDose(
    dateKey: string,
    medicationId: string,
    slotId: string,
    status: 'taken' | 'skipped',
  ): Promise<unknown>;
}

export interface ActionExecutorDeps {
  repository: ActionLogRepositoryPort;
  scheduler: NotificationSchedulerPort;
  clock: ClockPort;
  log?: (message: string, error: unknown) => void;
}

function nowInstant(clock: ClockPort): CivilInstant {
  const now = clock.now();
  return { dateKey: now.todayKey, minuteOfDay: now.minuteOfDay };
}

async function refreshBadge(deps: ActionExecutorDeps): Promise<void> {
  const todayKey = deps.clock.now().todayKey;
  const [medications, entries] = await Promise.all([
    deps.repository.getAllMedications(),
    deps.repository.getDoseLogsInRange(todayKey, todayKey),
  ]);
  const logs = Object.fromEntries(entries.map((entry) => [entry.key, entry]));
  const count = computeTodayPendingBadgeCount(medications, logs, todayKey);
  await deps.scheduler.setBadgeCount(count);
}

function plannedDosesFromPayload(
  medications: Medication[],
  doses: { dateKey: string; medicationId: string; slotId: string }[],
): { planned: PlannedDose[]; profile: { sound: boolean; vibrate: boolean } } {
  const medById = new Map(medications.map((m) => [m.id, m]));
  const planned: PlannedDose[] = [];
  let profile = { ...DEFAULT_MEDICATION_ALERT };
  for (const dose of doses) {
    const medication = medById.get(dose.medicationId);
    const slot = medication?.timeSlots.find((s) => s.id === dose.slotId);
    const doseMinuteOfDay = slot ? parseSlotTime(slot.time) : 0;
    planned.push({
      dateKey: dose.dateKey,
      medicationId: dose.medicationId,
      slotId: dose.slotId,
      medicationName: medication?.name ?? '',
      doseMinuteOfDay,
    });
    if (medication?.alert) profile = mergeProfiles(profile, medication.alert);
  }
  return { planned, profile };
}

export async function executeNotificationAction(
  deps: ActionExecutorDeps,
  actionIdentifier: string,
  data: unknown,
  notificationId: string,
  options: { exact: boolean },
): Promise<void> {
  let plan;
  try {
    plan = planNotificationAction(actionIdentifier, data);
  } catch (error) {
    deps.log?.('[reminders] action payload rejected', errorClassName(error));
    return;
  }
  if (!plan) return;

  if (plan.type === 'log') {
    for (const dose of plan.doses) {
      try {
        await deps.repository.logDose(dose.dateKey, dose.medicationId, dose.slotId, plan.status);
      } catch (error) {
        deps.log?.('[reminders] action log failed', errorClassName(error));
      }
    }
    try {
      await deps.scheduler.cancel(notificationId);
    } catch (error) {
      deps.log?.('[reminders] cancel after action failed', errorClassName(error));
    }
    await refreshBadge(deps);
    return;
  }

  const fireAt = snoozeFireInstant(nowInstant(deps.clock), plan.delayMinutes);
  const fireAtMs = deps.clock.toEpochMs(fireAt.dateKey, fireAt.minuteOfDay);
  const scheduled = await deps.scheduler.listScheduled();
  const reserved = new Set(scheduled.map((entry) => entry.id));
  const snoozeId = buildSnoozeNotificationId(fireAt, reserved);
  const [medications, settings] = await Promise.all([
    deps.repository.getAllMedications(),
    readReminderSettings(deps.repository),
  ]);
  const { planned, profile } = plannedDosesFromPayload(medications, plan.doses);
  const content = buildReminderContent(
    { id: snoozeId, kind: 'dose-group', fireAt, doses: planned, profile },
    settings,
    deps.clock.formatTime,
  );
  await deps.scheduler.schedule({
    id: snoozeId,
    fireAtMs,
    content: { ...content, categoryIdentifier: DOSE_REMINDER_CATEGORY },
    exact: options.exact,
  });
  try {
    await deps.scheduler.cancel(notificationId);
  } catch (error) {
    deps.log?.('[reminders] cancel before snooze failed', errorClassName(error));
  }
  for (const dose of plan.doses) {
    const doseKey = buildDoseKey(dose.dateKey, dose.medicationId, dose.slotId);
    for (const entry of scheduled) {
      if (!entry.doseKeys?.includes(doseKey)) continue;
      if (entry.id.startsWith(DOSE_NAMESPACE)) await deps.scheduler.cancel(entry.id);
    }
  }
  await refreshBadge(deps);
}
