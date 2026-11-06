/**
 * COR-78 boundary guard: civil dates only. No UTC date slicing may creep back
 * into `lib/` or `app/` (roadmap gap 17).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|jsx)$/.test(name) ? [path] : [];
  });
}

describe('civil-date boundary', () => {
  it('lib/ and app/ never slice a UTC ISO date', () => {
    const offenders = ['lib', 'app']
      .flatMap((dir) => sourceFiles(join(ROOT, dir)))
      .filter((file) => readFileSync(file, 'utf8').includes('toISOString().slice(0, 10)'))
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});
