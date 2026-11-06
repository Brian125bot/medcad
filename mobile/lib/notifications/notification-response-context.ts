/**
 * COR-77: shared storage wiring for lock-screen actions (foreground, cold start, headless).
 */
import type { StorageContext } from '../storage/context';

export type NotificationResponseContext = Pick<StorageContext, 'repository'>;

let wiredContext: NotificationResponseContext | null = null;
let contextProvider: (() => Promise<NotificationResponseContext>) | null = null;

export function wireNotificationResponseContext(context: NotificationResponseContext): void {
  wiredContext = context;
}

export function setNotificationResponseContextProvider(
  provider: () => Promise<NotificationResponseContext>,
): void {
  contextProvider = provider;
}

export async function resolveNotificationResponseContext(): Promise<NotificationResponseContext | null> {
  if (wiredContext) return wiredContext;
  if (!contextProvider) return null;
  try {
    wiredContext = await contextProvider();
    return wiredContext;
  } catch (error) {
    console.warn('[reminders] action context unavailable', error instanceof Error ? error.name : 'Error');
    return null;
  }
}

/** @internal test helper */
export function resetNotificationResponseContextForTests(): void {
  wiredContext = null;
  contextProvider = null;
}
