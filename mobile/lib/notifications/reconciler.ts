/**
 * COR-76 reconciler: diffs the planned `cx.dose.*` notifications against
 * what the OS holds and cancels/schedules the difference.
 *
 * Single-flight: a trigger during a run marks the engine dirty and causes
 * exactly one follow-up run. Never touches identifiers outside
 * `cx.dose.`, never throws to callers.
 */
import type { RepositoryChange } from '../storage/context';
import { buildReminderContent, hashReminderContent } from './content';
import { planNotifications, planningDateRange } from './planner';
import type {
  ClockPort,
  NotificationPermission,
  NotificationPermissionPort,
  NotificationSchedulerPort,
  ReminderRepositoryPort,
  ReminderScheduleRequest,
} from './ports';
import { readReminderSettings } from './settings';
import { DOSE_NAMESPACE, type ReminderStatus } from './types';

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

  private async runOnce(): Promise<void> {
    const { repository, scheduler, permissions, clock } = this.deps;
    try {
      if (this.vaultWipePending) {
        // The vault is gone: do not read it, just drop every dose reminder.
        this.vaultWipePending = false;
        await this.cancelDoseNamespace();
        this.setStatus({ ...INITIAL_REMINDER_STATUS, lastReconciledAt: clock.nowIso() });
        return;
      }

      if ((await permissions.getStatus()) !== 'granted') {
        this.setStatus({ state: 'permission-denied', lastReconciledAt: clock.nowIso(), scheduledCount: 0, truncated: false });
        return;
      }

      await scheduler.ensureChannels();
      const now = clock.now();
      const { startKey, endKey } = planningDateRange(now.todayKey);
      const [medications, settings, entries] = await Promise.all([
        repository.getAllMedications(),
        readReminderSettings(repository),
        repository.getDoseLogsInRange(startKey, endKey),
      ]);
      const logs = Object.fromEntries(entries.map((entry) => [entry.key, entry]));
      const plan = planNotifications({ medications, logs, settings, now });

      const desired = new Map<string, ReminderScheduleRequest & { hash: string }>();
      for (const notification of plan.notifications) {
        const content = buildReminderContent(notification, settings, clock.formatTime);
        desired.set(notification.id, {
          id: notification.id,
          fireAtMs: clock.toEpochMs(notification.fireAt.dateKey, notification.fireAt.minuteOfDay),
          content,
          hash: hashReminderContent(content),
        });
      }

      const unchanged = new Set<string>();
      for (const entry of await scheduler.listScheduled()) {
        if (!entry.id.startsWith(DOSE_NAMESPACE)) continue;
        const want = desired.get(entry.id);
        if (want && want.fireAtMs === entry.fireAtMs && want.hash === entry.contentHash) unchanged.add(entry.id);
        else await scheduler.cancel(entry.id);
      }
      for (const { hash: _hash, ...request } of desired.values()) {
        if (!unchanged.has(request.id)) await scheduler.schedule(request);
      }

      const exact = await permissions.getExactAlarmStatus();
      this.setStatus({
        state: exact === 'denied' ? 'exact-alarm-denied' : 'ok',
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
