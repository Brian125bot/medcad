/**
 * Writes the COR-76 reminder chime. Run: npx tsx scripts/generate-chime.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { synthesizeChimeWav } from '../lib/notifications/chime';

const target = join(__dirname, '..', 'assets', 'sounds', 'cadencerx-chime.wav');
writeFileSync(target, synthesizeChimeWav());
console.log(`wrote ${target}`);
