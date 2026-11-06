// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'coverage/*', '.expo/*', 'node_modules/*'],
  },
  {
    // COR-76: only the reminder engine talks to the OS notification APIs.
    files: ['**/*.{js,jsx,ts,tsx}'],
    ignores: ['lib/notifications/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'expo-notifications',
              message: 'Use @/lib/notifications (ensureReminderPermission / useReminderStatus); never schedule from screens.',
            },
          ],
          patterns: [
            {
              group: ['**/lib/notifications/expo-*', '@/lib/notifications/expo-*'],
              message: 'Notification adapters are internal to lib/notifications.',
            },
          ],
        },
      ],
    },
  },
]);
