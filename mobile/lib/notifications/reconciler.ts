/**
 * COR-76 reconciler: diffs the planned `cx.dose.*` notifications against
 * what the OS holds and cancels/schedules the difference.
 *
 * Single-flight: a trigger during a run marks the engine dirty and causes
 * exactly one follow-up run. Never touches identifiers outside
 * `cx.dose.`, never throws to callers.
 */
import type { RepositoryChange } from '../storage/context';
import { computeTodayPendingBadgeCount } from './badge-count';
import { buildReminderContent, hashReminderContent } from './content';
import { planNotifications, planningDateRange } from './planner';
import { PREF_EXACT_ALARM_PROMPTED } from './exact-alarm';
import { dateKeyFromDoseKey } from './pending-doses';
import { PREF_HANDLED_ACTION_RESPONSES } from './response-dedupe';
import { collectSnoozedDoseKeys } from './snooze';
import { staleSnoozeIds } from './stale-snoozes';
import type {
  ClockPort,
  NotificationPermission,
  NotificationPermissionPort,
  NotificationSchedulerPort,
  ReminderRepositoryPort,
  ReminderScheduleRequest,
} from './ports';
import { readReminderSettings } from './settings';
import { DOSE_NAMESPACE, SNOOZE_NAMESPACE, type ReminderStatus } from './types';

export interface ReminderEngineDeps {
  repository: ReminderRepositoryPort;
  scheduler: NotificationSchedulerPort;
  permissions: NotificationPermissionPort;
  clock: ClockPort;
  log?: (message: string, error: unknown) => void;
}

export const INITIAL_REMINDER_STATUS: ReminderStatus = {
  state: 'ok',
  lastReconciledAt: null,
  scheduledCount: 0,
  truncated: false,
};

export class ReminderEngine {
  private status: ReminderStatus = INITIAL_REMINDER_STATUS;
  private readonly statusListeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private dirty = false;
  private vaultWipePending = false;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: ReminderEngineDeps) {}

  getStatus(): ReminderStatus {
    return this.status;
  }

  subscribeStatus(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /** Subscribes to repository changes and runs a first reconcile. Idempotent. */
  start(): Promise<void> {
    if (!this.unsubscribe) {
      this.unsubscribe = this.deps.repository.subscribe((change) => {
        void this.handleChange(change);
      });
    }
    return this.reconcile();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  handleChange(change: RepositoryChange): Promise<void> {
    if (change.type === 'preference-changed') {
      if (
        change.prefKey === PREF_HANDLED_ACTION_RESPONSES ||
        change.prefKey === PREF_EXACT_ALARM_PROMPTED
      ) {
        return Promise.resolve();
      }
    }
    if (change.type === 'vault-deleted') this.vaultWipePending = true;
    return this.reconcile();
  }

  /** Asks for notification permission if never asked, then reconciles. */
  async ensurePermission(): Promise<NotificationPermission> {
    let status = await this.deps.permissions.getStatus();
    if (status === 'undetermined') status = await this.deps.permissions.request();
    await this.reconcile();
    return status;
  }

  reconcile(): Promise<void> {
    if (this.running) {
      this.dirty = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.dirty = false;
          await this.runOnce();
        } while (this.dirty);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private setStatus(next: ReminderStatus): void {
    this.status = next;
    for (const listener of [...this.statusListeners]) listener();
  }

  private async cancelDoseNamespace(): Promise<void> {
    const { scheduler } = this.deps;
    for (const entry of await scheduler.listScheduled()) {
      if (entry.id.startsWith(DOSE_NAMESPACE)) await scheduler.cancel(entry.id);
    }
  }

  private async cancelDoseAndSnoozeNamespaces(): Promise<void> {
    const { scheduler } = this.deps;
    for (const entry of await scheduler.listScheduled()) {
      if (entry.id.startsWith(DOSE_NAMESPACE) || entry.id.startsWith(SNOOZE_NAMESPACE)) {
        await scheduler.cancel(entry.id);
      }
    }
  }

  private async runOnce(): Promise<void> {
    const { repository, scheduler, permissions, clock } = this.deps;
    try {
      if (this.vaultWipePending) {
        // The vault is gone: do not read it, just drop every dose reminder.
        this.vaultWipePending = false;
        await this.cancelDoseAndSnoozeNamespaces();
        await scheduler.setBadgeCount(0);
        this.setStatus({ ...INITIAL_REMINDER_STATUS, lastReconciledAt: clock.nowIso() });
        return;
      }

      if ((await permissions.getStatus()) !== 'granted') {
        const now = clock.now();
        const [medications, todayEntries] = await Promise.all([
          repository.getAllMedications(),
          repository.getDoseLogsInRange(now.todayKey, now.todayKey),
        ]);
        const todayLogs = Object.fromEntries(todayEntries.map((entry) => [entry.key, entry]));
        // Grant → schedule → revoke must not leave OS entries while the UI
        // reports zero scheduled (COR-98). Snoozes are a different namespace.
        await this.cancelDoseNamespace();
        await scheduler.setBadgeCount(computeTodayPendingBadgeCount(medications, todayLogs, now.todayKey));
        this.setStatus({ state: 'permission-denied', lastReconciledAt: clock.nowIso(), scheduledCount: 0, truncated: false });
        return;
      }

      // Android fixes exact vs inexact when an alarm is set, so each entry records
      // the access it was set with; 'unknown' (no native module) counts as exact.
      const exactStatus = await permissions.getExactAlarmStatus();
      const exact = exactStatus !== 'denied';

      await scheduler.ensureChannels();
      await scheduler.ensureActionCategories();
      const now = clock.now();
      const nowMs = clock.toEpochMs(now.todayKey, now.minuteOfDay);
      const scheduledBefore = await scheduler.listScheduled();
      const { startKey, endKey } = planningDateRange(now.todayKey);
      let logStartKey = startKey;
      for (const entry of scheduledBefore) {
        for (const doseKey of entry.doseKeys ?? []) {
          const dateKey = dateKeyFromDoseKey(doseKey);
          if (dateKey && dateKey < logStartKey) logStartKey = dateKey;
        }
      }
      const medications = await repository.getAllMedications();
      const activeMedicationIds = new Set(medications.filter((med) => med.active).map((med) => med.id));
      const logEntries = await repository.getDoseLogsInRange(logStartKey, endKey);
      const logs = Object.fromEntries(logEntries.map((entry) => [entry.key, entry]));
      const staleSnoozes = staleSnoozeIds(scheduledBefore, logs, activeMedicationIds);
      for (const snoozeId of staleSnoozes) await scheduler.cancel(snoozeId);
      const scheduledActive = scheduledBefore.filter((entry) => !staleSnoozes.includes(entry.id));
      const snoozedDoseKeys = collectSnoozedDoseKeys(scheduledActive, nowMs);
      const settings = await readReminderSettings(repository);
      const plan = planNotifications({ medications, logs, settings, now, snoozedDoseKeys });

      const desired = new Map<string, ReminderScheduleRequest & { hash: string }>();
      for (const notification of plan.notifications) {
        const content = buildReminderContent(notification, settings, clock.formatTime);
        desired.set(notification.id, {
          id: notification.id,
          fireAtMs: clock.toEpochMs(notification.fireAt.dateKey, notification.fireAt.minuteOfDay),
          content,
          exact,
          hash: hashReminderContent(content),
        });
      }

      const unchanged = new Set<string>();
      for (const entry of await scheduler.listScheduled()) {
        if (!entry.id.startsWith(DOSE_NAMESPACE)) continue;
        const want = desired.get(entry.id);
        if (want && want.fireAtMs === entry.fireAtMs && want.hash === entry.contentHash && want.exact === entry.exact) {
          unchanged.add(entry.id);
        }
        else await scheduler.cancel(entry.id);
      }
      for (const { hash: _hash, ...request } of desired.values()) {
        if (!unchanged.has(request.id)) await scheduler.schedule(request);
      }

      const todayEntries = await repository.getDoseLogsInRange(now.todayKey, now.todayKey);
      const todayLogs = Object.fromEntries(todayEntries.map((entry) => [entry.key, entry]));
      const badgeCount = computeTodayPendingBadgeCount(medications, todayLogs, now.todayKey);
      await scheduler.setBadgeCount(badgeCount);

      this.setStatus({
        state: exactStatus === 'denied' ? 'exact-alarm-denied' : 'ok',
        lastReconciledAt: clock.nowIso(),
        scheduledCount: desired.size,
        truncated: plan.truncated,
      });
    } catch (error) {
      this.deps.log?.('[reminders] reconcile failed', error);
      this.setStatus({ ...this.status, state: 'error', lastReconciledAt: clock.nowIso() });
    }
  }
}
