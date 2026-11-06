import { describe, expect, it } from 'vitest';
import {
  HANDLED_RESPONSES_MAX,
  HANDLED_RESPONSES_TTL_MS,
  hasHandled,
  normalizeDeliveredAtMs,
  parseHandledStore,
  recordHandled,
  responseKey,
} from '../lib/notifications/response-dedupe';

describe('response-dedupe', () => {
  it('builds stable keys without PHI', () => {
    expect(
      responseKey({ notificationId: 'cx.dose.2026-10-16.0800', actionIdentifier: 'TAKE_DOSE', deliveredAtMs: 1_700_000_000_000 }),
    ).toBe('cx.dose.2026-10-16.0800|TAKE_DOSE|1700000000000');
  });

  it('records, de-duplicates, caps, and prunes by TTL', () => {
    const now = 1_000_000_000_000;
    let store = recordHandled([], 'a', now);
    store = recordHandled(store, 'b', now + 1);
    expect(store.map((e) => e.key)).toEqual(['b', 'a']);
    store = recordHandled(store, 'a', now + 2);
    expect(store.filter((e) => e.key === 'a')).toHaveLength(1);
    for (let i = 0; i < HANDLED_RESPONSES_MAX + 5; i++) {
      store = recordHandled(store, `k${i}`, now + 100 + i);
    }
    expect(store.length).toBeLessThanOrEqual(HANDLED_RESPONSES_MAX);
    store = recordHandled(
      [{ key: 'old', at: now - HANDLED_RESPONSES_TTL_MS - 1 }],
      'fresh',
      now,
    );
    expect(store.map((e) => e.key)).toEqual(['fresh']);
  });

  it('parses malformed stores as empty', () => {
    expect(parseHandledStore(null)).toEqual([]);
    expect(parseHandledStore([null, { key: 1, at: 'x' }])).toEqual([]);
    expect(hasHandled(parseHandledStore([{ key: 'a', at: 1000 }]), 'a')).toBe(true);
  });

  it('normalizes iOS seconds to epoch ms', () => {
    expect(normalizeDeliveredAtMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(normalizeDeliveredAtMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });
});
