/**
 * COR-72 adherence analytics over a 30-day window with streak tracking.
 *
 * Pure domain logic: no React Native, Expo, or storage imports. Reuses the
 * storage layer's domain types (`AdherenceAnalyticsSummary` included).
 *
 * Window semantics (ported from `lib/medication-data.ts`):
 * - Rates cover the 30 days ending today (`-29..0`). Today's still-`pending`
 *   doses are excluded from the denominator so an unstarted evening does not
 *   penalize the rate; every logged today dose counts.
 * - `sevenDayAdherencePct` is the same computation over `-6..0`.
 * - `byTimeOfDay` / `byMedication` count only doses in the 30-day window
 *   (pending today excluded); empty buckets report 100.
 * - Streaks scan from the earliest valid medication `startDate` (on or
 *   before `todayKey`) through today, clipped to `MAX_STREAK_LOOKBACK_DAYS`
 *   (~10 years; longer histories saturate at the bound instead of scanning
 *   unboundedly). Medications with invalid or future start dates do not move
 *   the scan start. A scheduled day extends the streak only when
 *   every dose is handled without a miss (`taken` or `skipped`) AND at
 *   least one dose was `taken`. Days with no scheduled doses are skipped:
 *   they neither extend nor break the streak. An incomplete today (any
 *   `pending` dose) never breaks the streak — `currentStreakDays` keeps
 *   yesterday's value. A fully complete today extends it.
 * - A past day in which every dose was skipped (none `taken`) RESETS the
 *   streak to 0, matching the web implementation. Skipped doses are not
 *   misses for the adherence rate, but a skipped-only day does not extend
 *   the streak.
 * - Orphan logs (COR-93) are history: a log whose slot was removed from its
 *   medication, or whose medication was deleted, still counts on its day with
 *   its own status, bucketed by its stored `slotSnapshot.label`. Orphans of a
 *   deleted medication count toward totals, `byTimeOfDay` and streaks but not
 *   `byMedication`; orphans of a paused (inactive) medication are excluded,
 *   like the rest of its history. Logs without a snapshot (written before
 *   COR-93) and logs dated after `todayKey` are ignored. Orphan dates can move
 *   the streak scan start earlier.
 */
import type {
  AdherenceAnalyticsSummary,
  DoseLogMap,
  DoseStatus,
  Medication,
  TimeOfDayBlock,
} from '../domain/medication-data';
import { addDaysToKey, diffDaysBetweenKeys, isValidDateKey } from './date-keys';
import { getScheduledDosesForDate } from './doses';

/**
 * Safety bound on how far back the streak scan may reach (about 10 years of
 * calendar days). A pathological `startDate` (e.g. year 1900) would otherwise
 * scan tens of thousands of days times every medication on each call.
 * When the bound clips the scan, reported streaks saturate at the bound:
 * a true 40-year streak reads as `MAX_STREAK_LOOKBACK_DAYS` (+ today).
 */
export const MAX_STREAK_LOOKBACK_DAYS = 3660;

/**
 * Earliest valid medication `startDate` on or before `todayKey`, or `null`
 * when no medication has one (invalid or future-only starts). Medications
 * with invalid or future start dates contribute nothing to the streak scan.
 * Purity note: pure function of its arguments.
 */
function earliestStreakScanStart(medications: Medication[], todayKey: string): string | null {
  let earliest: string | null = null;
  for (const med of medications) {
    if (!isValidDateKey(med.startDate)) {
      continue;
    }
    if (diffDaysBetweenKeys(med.startDate, todayKey) < 0) {
      continue;
    }
    if (earliest === null || diffDaysBetweenKeys(earliest, med.startDate) < 0) {
      earliest = med.startDate;
    }
  }
  return earliest;
}

/** One dose as analytics sees it: a scheduled slot or an orphan log. */
interface CountedDose {
  label: TimeOfDayBlock;
  status: DoseStatus | 'pending';
  /** `null` when the medication no longer exists. */
  medicationId: string | null;
}

/**
 * Orphan logs on or before `todayKey`, grouped by date key (see the module
 * comment for the rules). Pure function of its arguments.
 */
function collectOrphanDoses(
  medications: Medication[],
  logs: DoseLogMap,
  todayKey: string,
): Map<string, CountedDose[]> {
  const medsById = new Map(medications.map((med) => [med.id, med]));
  const byDate = new Map<string, CountedDose[]>();
  for (const log of Object.values(logs)) {
    if (!log.slotSnapshot || !isValidDateKey(log.dateKey) || diffDaysBetweenKeys(log.dateKey, todayKey) < 0) {
      continue;
    }
    const med = medsById.get(log.medicationId);
    if (med && (!med.active || med.timeSlots.some((slot) => slot.id === log.slotId))) {
      continue;
    }
    const dose: CountedDose = { label: log.slotSnapshot.label, status: log.status, medicationId: med ? med.id : null };
    const day = byDate.get(log.dateKey);
    if (day) {
      day.push(dose);
    } else {
      byDate.set(log.dateKey, [dose]);
    }
  }
  return byDate;
}

/** Earlier of two optional date keys. */
function earlierKey(a: string | null, b: string | null): string | null {
  if (a === null || b === null) {
    return a ?? b;
  }
  return diffDaysBetweenKeys(a, b) < 0 ? b : a;
}

/**
 * Adherence summary for the 30 days ending at `todayKey`.
 * Pure function of its arguments; no hidden clock.
 */
export function computeAdherenceAnalytics(
  medications: Medication[],
  logs: DoseLogMap,
  todayKey: string,
): AdherenceAnalyticsSummary {
  let totalTaken30d = 0;
  let totalScheduled30d = 0;
  let totalSkipped30d = 0;
  let totalMissed30d = 0;

  let totalTaken7d = 0;
  let totalScheduled7d = 0;

  const byTimeOfDay: Record<TimeOfDayBlock, { taken: number; total: number; pct: number }> = {
    Morning: { taken: 0, total: 0, pct: 0 },
    Midday: { taken: 0, total: 0, pct: 0 },
    Evening: { taken: 0, total: 0, pct: 0 },
    Bedtime: { taken: 0, total: 0, pct: 0 },
  };

  const medCounter: Record<string, { taken: number; total: number }> = {};
  for (const med of medications) {
    medCounter[med.id] = { taken: 0, total: 0 };
  }

  const orphansByDate = collectOrphanDoses(medications, logs, todayKey);
  const dosesForDate = (dKey: string): CountedDose[] => {
    const scheduled = getScheduledDosesForDate(medications, logs, dKey, todayKey).map(
      (d): CountedDose => ({ label: d.slot.label, status: d.effectiveStatus, medicationId: d.medication.id }),
    );
    const orphans = orphansByDate.get(dKey);
    return orphans ? scheduled.concat(orphans) : scheduled;
  };

  // Evaluate past 30 days (including today for completed logs, or past 29 days + today)
  for (let offset = -29; offset <= 0; offset += 1) {
    const dKey = addDaysToKey(todayKey, offset);
    for (const d of dosesForDate(dKey)) {
      // On today, only count doses that have already been logged so pending evening doses don't penalize 30d rate
      if (offset === 0 && d.status === 'pending') {
        continue;
      }
      totalScheduled30d += 1;
      if (offset >= -6) {
        totalScheduled7d += 1;
      }

      byTimeOfDay[d.label].total += 1;
      const counter = d.medicationId === null ? undefined : medCounter[d.medicationId];
      if (counter) {
        counter.total += 1;
      }

      if (d.status === 'taken') {
        totalTaken30d += 1;
        if (offset >= -6) {
          totalTaken7d += 1;
        }
        byTimeOfDay[d.label].taken += 1;
        if (counter) {
          counter.taken += 1;
        }
      } else if (d.status === 'skipped') {
        totalSkipped30d += 1;
      } else if (d.status === 'missed') {
        totalMissed30d += 1;
      }
    }
  }

  (['Morning', 'Midday', 'Evening', 'Bedtime'] as TimeOfDayBlock[]).forEach((block) => {
    const item = byTimeOfDay[block];
    item.pct = item.total > 0 ? Math.round((item.taken / item.total) * 100) : 100;
  });

  // Compute the streak over the full medication history: from the earliest
  // valid startDate (clipped to MAX_STREAK_LOOKBACK_DAYS) through todayKey.
  // Days before a medication's own start are simply unscheduled (skipped).
  let earliestOrphanKey: string | null = null;
  for (const dKey of orphansByDate.keys()) {
    earliestOrphanKey = earlierKey(earliestOrphanKey, dKey);
  }
  const scanStart = earlierKey(earliestStreakScanStart(medications, todayKey), earliestOrphanKey);
  let currentStreakDays = 0;
  let bestStreakDays = 0;
  let runningStreak = 0;

  if (scanStart !== null) {
    const lookbackDays = Math.min(diffDaysBetweenKeys(scanStart, todayKey), MAX_STREAK_LOOKBACK_DAYS);
    for (let offset = -lookbackDays; offset <= 0; offset += 1) {
      const dKey = addDaysToKey(todayKey, offset);
      const doses = dosesForDate(dKey);
      if (doses.length === 0) {
        // No scheduled doses: neither breaks nor extends. When today itself is
        // empty, the current streak is yesterday's running streak (not zero).
        if (offset === 0) {
          currentStreakDays = runningStreak;
        }
        continue;
      }

      const allHandledWithoutMiss = doses.every((d) => d.status === 'taken' || d.status === 'skipped');
      const anyTaken = doses.some((d) => d.status === 'taken');

      if (offset === 0) {
        // If today is already 100% complete, include today in streak; if still in progress with no missed doses, keep yesterday's streak
        if (allHandledWithoutMiss && anyTaken) {
          runningStreak += 1;
          if (runningStreak > bestStreakDays) {
            bestStreakDays = runningStreak;
          }
        }
        currentStreakDays = runningStreak;
      } else if (allHandledWithoutMiss && anyTaken) {
        runningStreak += 1;
        if (runningStreak > bestStreakDays) {
          bestStreakDays = runningStreak;
        }
      } else {
        runningStreak = 0;
      }
    }
  }

  const thirtyDayAdherencePct =
    totalScheduled30d > 0 ? Math.round((totalTaken30d / totalScheduled30d) * 100) : 100;
  const sevenDayAdherencePct =
    totalScheduled7d > 0 ? Math.round((totalTaken7d / totalScheduled7d) * 100) : 100;

  const byMedication = medications
    .filter((m) => m.active)
    .map((medication) => {
      const counts = medCounter[medication.id];
      const pct = counts.total > 0 ? Math.round((counts.taken / counts.total) * 100) : 100;
      return {
        medication,
        taken: counts.taken,
        total: counts.total,
        pct,
      };
    });

  return {
    thirtyDayAdherencePct,
    sevenDayAdherencePct,
    currentStreakDays,
    bestStreakDays,
    totalTaken30d,
    totalScheduled30d,
    totalSkipped30d,
    totalMissed30d,
    byTimeOfDay,
    byMedication,
  };
}
