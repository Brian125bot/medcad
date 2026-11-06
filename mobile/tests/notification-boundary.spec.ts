/**
 * COR-76 boundary guard: screens never touch the OS notification APIs, and
 * the pure engine modules never import React, React Native, or Expo.
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

const imports = (file: string) => [...readFileSync(file, 'utf8').matchAll(/(?:from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);

describe('notification boundary', () => {
  it('app/, components/, and hooks/ never import expo-notifications or the adapters', () => {
    const offenders = ['app', 'components', 'hooks']
      .flatMap((dir) => sourceFiles(join(ROOT, dir)))
      .filter((file) => imports(file).some((spec) => spec === 'expo-notifications' || /lib\/notifications\/expo-/.test(spec)))
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('only lib/notifications imports expo-notifications anywhere in lib/', () => {
    const offenders = sourceFiles(join(ROOT, 'lib'))
      .filter((file) => !relative(ROOT, file).startsWith('lib/notifications/'))
      .filter((file) => imports(file).includes('expo-notifications'))
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('pure engine modules import no React, React Native, or Expo packages', () => {
    const pure = sourceFiles(join(ROOT, 'lib', 'notifications')).filter((file) => !/\/(expo-[^/]+|index)\.ts$/.test(file));
    expect(pure.length).toBeGreaterThanOrEqual(8);
    const offenders = pure.filter((file) => imports(file).some((spec) => /^(react|react-native|expo)(-|\/|$)/.test(spec)));
    expect(offenders.map((file) => relative(ROOT, file))).toEqual([]);
  });

  it('only the Expo clock converts civil pairs to Dates', () => {
    const callers = sourceFiles(ROOT)
      .filter((file) => !/\/(node_modules|tests|dist|\.expo)\//.test(file))
      .filter((file) => /civilToLocalDate\(/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file))
      .sort();
    expect(callers).toEqual(['lib/notifications/expo-clock.ts', 'lib/notifications/fire-time.ts']);
  });
});
