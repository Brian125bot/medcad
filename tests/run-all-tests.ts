/**
 * Master Test Runner for CadenceRx Test Suites:
 * - Storage & WebCrypto Encryption (COR-71)
 * - Relational Migrations & Legacy Data Safety (COR-71 / COR-76)
 * - Notification Engine, Lead Time, Mute & Snooze Regressions (COR-76)
 */

import { execSync } from 'node:child_process';

console.log('====================================================');
console.log('   CADENCERX COMPREHENSIVE AUTOMATED TEST SUITE    ');
console.log('====================================================\n');

const suites = [
  { name: '1. Storage & Encryption Suite', cmd: 'node tests/medication-storage.test.mjs' },
  { name: '2. Schema Migration & Legacy Safety Suite', cmd: 'npx tsx tests/migration.test.ts' },
  { name: '3. Notification Engine & Alarm Regression Suite', cmd: 'npx tsx tests/notifications.test.ts' },
];

let allPassed = true;

for (const suite of suites) {
  console.log(`\n>>> RUNNING: ${suite.name} >>>\n`);
  try {
    execSync(suite.cmd, { stdio: 'inherit' });
  } catch (err) {
    allPassed = false;
    console.error(`\nFAILED: ${suite.name}`);
    process.exit(1);
  }
}

console.log('\n====================================================');
console.log('   ALL TEST SUITES PASSED SUCCESSFULLY! (100% OK)   ');
console.log('====================================================\n');
