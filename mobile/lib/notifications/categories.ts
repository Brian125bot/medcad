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
  authenticationRequired: boolean;
}

export const DOSE_REMINDER_ACTIONS: readonly ReminderCategoryAction[] = [
  {
    identifier: ACTION_TAKE_DOSE,
    buttonTitle: 'Take',
    opensAppToForeground: false,
    authenticationRequired: true,
  },
  {
    identifier: ACTION_SNOOZE_15M,
    buttonTitle: 'Snooze 15m',
    opensAppToForeground: false,
    authenticationRequired: true,
  },
  {
    identifier: ACTION_SKIP_DOSE,
    buttonTitle: 'Skip',
    opensAppToForeground: false,
    authenticationRequired: true,
  },
];

export interface ExpoCategoryActionOptions {
  opensAppToForeground: boolean;
  isAuthenticationRequired: boolean;
}

export interface ExpoCategoryActionShape {
  identifier: string;
  buttonTitle: string;
  options: ExpoCategoryActionOptions;
}

export function toExpoCategoryActions(actions: readonly ReminderCategoryAction[]): ExpoCategoryActionShape[] {
  return actions.map((action) => ({
    identifier: action.identifier,
    buttonTitle: action.buttonTitle,
    options: {
      opensAppToForeground: action.opensAppToForeground,
      isAuthenticationRequired: action.authenticationRequired,
    },
  }));
}

export { DOSE_REMINDER_CATEGORY };
