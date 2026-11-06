import { describe, expect, it } from 'vitest';
import { MalformedNotificationPayloadError, parseDoseGroupPayload } from '../lib/notifications/payload';

describe('parseDoseGroupPayload', () => {
  it('rejects empty dose arrays and malformed entries', () => {
    expect(() => parseDoseGroupPayload({ v: 1, kind: 'dose-group', doses: [] })).toThrow(MalformedNotificationPayloadError);
    expect(() => parseDoseGroupPayload({ v: 1, kind: 'dose-group', doses: [null] })).toThrow(MalformedNotificationPayloadError);
    expect(() => parseDoseGroupPayload({ v: 1, kind: 'dose-group', doses: [{}] })).toThrow(MalformedNotificationPayloadError);
    expect(() => parseDoseGroupPayload({ v: 1, kind: 'dose-group', doses: [{ d: 'x', m: 'y' }] })).toThrow(
      MalformedNotificationPayloadError,
    );
  });
});
