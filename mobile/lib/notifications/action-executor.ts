/**
 * COR-77: runs repository / scheduler work for a lock-screen action (no Expo).
 */
import { buildDoseKey } from '../schedule/doses';
import { plannedDosesFromPayload } from './action-planned-doses';
import { errorClassName, planNotificationAction } from './actions';
import { computeTodayPendingBadgeCount } from './badge-count';
import { buildReminderContent } from './content';
import {
  dateKeyRange,
  filterActionableDoseRefs,
  filterSnoozeCandidates,
} from './pending-doses';
import { MalformedNotificationPayloadError } from './payload';
import type { ClockPort, NotificationSchedulerPort, ReminderRepositoryPort } from './ports';
import { readReminderSettings } from './settings';
import { buildSnoozeNotificationId, snoozeFireInstant } from './snooze';
import type { CivilInstant } from './types';
import { DOSE_NAMESPACE, DOSE_REMINDER_CATEGORY } from './types';

export type ActionExecutionOutcome = 'malformed' | 'failed' | 'completed';

export interface ActionLogRepositoryPort extends ReminderRepositoryPort {
  logDose(
    dateKey: string,
    medicationId: string,
    slotId: string,
    status: 'taken' | 'skipped',
  ): Promise<unknown>;
  setPreference<T>(prefKey: string, value: T): Promise<void>;
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

async function refreshBadgeSafe(deps: ActionExecutorDeps): Promise<void> {
  try {
    const todayKey = deps.clock.now().todayKey;
    const [medications, entries] = await Promise.all([
      deps.repository.getAllMedications(),
      deps.repository.getDoseLogsInRange(todayKey, todayKey),
    ]);
    const logs = Object.fromEntries(entries.map((entry) => [entry.key, entry]));
    const count = computeTodayPendingBadgeCount(medications, logs, todayKey);
    await deps.scheduler.setBadgeCount(count);
  } catch (error) {
    deps.log?.('[reminders] badge refresh failed', errorClassName(error));
  }
}

async function clearRespondedNotification(deps: ActionExecutorDeps, notificationId: string): Promise<void> {
  try {
    await deps.scheduler.cancel(notificationId);
  } catch (error) {
    deps.log?.('[reminders] cancel after action failed', errorClassName(error));
  }
  try {
    await deps.scheduler.dismiss(notificationId);
  } catch (error) {
    deps.log?.('[reminders] dismiss after action failed', errorClassName(error));
  }
}

export async function executeNotificationAction(
  deps: ActionExecutorDeps,
  actionIdentifier: string,
  data: unknown,
  notificationId: string,
  options: { exact: boolean },
): Promise<ActionExecutionOutcome> {
  let plan;
  try {
    plan = planNotificationAction(actionIdentifier, data);
  } catch (error) {
    if (error instanceof MalformedNotificationPayloadError) {
      deps.log?.('[reminders] action payload rejected', errorClassName(error));
    } else {
      deps.log?.('[reminders] action payload rejected', errorClassName(error));
    }
    return 'malformed';
  }
  if (!plan) return 'completed';

  const range = dateKeyRange(plan.doses);
  if (!range) return 'completed';

  const [medications, entries, scheduled] = await Promise.all([
    deps.repository.getAllMedications(),
    deps.repository.getDoseLogsInRange(range.min, range.max),
    deps.scheduler.listScheduled(),
  ]);
  const logs = Object.fromEntries(entries.map((entry) => [entry.key, entry]));
  const nowMs = deps.clock.toEpochMs(deps.clock.now().todayKey, deps.clock.now().minuteOfDay);

  if (plan.type === 'log') {
    const targets = filterActionableDoseRefs(plan.doses, logs, medications);
    if (targets.length === 0) {
      await clearRespondedNotification(deps, notificationId);
      await refreshBadgeSafe(deps);
      return 'completed';
    }
    for (const dose of targets) {
      try {
        await deps.repository.logDose(dose.dateKey, dose.medicationId, dose.slotId, plan.status);
      } catch (error) {
        deps.log?.('[reminders] action log failed', errorClassName(error));
        return 'failed';
      }
    }
    await clearRespondedNotification(deps, notificationId);
    await refreshBadgeSafe(deps);
    return 'completed';
  }

  const snoozeTargets = filterSnoozeCandidates(plan.doses, scheduled, nowMs, logs, medications);
  if (snoozeTargets.length === 0) {
    await clearRespondedNotification(deps, notificationId);
    await refreshBadgeSafe(deps);
    return 'completed';
  }

  const fireAt = snoozeFireInstant(nowInstant(deps.clock), plan.delayMinutes);
  const fireAtMs = deps.clock.toEpochMs(fireAt.dateKey, fireAt.minuteOfDay);
  const reserved = new Set(scheduled.map((entry) => entry.id));
  const snoozeId = buildSnoozeNotificationId(fireAt, reserved);
  const settings = await readReminderSettings(deps.repository);
  const { planned, profile } = plannedDosesFromPayload(medications, snoozeTargets);
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
  await clearRespondedNotification(deps, notificationId);
  for (const dose of snoozeTargets) {
    const doseKey = buildDoseKey(dose.dateKey, dose.medicationId, dose.slotId);
    for (const entry of scheduled) {
      if (!entry.doseKeys?.includes(doseKey)) continue;
      if (entry.id.startsWith(DOSE_NAMESPACE)) await deps.scheduler.cancel(entry.id);
    }
  }
  await refreshBadgeSafe(deps);
  return 'completed';
}
