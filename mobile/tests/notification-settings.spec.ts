/**
 * COR-76 reminder settings helpers.
 */
import { describe, expect, it } from 'vitest';
import {
  formatLeadMinutes,
  getMedicationAlert,
  isValidLeadMinutes,
  PREF_DEFAULT_LEAD_MINUTES,
  PREF_SHOW_MEDICATION_NAMES,
  readReminderSettings,
  summarizeLeadMinutes,
  withAlert,
  withLeadMinutes,
  leadChipLabel,
  leadChipOptions,
} from '../lib/notifications/settings';
import { makeMed } from './notification-fixtures';

function prefs(values: Record<string, unknown>) {
  return {
    async getPreference<T>(key: string, fallback: T): Promise<T> {
      return (key in values ? values[key] : fallback) as T;
    },
  };
}

const slot = (id: string, leadMinutes?: number | null) => ({ id, label: 'Morning' as const, time: '08:00', doseUnits: 1, leadMinutes });

describe('readReminderSettings', () => {
  it('defaults when unset', async () => {
    expect(await readReminderSettings(prefs({}))).toEqual({ defaultLeadMinutes: 0, showMedicationNames: false });
  });

  it('reads valid values and rejects invalid ones', async () => {
    expect(await readReminderSettings(prefs({ [PREF_DEFAULT_LEAD_MINUTES]: 15, [PREF_SHOW_MEDICATION_NAMES]: true }))).toEqual({ defaultLeadMinutes: 15, showMedicationNames: true });
    for (const bad of [-1, 1.5, '10', 1441, null]) {
      expect((await readReminderSettings(prefs({ [PREF_DEFAULT_LEAD_MINUTES]: bad }))).defaultLeadMinutes).toBe(0);
    }
    expect((await readReminderSettings(prefs({ [PREF_SHOW_MEDICATION_NAMES]: 'yes' }))).showMedicationNames).toBe(false);
    expect(isValidLeadMinutes(1440)).toBe(true);
  });
});

describe('lead-time summary and edits', () => {
  it('summarizes default, explicit, and mixed', () => {
    expect(summarizeLeadMinutes(makeMed({ timeSlots: [] }))).toEqual({ kind: 'default' });
    expect(summarizeLeadMinutes(makeMed({ timeSlots: [slot('a'), slot('b', null)] }))).toEqual({ kind: 'default' });
    expect(summarizeLeadMinutes(makeMed({ timeSlots: [slot('a', 10), slot('b', 10)] }))).toEqual({ kind: 'explicit', minutes: 10 });
    expect(summarizeLeadMinutes(makeMed({ timeSlots: [slot('a', 0)] }))).toEqual({ kind: 'explicit', minutes: 0 });
    expect(summarizeLeadMinutes(makeMed({ timeSlots: [slot('a', 10), slot('b')] }))).toEqual({ kind: 'mixed' });
  });

  it('writes one value to every slot without mutating the input', () => {
    const med = makeMed({ timeSlots: [slot('a', 10), slot('b')] });
    const next = withLeadMinutes(med, 30);
    expect(next.timeSlots.map((s) => s.leadMinutes)).toEqual([30, 30]);
    expect(med.timeSlots.map((s) => s.leadMinutes)).toEqual([10, undefined]);
    expect(summarizeLeadMinutes(withLeadMinutes(med, null))).toEqual({ kind: 'default' });
  });

  it('formats lead labels', () => {
    expect(formatLeadMinutes(0)).toBe('At dose time');
    expect(formatLeadMinutes(15)).toBe('15 min before');
  });
});

describe('alert edits', () => {
  it('defaults to sound and vibrate, and patches one field', () => {
    expect(getMedicationAlert(makeMed())).toEqual({ sound: true, vibrate: true });
    const quiet = withAlert(makeMed(), { sound: false });
    expect(quiet.alert).toEqual({ sound: false, vibrate: true });
    expect(withAlert(quiet, { vibrate: false }).alert).toEqual({ sound: false, vibrate: false });
  });
});

describe('leadChipOptions', () => {
  it('lists the standard options, with a leading default when allowed', () => {
    expect(leadChipOptions(10, false)).toEqual([0, 5, 10, 15, 30, 60]);
    expect(leadChipOptions(null, true)).toEqual([null, 0, 5, 10, 15, 30, 60]);
    expect(leadChipOptions('mixed', true)).toEqual([null, 0, 5, 10, 15, 30, 60]);
  });

  it('adds a stored non-standard lead time in order so it shows as selected', () => {
    expect(leadChipOptions(20, false)).toEqual([0, 5, 10, 15, 20, 30, 60]);
    expect(leadChipOptions(90, true)).toEqual([null, 0, 5, 10, 15, 30, 60, 90]);
  });

  it('does not mutate the shared options', () => {
    leadChipOptions(20, false);
    expect(leadChipOptions(null, false)).toEqual([0, 5, 10, 15, 30, 60]);
  });

  it('labels chips briefly', () => {
    expect(leadChipLabel(0)).toBe('At time');
    expect(leadChipLabel(20)).toBe('20 min');
  });
});
