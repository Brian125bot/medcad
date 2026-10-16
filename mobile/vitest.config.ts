import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
  coverage: {
    provider: 'v8',
    reporter: ['text', 'lcov'],
    include: ['lib/schedule/**/*.ts'],
    thresholds: {
      lines: 100,
      branches: 100,
      functions: 100,
      statements: 100,
    },
  },
});
