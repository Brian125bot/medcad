import assert from 'node:assert';
import { createStorageContext, seedDemoVault, VAULT_CANARY_TABLE, VAULT_KEY_ID } from '../lib/storage/context';
import { VaultKeyMissingError } from '../lib/storage/ports';
import { memoryKeystore, nodeCipher, nodeSqlDriver } from './fixtures';

console.log('=== vault-key.test ===');

async function main() {
  // 1. Fresh install: no key, no rows → first write provisions key + canary, validateVault true.
  {
    const ctx = await createStorageContext({ driver: nodeSqlDriver(), cipher: nodeCipher(), keystore: memoryKeystore() });
    assert.strictEqual(await ctx.validateVault(), true);
    await ctx.repository.saveMedication({
      id: 'm1', name: 'N', strength: '1 mg', form: 'Tablet', purpose: 'p',
      instructions: 'i', frequency: 'daily', startDate: '2026-10-01',
      timeSlots: [{ id: 's1', label: 'Morning', time: '08:00', doseUnits: 1 }],
      inventory: { currentUnits: 5, capacityUnits: 30, lowThresholdUnits: 2, lastRefilledAt: '2026-10-01' },
      active: true,
    });
    assert.strictEqual(await ctx.validateVault(), true);
    await ctx.repository.close();
  }

  // 2. Key loss with rows present → VaultKeyMissingError, validateVault false, no silent rotation.
  {
    const driver = nodeSqlDriver();
    const cipher = nodeCipher();
    const keystore = memoryKeystore();
    const ctx = await createStorageContext({ driver, cipher, keystore });
    await ctx.repository.saveMedication({
      id: 'm1', name: 'N', strength: '1 mg', form: 'Tablet', purpose: 'p',
      instructions: 'i', frequency: 'daily', startDate: '2026-10-01',
      timeSlots: [{ id: 's1', label: 'Morning', time: '08:00', doseUnits: 1 }],
      inventory: { currentUnits: 5, capacityUnits: 30, lowThresholdUnits: 2, lastRefilledAt: '2026-10-01' },
      active: true,
    });
    await keystore.deleteItem(VAULT_KEY_ID); // simulate wiped Keychain / restore
    ctx.repository.forgetCachedKeyForTests(); // simulate relaunch
    assert.strictEqual(await ctx.validateVault(), false);
    await assert.rejects(() => ctx.repository.getAllMedications(), VaultKeyMissingError);
    // Keystore must NOT have been repopulated with a fresh key.
    assert.strictEqual(await keystore.getItem(VAULT_KEY_ID), null);
    await ctx.repository.close();
  }

  // 3. Wrong key in keystore (canary mismatch) → VaultKeyMissingError, validateVault false.
  {
    const driver = nodeSqlDriver();
    const cipher = nodeCipher();
    const keystore = memoryKeystore();
    const ctx = await createStorageContext({ driver, cipher, keystore });
    await ctx.repository.saveMedication({
      id: 'm1', name: 'N', strength: '1 mg', form: 'Tablet', purpose: 'p',
      instructions: 'i', frequency: 'daily', startDate: '2026-10-01',
      timeSlots: [{ id: 's1', label: 'Morning', time: '08:00', doseUnits: 1 }],
      inventory: { currentUnits: 5, capacityUnits: 30, lowThresholdUnits: 2, lastRefilledAt: '2026-10-01' },
      active: true,
    });
    ctx.repository.forgetCachedKeyForTests();
    const wrongKey = await cipher.generateKey();
    const b64 = (bytes: Uint8Array) => {
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      let out = '';
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      for (let i = 0; i < bin.length; i += 3) {
        const a = bin.charCodeAt(i);
        const b = i + 1 < bin.length ? bin.charCodeAt(i + 1) : 0;
        const c = i + 2 < bin.length ? bin.charCodeAt(i + 2) : 0;
        const t = (a << 16) | (b << 8) | c;
        out += chars[(t >> 18) & 63] + chars[(t >> 12) & 63] + (i + 1 < bin.length ? chars[(t >> 6) & 63] : '=') + (i + 2 < bin.length ? chars[t & 63] : '=');
      }
      return out;
    };
    await keystore.setItem(VAULT_KEY_ID, JSON.stringify({ v: 1, k: b64(wrongKey) }));
    assert.strictEqual(await ctx.validateVault(), false);
    await assert.rejects(() => ctx.repository.getAllMedications(), VaultKeyMissingError);
    await ctx.repository.close();
  }

  // 4. deleteVault clears keystore + canary + in-memory key; next launch provisions fresh.
  {
    const driver = nodeSqlDriver();
    const cipher = nodeCipher();
    const keystore = memoryKeystore();
    const ctx = await createStorageContext({ driver, cipher, keystore });
    await ctx.repository.saveMedication({
      id: 'm1', name: 'N', strength: '1 mg', form: 'Tablet', purpose: 'p',
      instructions: 'i', frequency: 'daily', startDate: '2026-10-01',
      timeSlots: [{ id: 's1', label: 'Morning', time: '08:00', doseUnits: 1 }],
      inventory: { currentUnits: 5, capacityUnits: 30, lowThresholdUnits: 2, lastRefilledAt: '2026-10-01' },
      active: true,
    });
    await ctx.deleteVault();
    assert.strictEqual(await keystore.getItem(VAULT_KEY_ID), null);
    const canary = await driver.get<{ sealed: string }>(`SELECT sealed FROM ${VAULT_CANARY_TABLE} WHERE id = 'canary'`);
    assert.strictEqual(canary, null);
    // Same-session write after reset must be readable after relaunch (no stale cached key).
    await ctx.repository.saveMedication({
      id: 'm2', name: 'N2', strength: '2 mg', form: 'Tablet', purpose: 'p',
      instructions: 'i', frequency: 'daily', startDate: '2026-10-01',
      timeSlots: [{ id: 's2', label: 'Morning', time: '08:00', doseUnits: 1 }],
      inventory: { currentUnits: 5, capacityUnits: 30, lowThresholdUnits: 2, lastRefilledAt: '2026-10-01' },
      active: true,
    });
    ctx.repository.forgetCachedKeyForTests();
    const meds = await ctx.repository.getAllMedications();
    assert.deepStrictEqual(meds.map((m) => m.id), ['m2']);
    await ctx.repository.close();
  }

  // 5. Production codec path: tamper a stored enc_payload through the repository → VaultIntegrityError.
  {
    const driver = nodeSqlDriver();
    const cipher = nodeCipher();
    const ctx = await createStorageContext({ driver, cipher, keystore: memoryKeystore() });
    await ctx.repository.saveMedication({
      id: 'm1', name: 'N', strength: '1 mg', form: 'Tablet', purpose: 'p',
      instructions: 'i', frequency: 'daily', startDate: '2026-10-01',
      timeSlots: [{ id: 's1', label: 'Morning', time: '08:00', doseUnits: 1 }],
      inventory: { currentUnits: 5, capacityUnits: 30, lowThresholdUnits: 2, lastRefilledAt: '2026-10-01' },
      active: true,
    });
    const row = await driver.get<{ enc_payload: string }>('SELECT enc_payload FROM medications WHERE id = ?', ['m1']);
    assert.ok(row);
    const raw = row!.enc_payload;
    const bytes = Buffer.from(raw, 'base64');
    bytes[20] ^= 1;
    await driver.run('UPDATE medications SET enc_payload = ? WHERE id = ?', [bytes.toString('base64'), 'm1']);
    const { VaultIntegrityError } = await import('../lib/storage/context');
    await assert.rejects(() => ctx.repository.getMedicationById('m1'), VaultIntegrityError);
    await ctx.repository.close();
  }

  // 6. Double-tap concurrency: N parallel logDose('taken') calls decrement inventory exactly once.
  {
    const ctx = await createStorageContext({ driver: nodeSqlDriver(), cipher: nodeCipher(), keystore: memoryKeystore() });
    await ctx.repository.saveMedication({
      id: 'm1', name: 'N', strength: '1 mg', form: 'Tablet', purpose: 'p',
      instructions: 'i', frequency: 'daily', startDate: '2026-10-01',
      timeSlots: [{ id: 's1', label: 'Morning', time: '08:00', doseUnits: 1 }],
      inventory: { currentUnits: 10, capacityUnits: 30, lowThresholdUnits: 2, lastRefilledAt: '2026-10-01' },
      active: true,
    });
    await Promise.all(Array.from({ length: 10 }, () => ctx.repository.logDose('2026-10-16', 'm1', 's1', 'taken')));
    const med = await ctx.repository.getMedicationById('m1');
    assert.strictEqual(med?.inventory.currentUnits, 9);
    assert.strictEqual((await ctx.repository.getDoseLogsByDate('2026-10-16')).length, 1);
    await ctx.repository.close();
  }

  // 7. Seed hygiene: anonymized IDs, preserved loggedAt, inventory not drained by history.
  {
    const driver = nodeSqlDriver();
    const ctx = await createStorageContext({ driver, cipher: nodeCipher(), keystore: memoryKeystore() });
    await seedDemoVault(ctx.repository, '2026-10-16');
    const meds = await ctx.repository.getAllMedications();
    assert.ok(meds.length > 0);
    assert.ok(meds.every((m) => m.id.startsWith('seed-med-')), 'seed IDs must not contain drug names');
    assert.ok(
      meds.every((m) => m.timeSlots.every((s) => s.id.startsWith('seed-slot-'))),
      'seed slot IDs must not contain drug names',
    );
    // loggedAt preserved from seed history (not stamped "now"), spot-check one morning slot.
    const logs = await ctx.repository.getDoseLogsByDate('2026-10-05');
    assert.ok(logs.length > 0);
    assert.ok(logs.every((l) => l.loggedAt !== ''), 'seed logs keep their original loggedAt');
    const morning = logs.find((l) => l.slotId === 'seed-slot-1-1');
    if (morning) assert.strictEqual(morning.loggedAt, '07:30');
    // History must not drain demo stock: seeding only ever ADDS logs, so stock
    // after seeding must equal stock before seeding (no logDose decrement ran).
    const { createInitialSeedData } = await import('../lib/domain/medication-data');
    const expected = createInitialSeedData('2026-10-16');
    const expectedByIndex = new Map(expected.medications.map((m, i) => [`seed-med-${i + 1}`, m.inventory.currentUnits]));
    for (const med of meds) {
      assert.strictEqual(
        med.inventory.currentUnits,
        expectedByIndex.get(med.id),
        `seed stock untouched for ${med.id}`,
      );
    }
    // Plaintext columns contain no drug names.
    const rawNames = await driver.all<{ id: string }>('SELECT id FROM medications');
    assert.ok(rawNames.every((r) => r.id.startsWith('seed-med-')));
    await ctx.repository.close();
  }

  console.log('✓ key lifecycle, tamper-through-repository, concurrency, seed entry');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
