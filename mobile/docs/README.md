# CadenceRx Mobile — Documentation Index

Docs for the Expo / React Native app in `mobile/`. Start with **Architecture**,
use **Development** to get a working checkout, and keep **Roadmap** open to
know what is real and what is only planned.

Status claims were checked against the code on **2026-11-06** (`main` at
`7d72238`, Node 22). Behavioural claims below were verified by reading that
tree and, where an older page says so, by running the repository; anything
that needs a device is still unverified, and no device benchmark numbers are
recorded here.

## Read in this order

| Doc | Read it when… |
| --- | --- |
| [architecture.md](architecture.md) | You're new. Layers, module map, dependency rules, data model, the flows for add / edit / log, and the invariants (never log PHI, no silent key rotation). |
| [development.md](development.md) | You need to set up, run, test or lint; you want to know where new code goes. |
| [roadmap.md](roadmap.md) | You're choosing what to work on, or you hit something odd and want to know whether it's a known gap. Milestones, Linear status, and the **Known gaps and sharp edges** table. |
| [storage.md](storage.md) | You touch persistence: the encrypted-column model, key lifecycle, migrations, and a table of verified behaviours (clamping, orphaned logs, undo drift). |
| [device-benchmark.md](device-benchmark.md) | You need COR-88 device numbers: the dev-only storage benchmark screen, its gates, and how to run it on a phone. |
| [schedule-engine.md](schedule-engine.md) | You touch "is it due / adherence / streak / supply" logic. The rules, the intentional differences from the web app, and how it's tested. |
| [today-screen.md](today-screen.md) | You touch the Today tab: view model, optimistic store, rollback, gestures, rollover. |
| [notifications.md](notifications.md) | You touch dose reminders: the post-commit hook, reconciler, planning rules, privacy, channels, and the device checklist (COR-76). |
| [medication-wizard.md](medication-wizard.md) | You touch the add / edit flow: every field rule, form ⇄ `Medication` mapping, and a checklist for adding a field. |
| [cor-71-plan.md](cor-71-plan.md) | History only. The original storage plan; the as-built layout differs (see its banner). |

The changelog is at the repo root: [`CHANGELOG.md`](../../CHANGELOG.md). The
repo-level overview is [`README.md`](../../README.md); the app's own quick start
is [`../README.md`](../README.md).

## Five-minute orientation

```bash
cd mobile
npm ci
npx tsc --noEmit && npm run typecheck:storage && npm run lint && npm test   # the whole local gate
```

- **Pure core, thin shell.** Schedule math, form validation, encryption and the
  repository are plain TypeScript with no React Native imports, so they run
  under Node in tests. Only three files touch `expo-*` storage packages.
- **PHI is sensitive.** Names, strengths, notes and the pill's appearance are
  encrypted at rest; never log them; use obviously fake data in tests.
- **Dates are strings.** A day is a local `YYYY-MM-DD` key, never an instant;
  there is no hidden clock — callers pass `todayKey`.
- **CI** (`.github/workflows/ci.yml`, COR-87) runs the same gate plus `test:tz`
  and `expo export` on every PR and push to `main` (`ubuntu-24.04`, Node 22).
  Run the gate locally first anyway. The web prototype is not in CI.
- **Device QA is still pending** (COR-88 storage numbers, COR-91 wizard,
  COR-97 reminders). Bundling works after COR-90; tests, typecheck and lint
  run locally and in CI. CI is not a device run.

## When you change X, update Y

| You changed… | Update |
| --- | --- |
| Any user- or developer-visible behaviour | `CHANGELOG.md` → `[Unreleased]` |
| `Medication` / a stored field | [medication-wizard.md](medication-wizard.md#adding-a-field-to-a-medication) checklist; [storage.md](storage.md) table if it's persisted |
| `lib/storage/` (schema, migrations, repository behaviour) | [storage.md](storage.md), and [roadmap.md](roadmap.md#known-gaps-and-sharp-edges) if you fix or add a sharp edge |
| `lib/schedule/` rules | [schedule-engine.md](schedule-engine.md) |
| `lib/today/`, Today UI | [today-screen.md](today-screen.md) |
| `lib/notifications/`, reminder settings | [notifications.md](notifications.md) |
| Wizard fields, limits, messages | [medication-wizard.md](medication-wizard.md) |
| Commands, tooling, test layout | [development.md](development.md) |
| Folder structure or layering | [architecture.md](architecture.md) |
| A Linear issue's status, or a gap closed | [roadmap.md](roadmap.md) |

## Glossary

| Term | Meaning |
| --- | --- |
| **PHI** | Protected health information: anything that says what a person takes or why. |
| **Vault** | The encrypted SQLite database plus its key in the OS keystore. |
| **Canary** | A small sealed row used to prove the stored key matches the database before using it. |
| **Port / adapter** | `SqlDriver`, `CipherPort`, `SecureKeyStore` are the ports; `expo-*.ts` files are the device adapters and `tests/fixtures.ts` the Node ones. |
| **Date key** | A local calendar day as `YYYY-MM-DD`. |
| **Slot** | One dose time on a medication (`TimeSlot`): time, units, reminder settings. |
| **Dose key** | `` `${dateKey}_${medicationId}_${slotId}` `` — the primary key of a dose log. |
| **COR-nn** | A Linear issue in team *Coretek*. |
