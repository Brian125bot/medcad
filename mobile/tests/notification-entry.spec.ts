import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

describe('custom app entry (COR-77)', () => {
  it('package.json main points at the custom entry', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { main: string };
    expect(pkg.main).toBe('./index.ts');
  });

  it('registers background-task before expo-router/entry', () => {
    const entry = readFileSync(join(ROOT, 'index.ts'), 'utf8');
    const bg = entry.indexOf('./lib/notifications/background-task');
    const router = entry.indexOf('expo-router/entry');
    expect(bg).toBeGreaterThanOrEqual(0);
    expect(router).toBeGreaterThan(bg);
  });

  it('only background-task defines the reminder action task', () => {
    const bg = readFileSync(join(ROOT, 'lib/notifications/background-task.ts'), 'utf8');
    expect(bg).toContain('TaskManager.defineTask');
    const imports = (dir: string): string[] => {
      const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
      return readdirSync(dir).flatMap((name: string) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return imports(path);
        return /\.(ts|tsx)$/.test(name) && !path.endsWith('background-task.ts') ? [readFileSync(path, 'utf8')] : [];
      });
    };
    const others = imports(join(ROOT, 'lib')).concat(imports(join(ROOT, 'app')));
    expect(others.some((src) => src.includes('TaskManager.defineTask'))).toBe(false);
  });
});
