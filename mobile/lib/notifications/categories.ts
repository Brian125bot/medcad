/**
 * COR-77: lock-screen action definitions (pure, for tests and the Expo adapter).
 */
import {
  ACTION_SKIP_DOSE,
  ACTION_SNOOZE_15M,
  ACTION_TAKE_DOSE,
  DOSE_REMINDER_CATEGORY,
} from './types';

export interface ReminderCategoryAction {
  identifier: string;
  buttonTitle: string;
  opensAppToForeground: boolean;
}

export const DOSE_REMINDER_ACTIONS: readonly ReminderCategoryAction[] = [
  { identifier: ACTION_TAKE_DOSE, buttonTitle: 'Take', opensAppToForeground: false },
  { identifier: ACTION_SNOOZE_15M, buttonTitle: 'Snooze 15m', opensAppToForeground: false },
  { identifier: ACTION_SKIP_DOSE, buttonTitle: 'Skip', opensAppToForeground: false },
];

export { DOSE_REMINDER_CATEGORY };
