/**
 * COR-72 time-zone test matrix runner.
 *
 * Spawns `vitest run --coverage` once per TZ with TZ set in the child
 * process environment (setting process.env.TZ after startup is unreliable,
 * so each run gets a fresh process with TZ preset).
 *
 * Zones: UTC, America/Chicago (primary developer zone + explicit DST
 * transition tests), America/New_York, Pacific/Auckland (southern-hemisphere
 * DST), Asia/Kolkata (half-hour offset, no DST), Pacific/Honolulu (no DST).
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ZONES = [
  'UTC',
  'America/Chicago',
  'America/New_York',
  'Pacific/Auckland',
  'Asia/Kolkata',
  'Pacific/Honolulu',
] as const;

const mobileDir = join(dirname(fileURLToPath(import.meta.url)), '..');

let failed = false;
for (const tz of ZONES) {
  console.log(`\n===== TZ=${tz} =====`);
  const result = spawnSync('npx', ['vitest', 'run', '--coverage'], {
    cwd: mobileDir,
    env: { ...process.env, TZ: tz },
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    failed = true;
    console.error(`TZ=${tz} failed with status ${result.status}`);
  }
}

if (failed) {
  console.error('\nTZ matrix FAILED in at least one zone.');
  process.exit(1);
}
console.log('\nTZ matrix passed in all zones.');
