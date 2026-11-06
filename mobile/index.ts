// Android may start JS headless for lock-screen actions — register the task before Expo Router.
import './lib/notifications/background-task';
import 'expo-router/entry';
