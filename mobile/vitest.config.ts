import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['lib/schedule/**/*.ts', 'lib/wizard/**/*.ts', 'lib/today/**/*.ts', 'lib/storage/device-benchmark.ts', 'lib/storage/diagnostics.ts', 'lib/notifications/**/*.ts'],
      // Expo adapters and the wiring index are device-only, like lib/storage/expo-*.ts.
      // Vitest's default exclude drops any `*-benchmark.ts` file (it matches its
      // bench pattern), which would silently skip the COR-88 harness. Only tests are excluded.
      exclude: [
        'tests/**',
        'lib/notifications/expo-*.ts',
        'lib/notifications/index.ts',
        'lib/notifications/ports.ts',
        'lib/notifications/background-task.ts',
        'lib/notifications/notification-response.ts',
      ],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
