# CadenceRx Notification Engine: Supported Runtime & Architecture

> **Scope notice — this describes the web prototype, not the mobile app.**
>
> This page covers the **Next.js web** notification engine (`lib/notifications.ts`,
> which the web code and tests also refer to as "COR-76"). The *mobile*
> notification engine is Linear **COR-76** and is **not built yet**; see
> [`mobile/docs/roadmap.md`](../mobile/docs/roadmap.md) for its status and
> requirements.

## Runtime Environment
CadenceRx runs as a Next.js (App Router) web application. This document outlines the notification delivery model, security posture, and runtime capabilities.

## Delivery Capabilities

### 1. Foreground and Background Browser Tabs
- **Web Notifications API**: Dispatches system notifications to the desktop/operating system when notification permissions are granted.
- **Synthesized Medical Audio Chime**: Dual-pulse harmonic alert (880 Hz / 1320 Hz) synthesized via the Web Audio API to alert patients when medication doses are due.
- **Lead-Time Offsets**: Supports 0m (exact dose time), 5m prior, and 15m prior alert lead times. Slot-level overrides take precedence only when explicitly configured (including explicit 0m overrides). When a slot does not have an override, it inherits the global lead-time preference.

### 2. Disabling Alerts and Global Mute
- When **Browser Desktop Alerts** is toggled off (`browserAlertsEnabled: false`) or **Global Mute** is enabled (`globalMute: true`), all active in-memory timers are immediately cancelled and persistent schedules are cleared.
- Dynamic Preference Verification: `triggerLocalNotification()` re-verifies active preferences dynamically immediately prior to delivery. Stale timers cannot deliver alerts after alerts are disabled or muted.
- When re-enabled or unmuted, the notification engine reactively re-evaluates all active medications and re-arms upcoming alarms.

### 3. Interactive Quick Actions
- Interactive actions are supported through `handleNotificationAction()` with strict payload validation and idempotency safeguards.
- **Take Dose (`take-dose`)**: Immediately logs the dose as taken for the specific medication, dateKey, and time slot, deducts inventory, persists to encrypted storage, and syncs to Firestore if authenticated. Duplicate action events are ignored idempotently.
- **Snooze 15m (`snooze-15`)**: Schedules exactly one follow-up reminder 15 minutes later and adds the item to the snoozed alarms registry.
- When notifications trigger, patients can interact directly via the in-app `ActiveReminderBanner` or through notification response listeners.

### 4. Platform Limitations & App/Tab Termination
- **Browser Lifecycle Constraints**: Web browsers suspend or terminate JavaScript execution when a tab is closed, killed by the operating system, or when the host device is powered down.
- **Cold Boot / Device Restart**: In standard web runtimes, page-level JavaScript cannot wake a terminated browser or device without a native mobile application runtime (e.g., an Expo/React Native build using Android `AlarmManager` or iOS background notification categories).
- **Startup Rehydration**: To ensure clinical continuity, all upcoming triggers are persisted to offline local storage. When the user relaunches CadenceRx, `rehydrateScheduledNotifications()` automatically restores and re-arms all upcoming scheduled alerts for today and tomorrow. Past or stale triggers are safely ignored.
