# CadenceRx — Schema Migration Guide (COR-71)

## Overview

CadenceRx features an idempotent schema migration runner implemented in `lib/storage/migrations.ts`. Migrations execute deterministically upon app boot prior to view rendering or data retrieval, ensuring zero race conditions or unmigrated schema reads.

---

## Migration History

### Version 1: Relational Schema & Encrypted Vault Transition
- **Date**: October 2026
- **Description**: Migrates flat unencrypted browser keys (`cadencerx_medications_v1`, `cadencerx_logs_v1`) into AES-256-GCM encrypted relational tables (`medications`, `time_slots`, `dose_logs`, `user_preferences`).
- **Data Safety Actions**:
  1. Inspects existing storage for legacy keys.
  2. If present, normalizes and encrypts every medication and dose record into relational rows.
  3. If absent (fresh install), seeds curated clinical demo dataset into encrypted tables.
  4. Once written to the encrypted vault, safely purges legacy plaintext keys from `localStorage`.

---

## Migration Execution Lifecycle

```
App Boot
  │
  ▼
medicationRepository.ensureReady()
  │
  ▼
runDatabaseMigrations()
  │
  ├─► Check current schema_versions in database
  │
  ├─► If currentVersion >= CURRENT_DATABASE_SCHEMA_VERSION:
  │     Skip migrations (Idempotent bypass)
  │
  └─► If currentVersion < 1:
        1. Create object stores / SQLite tables
        2. Detect legacy data (or seed initial dataset)
        3. Encrypt all records with AES-256-GCM
        4. Execute atomic transaction
        5. Record version 1 in schema_versions
        6. Purge plaintext legacy keys
```

---

## How to Add New Migrations

1. Increment `CURRENT_DATABASE_SCHEMA_VERSION` in `lib/storage/schema.ts`:
   ```ts
   export const CURRENT_DATABASE_SCHEMA_VERSION = 2;
   ```
2. In `lib/storage/migrations.ts`, add the migration block inside `runDatabaseMigrations`:
   ```ts
   if (currentVersion < 2) {
     // Execute schema transformations
     await dbAdapter.executeTransaction({
       // Put updated rows / update columns
       schemaVersionToPut: {
         version: 2,
         applied_at: new Date().toISOString(),
         description: 'Description of changes in version 2',
       },
     });
   }
   ```
3. Test migration with both fresh install and existing version 1 database state.
