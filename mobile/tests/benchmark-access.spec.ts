import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BENCHMARK_FLAG_VALUE, isBenchmarkAccessEnabled } from '../lib/storage/benchmark-access';

describe('isBenchmarkAccessEnabled', () => {
  const cases: [boolean, string | undefined, boolean][] = [
    [true, undefined, true],
    [true, '', true],
    [true, '0', true],
    [true, '1', true],
    [true, 'true', true],
    [true, ' 1', true],
    [false, undefined, false],
    [false, '', false],
    [false, '0', false],
    [false, '1', true],
    [false, 'true', false],
    [false, ' 1', false],
  ];

  it.each(cases)('dev=%s flag=%j → %s', (dev, flag, expected) => {
    expect(isBenchmarkAccessEnabled(dev, flag)).toBe(expected);
    expect(BENCHMARK_FLAG_VALUE).toBe('1');
  });
});

function walkSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'tests') continue;
      walkSourceFiles(full, acc);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

describe('EXPO_PUBLIC_COR88_BENCHMARK env access boundary', () => {
  it('reads the flag only in constants/cor88-benchmark.ts with dotted process.env access', () => {
    const root = join(import.meta.dirname, '..');
    const envReader = join(root, 'constants/cor88-benchmark.ts');
    const readerText = readFileSync(envReader, 'utf8');
    expect(readerText).toContain('process.env.EXPO_PUBLIC_COR88_BENCHMARK');
    expect(readerText).not.toMatch(/process\.env\[/);

    const offenders: string[] = [];
    for (const file of walkSourceFiles(root)) {
      const rel = file.slice(root.length + 1);
      if (rel === 'constants/cor88-benchmark.ts') continue;
      const text = readFileSync(file, 'utf8');
      if (/process\.env(\.EXPO_PUBLIC_COR88_BENCHMARK|\[['"]EXPO_PUBLIC_COR88_BENCHMARK)/.test(text)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the flag module out of app/ so Expo Router does not expose a route', () => {
    const root = join(import.meta.dirname, '..');
    expect(existsSync(join(root, 'app/cor88-benchmark-access.ts'))).toBe(false);
    expect(existsSync(join(root, 'constants/cor88-benchmark.ts'))).toBe(true);
  });
});
