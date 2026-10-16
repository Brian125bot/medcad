import assert from 'node:assert';
import { memoryKeystore, nodeCipher, nodeSqlDriver, VaultIntegrityError } from './fixtures';
import { DDL_STATEMENTS } from '../lib/storage/schema';

async function main() {

console.log('=== storage-core.test ===');


const keystore = memoryKeystore();
await keystore.setItem('cadencerx.vault.key.v1', 'test-key');
assert.strictEqual(await keystore.getItem('cadencerx.vault.key.v1'), 'test-key');
await keystore.deleteItem('cadencerx.vault.key.v1');
assert.strictEqual(await keystore.getItem('cadencerx.vault.key.v1'), null);

const cipher = nodeCipher();
const key = await cipher.generateKey();
assert.strictEqual(key.length, 32);
const plaintext = new TextEncoder().encode('{"name":"Lisinopril"}');
const sealed = await cipher.seal(plaintext, key);
assert.strictEqual(new Uint8Array(Buffer.from(sealed, 'base64')).length, 12 + plaintext.length + 16);
assert.deepStrictEqual(await cipher.open(sealed, key), plaintext);
const wrongKey = await cipher.generateKey();
await assert.rejects(async () => cipher.open(sealed, wrongKey), VaultIntegrityError);
const tampered = (() => {
  const bytes = Buffer.from(sealed, 'base64');
  bytes[12] ^= 1;
  return bytes.toString('base64');
})();
await assert.rejects(async () => cipher.open(tampered, key), VaultIntegrityError);

const driver = nodeSqlDriver();
await driver.open(':memory:');
await driver.transaction(async () => {
  await driver.exec(DDL_STATEMENTS.join('\n'));
});
const tables = await driver.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
assert.deepStrictEqual(
  tables.map((row) => row.name),
  ['dose_logs', 'medications', 'schema_versions', 'time_slots', 'user_preferences'],
);

console.log('✓ keystore, CipherPort, and DDL smoke checks');



}
void main();
