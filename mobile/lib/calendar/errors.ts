/**
 * Typed Calendar API failures. Adapters map HTTP status and transport errors
 * to these; the engine classifies by class, never by message.
 */
export class CalendarAuthError extends Error {
  constructor(message = 'Calendar authorization failed') {
    super(message);
    this.name = 'CalendarAuthError';
  }
}

export class CalendarNetworkError extends Error {
  constructor(message = 'Calendar request could not reach the server') {
    super(message);
    this.name = 'CalendarNetworkError';
  }
}

export class CalendarRateLimitedError extends Error {
  constructor(message = 'Calendar request was rate limited') {
    super(message);
    this.name = 'CalendarRateLimitedError';
  }
}

export class CalendarServerError extends Error {
  constructor(message = 'Calendar server error') {
    super(message);
    this.name = 'CalendarServerError';
  }
}

export class CalendarClientError extends Error {
  constructor(message = 'Calendar request was rejected') {
    super(message);
    this.name = 'CalendarClientError';
  }
}

export type CalendarFailureClass = 'auth' | 'network' | 'retryable' | 'client' | 'unknown';

export function classifyCalendarError(error: unknown): CalendarFailureClass {
  if (error instanceof CalendarAuthError) return 'auth';
  if (error instanceof CalendarNetworkError) return 'network';
  if (error instanceof CalendarRateLimitedError || error instanceof CalendarServerError) return 'retryable';
  if (error instanceof CalendarClientError) return 'client';
  return 'unknown';
}

/** Safe-to-log label: the error's class name only, never its message. */
export function errorClassName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
