import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

function legacySupplyImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const offenders: string[] = [];
  for (const match of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g)) {
    const [, names, from] = match;
    if (!from.includes('domain/medication-data')) continue;
    if (/\b(computeRecommendedNextFillDate|estimateDaysOfSupplyRemaining)\b/.test(names)) {
      offenders.push(`${relative(process.cwd(), file)} imports ${names.trim()} from ${from}`);
    }
  }
  return offenders;
}

describe('fill-date supply boundary', () => {
  it('keeps lib/ and app/ on lib/schedule/supply.ts, not the legacy domain helpers', () => {
    const roots = [join(process.cwd(), 'lib'), join(process.cwd(), 'app')];
    const offenders = roots.flatMap(sourceFiles).flatMap(legacySupplyImports);
    expect(offenders).toEqual([]);
  });
});
