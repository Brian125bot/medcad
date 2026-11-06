/**
 * Calendar sync boundary guard: screens import only `@/lib/calendar`, and the
 * pure calendar modules import no React, React Native, Expo, or network code.
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

const imports = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/(?:from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);

const PURE = ['engine', 'errors', 'event-content', 'fingerprint', 'placeholder-adapters', 'planner', 'ports', 'settings'];

describe('calendar boundary', () => {
  it('app/, components/, and hooks/ import calendar sync only through @/lib/calendar', () => {
    const offenders = ['app', 'components', 'hooks']
      .flatMap((dir) => sourceFiles(join(ROOT, dir)))
      .filter((file) => imports(file).some((spec) => /lib\/calendar\/./.test(spec)))
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('pure calendar modules import no React, React Native, Expo, or network client', () => {
    const files = PURE.map((name) => join(ROOT, 'lib', 'calendar', `${name}.ts`));
    const offenders = files.filter((file) =>
      imports(file).some((spec) => /^(react|react-native|expo)(-|\/|$)/.test(spec) || /expo-/.test(spec)),
    );
    expect(offenders.map((file) => relative(ROOT, file))).toEqual([]);
    for (const file of files) expect(readFileSync(file, 'utf8')).not.toMatch(/\bfetch\(|XMLHttpRequest|googleapis\.com/);
  });

  it('PR 1 ships no network code in lib/calendar', () => {
    for (const file of sourceFiles(join(ROOT, 'lib', 'calendar'))) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/\bfetch\(|XMLHttpRequest|googleapis\.com|expo-auth-session/);
    }
  });

  it('only calendar sync writes go through recordCalendarSync, never saveMedication', () => {
    const engine = readFileSync(join(ROOT, 'lib', 'calendar', 'engine.ts'), 'utf8');
    expect(engine).toContain('recordCalendarSync(');
    expect(engine).not.toContain('saveMedication');
  });

  it('event content builds times by concatenation, never Date arithmetic', () => {
    const content = readFileSync(join(ROOT, 'lib', 'calendar', 'event-content.ts'), 'utf8');
    expect(content).not.toMatch(/new Date|Date\.|toISOString/);
  });
});
