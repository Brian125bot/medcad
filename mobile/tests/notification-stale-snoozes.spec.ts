import { describe, expect, it } from 'vitest';
import type { DoseLogMap } from '../lib/domain/medication-data';
import { staleSnoozeIds } from '../lib/notifications/stale-snoozes';
import { SNOOZE_NAMESPACE } from '../lib/notifications/types';

describe('staleSnoozeIds', () => {
  it('cancels snoozes whose doses are all logged', () => {
    const logs: DoseLogMap = {
      '2026-10-16_med-a_slot-am': {
        key: '2026-10-16_med-a_slot-am',
        dateKey: '2026-10-16',
        medicationId: 'med-a',
        slotId: 'slot-am',
        status: 'taken',
        loggedAt: '08:05',
      },
    };
    const id = `${SNOOZE_NAMESPACE}2026-10-16.0815`;
    expect(
      staleSnoozeIds(
        [{ id, fireAtMs: Date.now() + 60_000, contentHash: null, exact: true, doseKeys: ['2026-10-16_med-a_slot-am'] }],
        logs,
        new Set(['med-a']),
      ),
    ).toEqual([id]);
  });

  it('keeps partially pending snoozes', () => {
    const id = `${SNOOZE_NAMESPACE}2026-10-16.0815`;
    expect(
      staleSnoozeIds(
        [
          {
            id,
            fireAtMs: Date.now() + 60_000,
            contentHash: null,
            exact: true,
            doseKeys: ['2026-10-16_med-a_slot-am', '2026-10-16_med-b_slot-am'],
          },
        ],
        {},
        new Set(['med-a', 'med-b']),
      ),
    ).toEqual([]);
  });

  it('treats missing doseKeys as stale', () => {
    const id = `${SNOOZE_NAMESPACE}bad`;
    expect(staleSnoozeIds([{ id, fireAtMs: 1, contentHash: null, exact: true }], {}, new Set())).toEqual([id]);
  });
});
