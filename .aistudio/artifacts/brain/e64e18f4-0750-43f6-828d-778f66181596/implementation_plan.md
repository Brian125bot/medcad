# CadenceRx — Cloud Data Persistence & Real-time Google Account Sync

CadenceRx is transitioning from browser-only storage to a real-time, multi-device cloud architecture powered by Firebase Firestore and Google Authentication. This allows users to access their medication schedules, adherence logs, refill forecasts, and Google Calendar sync seamlessly across phones, tablets, and desktop browsers with automated data migration and offline fallback.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural decisions have been aligned based on your responses and will guide the implementation:

- **Confirmed Decision 1 — Firebase Firestore Synced with Google Account**: The application will use Firebase Authentication with Google Sign-In as the primary identity provider, anchoring the user's medication database to their Google account.
- **Confirmed Decision 2 — Real-time Multi-Device Sync Across Devices**: Utilizes Firestore real-time snapshot listeners (`onSnapshot`) to immediately reflect dose completions, inventory decrements, and schedule adjustments across all active sessions (desktop and mobile) with zero manual refresh required.
- **Confirmed Decision 3 — Automatic Browser-to-Cloud Migration**: When an existing user signs in with Google for the first time, the client will automatically detect local browser logs and cabinet data, upload them safely into their private Firestore profile, and confirm migration with clear visual feedback without any data loss.
- **Key Architectural Standard — Seamless Offline-First Resilience**: If the user is unauthenticated or temporarily offline, CadenceRx continues to operate flawlessly with local browser storage, syncing updates to the cloud automatically upon reconnection or authentication.

---

## 1. Overview & Core Concept

- **What It Does**: Upgrades CadenceRx with a cloud synchronization layer. Users can sign in with their Google account to persist and synchronize active medications, time-block schedules, dose completion histories, refill thresholds, and Google Calendar event mappings in real time.
- **Target Audience / Persona**: Individuals who manage daily prescriptions and supplements across multiple devices (e.g., desktop at work, smartphone or tablet at home) and demand continuous synchronization without risk of losing their adherence streaks or inventory tracking.
- **Key Value**: Guarantees zero data loss across browser clearings, device upgrades, or multi-device usage while maintaining instant (<200ms) optimistic local response times and real-time cloud harmony.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Authentication & Profile Bar (Top Navigation)**:
   - The top navigation bar displays a clean **Cloud Sync** status in Zone 3:
     - *Signed Out State*: Displays a discreet `Save & Sync` button with a Google icon and tooltip explaining cloud backup benefits.
     - *Syncing State*: Displays an animated cloud synchronization indicator (`Syncing...`).
     - *Synchronized State*: Displays a verified green status (`Cloud Synced · creetacticalgenius@gmail.com`) with a popover menu allowing manual refresh, data export, or sign out.
2. **First-Time Google Sign-In & Automatic Migration**:
   - User clicks **Sign in with Google** (via Firebase Google Auth popup).
   - Upon successful authentication, the system checks whether the cloud account has existing data:
     - *If cloud is empty and local data exists*: An animated migration toast appears: *"Migrating your local medications and dose history to your Google account..."*. All medications, dose logs, and reminder settings are atomically written to Firestore.
     - *Migration Complete*: A confirmation notification displays: *"6 medications and 35 dose logs successfully backed up to your Google account."*
   - Seamlessly pairs with the existing Google Calendar integration scope.
3. **Multi-Device Real-Time Synchronization**:
   - Marking a dose as *Taken* or *Skipped* on a smartphone immediately broadcasts the state change to Firestore.
   - An open desktop browser session updates its Daily Log checklist, Weekly Matrix cells, Monthly Heatmap score, and remaining inventory gauge within milliseconds without full-page reloads.
4. **Offline & Network Interruption Handling**:
   - If a network drop occurs, the app gracefully switches into an optimistic offline mode with a subtle amber badge (`Working Offline · Changes saved locally`).
   - Upon network restoration, pending modifications are pushed to Firestore and verified.

### Visual Identity & Theme (SaaS Dashboard & Medical Precision)

- **Aesthetic Direction**: Follows the clinical editorial guidelines from `references/3_saas_dashboard.md`. Flat single-elevation surfaces, hairline 1px borders (`border-slate-200`), tabular typography, and zero ornamental clutter.
- **Color Discipline (60-30-10 Palette)**:
  - *60% Neutral Canvas*: Slate-50 canvas (`#F8FAFC`) with pure white workspace panels.
  - *30% Structural Typography & Hairlines*: Slate-900 for high-contrast tabular values; Slate-600 for secondary prose; Slate-200 for 1px hairline dividers.
  - *10% Intentional Accent & Status*:
    - Teal-600 (`#0D9488`): Primary action accent and active tab indicator.
    - Emerald-600 (`#16A34A`): Cloud Synced status and Taken dose indicators.
    - Amber-600 (`#D97706`): Low supply alerts and offline warning.
    - Slate-700: Unboxed metadata typography with subtle middots (`·`).
- **Top Bar Contract**:
  - `[CadenceRx]` — `[Daily Log | Weekly Matrix | Monthly Analytics | Cabinet & Refills]` — `[Cloud Sync State | + Add Medication]`.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Subcollection per User (`users/{userId}/...`) vs Flat Root Collections**
  - *Chosen Approach*: Subcollections nested under the user document:
    - `/users/{userId}/medications/{medicationId}`
    - `/users/{userId}/doseLogs/{logId}`
    - `/users/{userId}/settings/userPreferences`
  - *Why*: Provides the highest level of security isolation. Zero chance of cross-tenant data leakage. Security rules can enforce `request.auth.uid == userId` uniformly.
  - *Alternatives Considered*: Flat collections with a `userId` field. While supported, subcollections allow automatic cascading access rules, cleaner query scopes, and lower security risk.
- **Decision 2: Optimistic UI with Real-time Snapshots (`onSnapshot`)**
  - *Chosen Approach*: React state updates optimistically immediately on user click, while a Firestore write occurs in the background. Incoming remote snapshot events from other devices smoothly reconcile into React state.
  - *Why*: Eliminates latency when tapping "Take Dose" while ensuring true cross-device consistency.
- **Decision 3: Preserving LocalStorage as Fallback & Offline Cache**
  - *Chosen Approach*: Keep `localStorage` as a mirror cache when unauthenticated or during network disconnects.
  - *Why*: Users can continue using CadenceRx without requiring an immediate Google login, and offline travel use is fully supported.

---

## 4. Technical Architecture & Data Strategy

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CadenceRx Web Application                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  Top Bar: [CadenceRx]   [Views: Daily/Week/Month/Cabinet]   [Sync & Auth]   │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                ┌──────────────────────┴──────────────────────┐
                │                                             │
      (Authenticated)                                  (Unauthenticated)
                ▼                                             ▼
┌───────────────────────────────┐             ┌───────────────────────────────┐
│     Firebase Auth Context     │             │      Local Storage Engine     │
│  • Google Sign-In Provider    │             │  • Browser localStorage       │
│  • Token & User UID Stream    │             │  • Instant Seed Fallback      │
└───────────────┬───────────────┘             └───────────────▲───────────────┘
                │                                             │
                ▼                                             │ (Offline cache &
┌───────────────────────────────┐                             │  migration src)
│   Firestore Sync Controller   │─────────────────────────────┘
│  • `onSnapshot` Real-time     │
│  • Auto-Migration Worker      │
│  • Optimistic Writes & Retry  │
└───────────────┬───────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Google Cloud / Firebase Firestore                       │
│                                                                             │
│  /users/{userId}                                                            │
│    ├── /medications/{medicationId}   (Catalog, dosage, schedule, inventory) │
│    ├── /doseLogs/{logKey}            (Taken/skipped status, timestamps)     │
│    └── /settings/preferences         (Reminders, calendar sync metadata)    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Firestore Schema Blueprint (`firebase-blueprint.json`)

1. **Entity `Medication`**:
   - `id`: String (uuid/timestamp)
   - `name`: String (1–100 chars)
   - `strength`: String (e.g., "20 mg")
   - `form`: String (Tablet, Capsule, Liquid, etc.)
   - `instructions`: String (max 200 chars)
   - `purpose`: String
   - `frequency`: Enum (`daily`, `specific_days`, `interval`)
   - `daysOfWeek`: Array of numbers (0–6)
   - `intervalDays`: Number (optional)
   - `timeSlots`: Array of `{ id, label, time, doseUnits }`
   - `inventory`: Object `{ currentUnits, capacityUnits, lowThresholdUnits, nextFillDate, pharmacyNote, googleCalendarEventId, lastRefilledAt }`
   - `active`: Boolean
   - `createdAt`: String (ISO)
   - `updatedAt`: Firestore Timestamp (`request.time`)
2. **Entity `DoseLog`**:
   - `id`: String (`${dateKey}_${medicationId}_${slotId}`)
   - `dateKey`: String (`YYYY-MM-DD`)
   - `medicationId`: String
   - `slotId`: String
   - `status`: Enum (`taken`, `skipped`, `missed`)
   - `loggedAt`: String (`HH:mm`)
   - `note`: String (optional, max 200 chars)
   - `updatedAt`: Firestore Timestamp (`request.time`)
3. **Entity `UserSettings`**:
   - `userId`: String
   - `migrationCompleted`: Boolean
   - `reminderPreferences`: Object
   - `updatedAt`: Firestore Timestamp (`request.time`)

### Hardened Firestore Security Rules Design

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Default Deny
    match /{document=**} {
      allow read, write: if false;
    }

    function isSignedIn() {
      return request.auth != null;
    }

    function isOwner(userId) {
      return isSignedIn() && request.auth.uid == userId;
    }

    match /users/{userId} {
      allow get, write: if isOwner(userId);

      match /medications/{medicationId} {
        allow read, write: if isOwner(userId);
      }

      match /doseLogs/{logId} {
        allow read, write: if isOwner(userId);
      }

      match /settings/{settingId} {
        allow read, write: if isOwner(userId);
      }
    }
  }
}
```

### Step-by-Step Execution Plan

1. **Firebase Provisioning & Auth Configuration**:
   - Call `set_up_firebase` / `show_aistudio_ui` for user confirmation.
   - Provision Firestore and Google Authentication.
   - Establish `firebase-blueprint.json` and deploy hardened `firestore.rules`.
2. **Firebase Client SDK & Authentication Context (`lib/firebase.ts`)**:
   - Initialize Firebase App and Firestore with robust error handler (`handleFirestoreError`).
   - Create `useFirebaseAuth` hook supplying current user, auth state, and `signInWithGoogle` / `signOut` actions.
3. **Cloud Data Sync & Migration Service (`lib/firestore-sync.ts`)**:
   - Implement real-time subscriptions for medications and dose logs via `onSnapshot`.
   - Implement automatic one-time migration worker to seamlessly promote browser `localStorage` records into Firestore upon first login.
4. **UI Integration (`app/page.tsx`, `CabinetInventoryView.tsx`, Top Bar)**:
   - Integrate Google Cloud Sync status pill and account avatar/menu into the top navigation bar.
   - Ensure seamless interoperability between Firebase Google sign-in and Google Calendar sync.
   - Verify bulk sync and individual refill sync continue operating without disruption.
5. **Verification & Testing**:
   - Verify seamless offline operation when disconnected.
   - Test cross-device synchronization and compile the application.
