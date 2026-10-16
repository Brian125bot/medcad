import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const suites = readdirSync(dir)
  .filter((file) => file.endsWith('.test.ts') || file.endsWith('.test.mts') || file === 'storage-core.mts')
  .sort()
  .map((file) => join(dir, file));

console.log(`=== CadenceRx mobile COR-71 suites (${suites.length}) ===\n`);
for (const suite of suites) {
  console.log(`--- ${suite.split(/[\\/]/).pop()} ---`);
  execSync(`npx tsx "${suite}"`, { stdio: 'inherit', cwd: join(dir, '..') });
}
console.log('\nAll mobile suites passed.');
