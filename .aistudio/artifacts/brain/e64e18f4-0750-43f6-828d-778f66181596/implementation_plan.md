# COR-76: Native Background Alarm & Notification Engine

An offline-first, clinically reliable background notification and alarm engine for CadenceRx that schedules recurring alerts across medication time slots, supports interactive quick actions ("Take Dose" and "Snooze 15m"), and provides graceful permission handling and dual-mode delivery.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural decisions were confirmed via interactive clarification:
> - **Delivery Architecture**: Dual-mode engine supporting native mobile notifications via `expo-notifications` along with Web Notifications API and an interactive Web Audio API synthesized high-priority chime fallback for web preview environments.
> - **Default Lead-Time**: Notifications are scheduled for the **exact time** of the dose (0 minutes lead-time), with configurable preferences for 5 minutes and 15 minutes prior.
> - **Sound Profile & Interruption Level**: High-priority alert sound with persistent critical chime, setting Android notification channel importance to `MAX` and iOS interruption level to `critical`/`timeSensitive`.

---

## 1. Overview & Core Concept

CadenceRx is a precision medication adherence platform where timely dose delivery directly impacts patient health outcomes. COR-76 establishes a deterministic, offline-capable notification engine that:

1. **Pre-computes & Schedules Recurring Alerts**: Scans all active medications and their scheduled time slots (`Morning`, `Midday`, `Evening`, `Bedtime` or custom 24-hour times), scheduling recurring local notifications without requiring an active network connection.
2. **Clinical Permission Onboarding**: Displays an authoritative, HIPAA-conscious clinical modal before requesting OS notification permissions, highlighting the medical safety rationale.
3. **Interactive Notification Actions**:
   - `TAKE_DOSE`: Instantly records the dose as taken directly from the notification action or quick banner without requiring a full app reload.
   - `SNOOZE_15`: Automatically reschedules the notification for 15 minutes later and updates temporary snooze state.
4. **Reactive Rescheduling Engine**: Automatically cleans up and reschedules local alarms whenever medications are created, updated, paused, or deleted, or when lead-time preferences change.
5. **Persistence Across Device Restarts**: Uses local storage persistence (`medicationRepository` preferences and notification registry) so that scheduled triggers are rehydrated and synchronized on every app startup.

---

## 2. Visual & Structural Specifications

### A. Clinical Permission Explanation Dialog
- **Component**: `components/NotificationPermissionModal.tsx`
- **Clinical Rationale Presentation**: Clean, trusted medical aesthetics (slate-900 typography, teal-600 accents, shield icon). Clear bulleted reasons:
  - Exact timing for critical therapeutic windows.
  - Low-stock inventory depletion alerts.
  - Missed dose recovery prompts.
- **Actions**: "Enable Medication Reminders" (triggers browser/Expo permission request) and "Not Now, Remind Me Later" (quiet dismiss without nagging).

### B. Interactive Dose Notification Card & Toast Banner
- **In-App Dual-Mode Banner**: When an alert fires in-app or via foreground listener:
  - High-contrast clinical card at top of viewport.
  - Medication name, strength, instructions (e.g., "Take with food"), and time slot.
  - Quick action buttons: **Take Dose (Teal button)** and **Snooze 15m (Ghost button)**.
- **Audio Feedback**: Web Audio API oscillator synthesis generating a distinctive medical double-pulse chime (880Hz / 1320Hz harmonic interval) when alarms trigger.

---

## 3. Architecture & Data Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CadenceRx State Layer                           │
│  medications (active) ───► useMedicationStore() ◄─── dose logs        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ triggers reschedule
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   lib/notifications.ts Engine                          │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │  Notification Scheduler & Calculator                          │   │
│   │  - calculateNextDoseTimestamp(time, leadMinutes)               │   │
│   │  - filterActiveRegimenSlots(medications)                       │   │
│   │  - computeLeadTimeAdjustedDate(slotTime, preference)           │   │
│   └────────────────────────────────┬───────────────────────────────┘   │
│                                    │                                   │
│            ┌───────────────────────┴───────────────────────┐           │
│            ▼                                               ▼           │
│   ┌───────────────────────────────┐     ┌────────────────────────────┐ │
│   │ Native Expo Notifications     │     │ Web / Preview Notification │ │
│   │ - scheduleNotificationAsync   │     │ - Notification API         │ │
│   │ - setNotificationCategoryAsync│     │ - Web Audio Alert Chime    │ │
│   │ - "TAKE_DOSE" & "SNOOZE_15"   │     │ - Active Alert Queue state │ │
│   └───────────────────────────────┘     └────────────────────────────┘ │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ action response
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│   handleLogDose() / handleSnoozeDose() ──► medicationRepository        │
└────────────────────────────────────────────────────────────────────────┘
```

### Module Specifications:
- `lib/notifications.ts`:
  - `initNotificationEngine()`: Sets up Android notification channels, registers categories (`DOSE_REMINDER_CATEGORY` with `TAKE_DOSE` and `SNOOZE_15`), and configures listeners.
  - `requestNotificationPermissions()`: Graceful permission request returning permission status.
  - `rescheduleAllMedicationReminders(medications, leadTimeMinutes)`: Cancels obsolete scheduled alarms and schedules recurring triggers for all active medication slots.
  - `scheduleSnoozeNotification(medication, slot, snoozeMinutes)`: Creates an ad-hoc alarm `snoozeMinutes` into the future.
  - `cancelMedicationNotifications(medicationId)`: Clears pending notifications for a specific medication.
  - `playDoseAlertChime()`: Web Audio API sound generator for audio alarms.

---

## 4. Implementation Steps

### Phase 1: Core Notification Engine (`lib/notifications.ts`)
- Implement time slot parsing and next-trigger calculation utilities.
- Configure notification categories (`TAKE_DOSE`, `SNOOZE_15`) with icons and response listeners.
- Add dual-mode adapter: native `expo-notifications` (if runtime supports) with safe Web Notifications API + Web Audio fallback.
- Support lead-time preferences (`0`, `5`, `15` minutes).

### Phase 2: Clinical Permission Modal & Preferences
- Create `components/NotificationPermissionModal.tsx` with clinical explanation.
- Integrate permission modal into initial app boot sequence when permission is `undetermined` or `default`.
- Add notification setting toggle & lead-time selector into the Reminders Hub settings modal in `app/page.tsx`.

### Phase 3: Store & Lifecycle Integration
- Hook into `handleSaveMedication`, `handleToggleActiveMedication`, and `handleDeleteMedication` to automatically trigger `rescheduleAllMedicationReminders`.
- Wire up interactive action handlers for `TAKE_DOSE` (instant dose record) and `SNOOZE_15` (15-minute delay).
- Hydrate and re-synchronize scheduled notifications on app startup from `medicationRepository`.

### Phase 4: Unit Testing & Verification
- Create `tests/notifications.test.ts` covering:
  - Calculation of scheduled triggers with exact, 5-min, and 15-min lead times.
  - Rescheduling idempotence and obsolete notification cancellation.
  - Action category payload verification (`TAKE_DOSE` and `SNOOZE_15`).
  - Active vs. inactive medication filtering.
- Run `pnpm check` / linter and execute the automated test suite.
