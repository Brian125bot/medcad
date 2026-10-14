import {initializeApp, getApps, getApp} from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.acls',
  'https://www.googleapis.com/auth/calendar.acls.readonly',
  'https://www.googleapis.com/auth/calendar.app.created',
  'https://www.googleapis.com/auth/calendar.calendarlist',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.calendars',
  'https://www.googleapis.com/auth/calendar.calendars.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
  'https://www.googleapis.com/auth/calendar.events.owned',
  'https://www.googleapis.com/auth/calendar.events.owned.readonly',
  'https://www.googleapis.com/auth/calendar.events.public.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.settings.readonly',
];

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}

// Flag to indicate if we are in the middle of a sign-in flow.
let isSigningIn = false;
// Cache the access token strictly in memory (never in localStorage/sessionStorage).
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to obtain Google Calendar access token.');
    }

    cachedAccessToken = credential.accessToken;
    return {user: result.user, accessToken: cachedAccessToken};
  } catch (error) {
    console.error('Google Sign-In error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logoutGoogle = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

export interface GoogleCalendarEventItem {
  id: string;
  summary: string;
  description?: string;
  htmlLink?: string;
  start: {
    date?: string;
    dateTime?: string;
  };
  end: {
    date?: string;
    dateTime?: string;
  };
}

export interface FillDateEventPayload {
  medicationId: string;
  medicationName: string;
  strength: string;
  fillDate: string; // YYYY-MM-DD
  quantityToFill: number;
  form: string;
  pharmacyNote?: string;
  prescriber?: string;
}

function addOneDayToDateString(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + 1, 12, 0, 0);
  const ny = dt.getFullYear();
  const nm = String(dt.getMonth() + 1).padStart(2, '0');
  const nd = String(dt.getDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

export async function listCalendarRefillEvents(
  accessToken: string
): Promise<GoogleCalendarEventItem[]> {
  const timeMin = new Date();
  timeMin.setDate(timeMin.getDate() - 30);

  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
    q: 'CadenceRx',
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(
      errBody?.error?.message || 'Failed to list Google Calendar events'
    );
  }

  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

export async function createCalendarFillEvent(
  accessToken: string,
  payload: FillDateEventPayload
): Promise<GoogleCalendarEventItem> {
  const endDate = addOneDayToDateString(payload.fillDate);
  const summary = `Rx Fill: ${payload.medicationName} (${payload.strength})`;
  const descriptionLines = [
    `CadenceRx Prescription Fill Reminder`,
    `Medication: ${payload.medicationName} ${payload.strength}`,
    `Refill Quantity: ${payload.quantityToFill} ${payload.form}s`,
    payload.pharmacyNote ? `Pharmacy / Notes: ${payload.pharmacyNote}` : null,
    payload.prescriber ? `Prescriber: ${payload.prescriber}` : null,
  ].filter(Boolean);

  const body = {
    summary,
    description: descriptionLines.join('\n'),
    start: {
      date: payload.fillDate,
    },
    end: {
      date: endDate,
    },
    reminders: {
      useDefault: false,
      overrides: [
        {method: 'popup', minutes: 9 * 60}, // 9:00 AM day before / morning of
      ],
    },
  };

  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(
      errBody?.error?.message || 'Failed to create Google Calendar fill event'
    );
  }

  return await res.json();
}

export async function updateCalendarFillEvent(
  accessToken: string,
  eventId: string,
  payload: FillDateEventPayload
): Promise<GoogleCalendarEventItem> {
  const endDate = addOneDayToDateString(payload.fillDate);
  const summary = `Rx Fill: ${payload.medicationName} (${payload.strength})`;
  const descriptionLines = [
    `CadenceRx Prescription Fill Reminder`,
    `Medication: ${payload.medicationName} ${payload.strength}`,
    `Refill Quantity: ${payload.quantityToFill} ${payload.form}s`,
    payload.pharmacyNote ? `Pharmacy / Notes: ${payload.pharmacyNote}` : null,
    payload.prescriber ? `Prescriber: ${payload.prescriber}` : null,
  ].filter(Boolean);

  const body = {
    summary,
    description: descriptionLines.join('\n'),
    start: {
      date: payload.fillDate,
    },
    end: {
      date: endDate,
    },
  };

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(
      eventId
    )}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    // If the event was deleted externally (404/410), fall back to creating a fresh event
    if (res.status === 404 || res.status === 410) {
      return createCalendarFillEvent(accessToken, payload);
    }
    const errBody = await res.json().catch(() => ({}));
    throw new Error(
      errBody?.error?.message || 'Failed to update Google Calendar fill event'
    );
  }

  return await res.json();
}

export async function deleteCalendarFillEvent(
  accessToken: string,
  eventId: string
): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(
      eventId
    )}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(
      errBody?.error?.message || 'Failed to delete Google Calendar event'
    );
  }
}
