export type TimeOfDayBlock = 'Morning' | 'Midday' | 'Evening' | 'Bedtime';

export type MedicationForm =
  | 'Tablet'
  | 'Capsule'
  | 'Softgel'
  | 'Liquid'
  | 'Inhaler'
  | 'Sublingual';

export type ScheduleFrequency = 'daily' | 'specific_days' | 'interval';

export interface TimeSlot {
  id: string;
  label: TimeOfDayBlock;
  time: string; // "HH:mm" e.g. "08:00"
  doseUnits: number; // e.g. 1 or 2 pills
  reminderEnabled?: boolean; // defaults to true if undefined
  leadMinutes?: number; // minutes before scheduled time (0 = exact time)
}

export interface MedicationInventory {
  currentUnits: number;
  capacityUnits: number;
  lowThresholdUnits: number;
  lastRefilledAt: string; // YYYY-MM-DD
  nextFillDate?: string; // YYYY-MM-DD scheduled fill date in tool & Google Calendar
  pharmacyNote?: string; // e.g., "CVS Pharmacy #4102 · Rx #884920"
  googleCalendarEventId?: string; // Synced Google Calendar event ID
}

export interface Medication {
  id: string;
  name: string;
  genericName?: string;
  strength: string; // e.g., "20 mg", "1000 IU"
  form: MedicationForm;
  purpose: string; // e.g., "Lipid Management", "Blood Pressure", "Nutritional Supplement"
  instructions: string; // e.g., "Take with breakfast and a full glass of water"
  prescriber?: string;
  frequency: ScheduleFrequency;
  daysOfWeek?: number[]; // 0 (Sun) to 6 (Sat) if frequency === 'specific_days'
  intervalDays?: number; // e.g. every 2 days if frequency === 'interval'
  startDate: string; // YYYY-MM-DD
  timeSlots: TimeSlot[];
  inventory: MedicationInventory;
  active: boolean;
}

export type DoseStatus = 'taken' | 'skipped' | 'missed';

export interface DoseLogEntry {
  key: string; // `${dateKey}_${medicationId}_${slotId}`
  dateKey: string; // YYYY-MM-DD
  medicationId: string;
  slotId: string;
  status: DoseStatus;
  loggedAt: string; // HH:mm
  note?: string;
}

export type DoseLogMap = Record<string, DoseLogEntry>;

export interface ScheduledDoseInstance {
  key: string;
  dateKey: string;
  medication: Medication;
  slot: TimeSlot;
  log?: DoseLogEntry;
  effectiveStatus: 'taken' | 'skipped' | 'missed' | 'pending';
}

// Date Utilities (Timezone-safe local YYYY-MM-DD manipulation)
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseDateKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
}

export function addDaysToKey(dateKey: string, deltaDays: number): string {
  const dt = parseDateKey(dateKey);
  dt.setDate(dt.getDate() + deltaDays);
  return toDateKey(dt);
}

export function diffDaysBetweenKeys(startKey: string, endKey: string): number {
  const a = parseDateKey(startKey);
  const b = parseDateKey(endKey);
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export function formatReadableDate(dateKey: string, todayKey: string): string {
  const dt = parseDateKey(dateKey);
  const formatted = dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const diff = diffDaysBetweenKeys(todayKey, dateKey);
  if (diff === 0) return `Today · ${formatted}`;
  if (diff === -1) return `Yesterday · ${formatted}`;
  if (diff === 1) return `Tomorrow · ${formatted}`;
  return formatted;
}

export function formatShortDay(dateKey: string): {
  weekday: string;
  dayNum: string;
  monthShort: string;
} {
  const dt = parseDateKey(dateKey);
  return {
    weekday: dt.toLocaleDateString('en-US', {weekday: 'short'}),
    dayNum: String(dt.getDate()).padStart(2, '0'),
    monthShort: dt.toLocaleDateString('en-US', {month: 'short'}),
  };
}

export function getStartOfWeekKey(dateKey: string): string {
  const dt = parseDateKey(dateKey);
  const day = dt.getDay(); // 0 is Sun, 1 is Mon
  const diffToMonday = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diffToMonday);
  return toDateKey(dt);
}

export function getWeekDateKeys(referenceDateKey: string): string[] {
  const mondayKey = getStartOfWeekKey(referenceDateKey);
  return Array.from({length: 7}, (_, idx) => addDaysToKey(mondayKey, idx));
}

export function isMedicationScheduledOnDate(
  med: Medication,
  dateKey: string
): boolean {
  if (!med.active) return false;
  const daysSinceStart = diffDaysBetweenKeys(med.startDate, dateKey);
  if (daysSinceStart < 0) return false;

  if (med.frequency === 'daily') {
    return true;
  }

  if (med.frequency === 'specific_days') {
    const dt = parseDateKey(dateKey);
    const dow = dt.getDay();
    return Array.isArray(med.daysOfWeek) && med.daysOfWeek.includes(dow);
  }

  if (med.frequency === 'interval') {
    const step = Math.max(1, med.intervalDays || 2);
    return daysSinceStart % step === 0;
  }

  return true;
}

export function buildDoseKey(
  dateKey: string,
  medicationId: string,
  slotId: string
): string {
  return `${dateKey}_${medicationId}_${slotId}`;
}

export function getScheduledDosesForDate(
  medications: Medication[],
  logs: DoseLogMap,
  dateKey: string,
  todayKey: string
): ScheduledDoseInstance[] {
  const instances: ScheduledDoseInstance[] = [];
  const isPastDay = diffDaysBetweenKeys(todayKey, dateKey) < 0;

  for (const med of medications) {
    if (!isMedicationScheduledOnDate(med, dateKey)) continue;
    for (const slot of med.timeSlots) {
      const key = buildDoseKey(dateKey, med.id, slot.id);
      const log = logs[key];
      let effectiveStatus: ScheduledDoseInstance['effectiveStatus'] = 'pending';

      if (log) {
        effectiveStatus = log.status;
      } else if (isPastDay) {
        effectiveStatus = 'missed';
      }

      instances.push({
        key,
        dateKey,
        medication: med,
        slot,
        log,
        effectiveStatus,
      });
    }
  }

  return instances.sort((a, b) => a.slot.time.localeCompare(b.slot.time));
}

export function estimateDaysOfSupplyRemaining(med: Medication): number {
  if (med.inventory.currentUnits <= 0) return 0;
  const dailyUnitsPerScheduledDay = med.timeSlots.reduce(
    (acc, s) => acc + s.doseUnits,
    0
  );
  if (dailyUnitsPerScheduledDay <= 0) return 999;

  let activeDaysPerWeek = 7;
  if (med.frequency === 'specific_days') {
    activeDaysPerWeek = Math.max(1, med.daysOfWeek?.length || 1);
  } else if (med.frequency === 'interval') {
    activeDaysPerWeek = 7 / Math.max(1, med.intervalDays || 2);
  }

  const avgDailyConsumption =
    (dailyUnitsPerScheduledDay * activeDaysPerWeek) / 7;
  return Math.floor(med.inventory.currentUnits / avgDailyConsumption);
}

export function computeRecommendedNextFillDate(
  med: Medication,
  todayKey: string
): string {
  const daysLeft = estimateDaysOfSupplyRemaining(med);
  // Recommend filling 2 days before depletion (or today if <= 2 days left)
  const targetOffset = Math.max(0, daysLeft - 2);
  return addDaysToKey(todayKey, targetOffset);
}

export interface AdherenceAnalyticsSummary {
  thirtyDayAdherencePct: number;
  sevenDayAdherencePct: number;
  currentStreakDays: number;
  bestStreakDays: number;
  totalTaken30d: number;
  totalScheduled30d: number;
  totalSkipped30d: number;
  totalMissed30d: number;
  byTimeOfDay: Record<
    TimeOfDayBlock,
    {taken: number; total: number; pct: number}
  >;
  byMedication: Array<{
    medication: Medication;
    taken: number;
    total: number;
    pct: number;
  }>;
}

export function computeAdherenceAnalytics(
  medications: Medication[],
  logs: DoseLogMap,
  todayKey: string
): AdherenceAnalyticsSummary {
  let totalTaken30d = 0;
  let totalScheduled30d = 0;
  let totalSkipped30d = 0;
  let totalMissed30d = 0;

  let totalTaken7d = 0;
  let totalScheduled7d = 0;

  const byTimeOfDay: Record<
    TimeOfDayBlock,
    {taken: number; total: number; pct: number}
  > = {
    Morning: {taken: 0, total: 0, pct: 0},
    Midday: {taken: 0, total: 0, pct: 0},
    Evening: {taken: 0, total: 0, pct: 0},
    Bedtime: {taken: 0, total: 0, pct: 0},
  };

  const medCounter: Record<string, {taken: number; total: number}> = {};
  for (const med of medications) {
    medCounter[med.id] = {taken: 0, total: 0};
  }

  // Evaluate past 30 days (including today for completed logs, or past 29 days + today)
  for (let offset = -29; offset <= 0; offset++) {
    const dKey = addDaysToKey(todayKey, offset);
    const doses = getScheduledDosesForDate(medications, logs, dKey, todayKey);
    for (const d of doses) {
      // On today, only count doses that have already been logged so pending evening doses don't penalize 30d rate
      if (offset === 0 && d.effectiveStatus === 'pending') {
        continue;
      }
      totalScheduled30d++;
      if (offset >= -6) totalScheduled7d++;

      byTimeOfDay[d.slot.label].total++;
      if (medCounter[d.medication.id]) {
        medCounter[d.medication.id].total++;
      }

      if (d.effectiveStatus === 'taken') {
        totalTaken30d++;
        if (offset >= -6) totalTaken7d++;
        byTimeOfDay[d.slot.label].taken++;
        if (medCounter[d.medication.id]) {
          medCounter[d.medication.id].taken++;
        }
      } else if (d.effectiveStatus === 'skipped') {
        totalSkipped30d++;
      } else if (d.effectiveStatus === 'missed') {
        totalMissed30d++;
      }
    }
  }

  (['Morning', 'Midday', 'Evening', 'Bedtime'] as TimeOfDayBlock[]).forEach(
    (block) => {
      const item = byTimeOfDay[block];
      item.pct =
        item.total > 0 ? Math.round((item.taken / item.total) * 100) : 100;
    }
  );

  // Compute streaks over the last 60 days
  let currentStreakDays = 0;
  let bestStreakDays = 0;
  let runningStreak = 0;

  for (let offset = -45; offset <= 0; offset++) {
    const dKey = addDaysToKey(todayKey, offset);
    const doses = getScheduledDosesForDate(medications, logs, dKey, todayKey);
    if (doses.length === 0) continue;

    const allHandledWithoutMiss = doses.every(
      (d) => d.effectiveStatus === 'taken' || d.effectiveStatus === 'skipped'
    );
    const anyTaken = doses.some((d) => d.effectiveStatus === 'taken');

    if (offset === 0) {
      // If today is already 100% complete, include today in streak; if still in progress with no missed doses, keep yesterday's streak
      if (allHandledWithoutMiss && anyTaken) {
        runningStreak++;
        if (runningStreak > bestStreakDays) bestStreakDays = runningStreak;
      }
      currentStreakDays = runningStreak;
    } else {
      if (allHandledWithoutMiss && anyTaken) {
        runningStreak++;
        if (runningStreak > bestStreakDays) bestStreakDays = runningStreak;
      } else {
        runningStreak = 0;
      }
    }
  }

  const thirtyDayAdherencePct =
    totalScheduled30d > 0
      ? Math.round((totalTaken30d / totalScheduled30d) * 100)
      : 100;
  const sevenDayAdherencePct =
    totalScheduled7d > 0
      ? Math.round((totalTaken7d / totalScheduled7d) * 100)
      : 100;

  const byMedication = medications
    .filter((m) => m.active)
    .map((medication) => {
      const counts = medCounter[medication.id] || {taken: 0, total: 0};
      const pct =
        counts.total > 0
          ? Math.round((counts.taken / counts.total) * 100)
          : 100;
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

// Seed Data Generator for Immediate Multi-Horizon Demo Impact
export function createInitialSeedData(todayKey: string): {
  medications: Medication[];
  logs: DoseLogMap;
} {
  const startDateKey = addDaysToKey(todayKey, -60);
  const recentRefillKey = addDaysToKey(todayKey, -18);

  const medications: Medication[] = [
    {
      id: 'med-lisinopril',
      name: 'Lisinopril',
      genericName: 'Lisinopril Dihydrate',
      strength: '10 mg',
      form: 'Tablet',
      purpose: 'Cardiovascular · Blood Pressure',
      instructions: 'Take once daily in the morning with water',
      prescriber: 'Dr. Elena Rostova, MD',
      frequency: 'daily',
      startDate: startDateKey,
      timeSlots: [
        {id: 'slot-lis-am', label: 'Morning', time: '07:30', doseUnits: 1},
      ],
      inventory: {
        currentUnits: 6, // Intentionally below threshold (10) to trigger Low Supply alert
        capacityUnits: 30,
        lowThresholdUnits: 10,
        lastRefilledAt: addDaysToKey(todayKey, -24),
        nextFillDate: addDaysToKey(todayKey, 4),
        pharmacyNote: 'Walgreens #0419 · Rx #449102',
      },
      active: true,
    },
    {
      id: 'med-metformin',
      name: 'Metformin ER',
      genericName: 'Metformin Hydrochloride',
      strength: '500 mg',
      form: 'Tablet',
      purpose: 'Metabolic · Glycemic Control',
      instructions: 'Take with morning and evening meals to reduce GI upset',
      prescriber: 'Dr. Elena Rostova, MD',
      frequency: 'daily',
      startDate: startDateKey,
      timeSlots: [
        {id: 'slot-met-am', label: 'Morning', time: '08:00', doseUnits: 1},
        {id: 'slot-met-pm', label: 'Evening', time: '18:30', doseUnits: 1},
      ],
      inventory: {
        currentUnits: 42,
        capacityUnits: 60,
        lowThresholdUnits: 14,
        lastRefilledAt: recentRefillKey,
        nextFillDate: addDaysToKey(todayKey, 19),
        pharmacyNote: 'Walgreens #0419 · Rx #449108',
      },
      active: true,
    },
    {
      id: 'med-vitd3',
      name: 'Vitamin D3 + K2',
      genericName: 'Cholecalciferol · MK-7',
      strength: '2000 IU',
      form: 'Softgel',
      purpose: 'Bone & Immune Support',
      instructions: 'Take midday with a meal containing healthy fats',
      prescriber: 'Clinical Nutrition Protocol',
      frequency: 'daily',
      startDate: startDateKey,
      timeSlots: [
        {id: 'slot-vitd-mid', label: 'Midday', time: '12:30', doseUnits: 1},
      ],
      inventory: {
        currentUnits: 54,
        capacityUnits: 90,
        lowThresholdUnits: 15,
        lastRefilledAt: addDaysToKey(todayKey, -36),
        nextFillDate: addDaysToKey(todayKey, 50),
        pharmacyNote: 'Thorne Dispensary Order',
      },
      active: true,
    },
    {
      id: 'med-atorvastatin',
      name: 'Atorvastatin',
      genericName: 'Atorvastatin Calcium',
      strength: '20 mg',
      form: 'Tablet',
      purpose: 'Lipid & Cholesterol Management',
      instructions: 'Take at bedtime; avoid grapefruit juice',
      prescriber: 'Dr. Marcus Vance, FACC',
      frequency: 'daily',
      startDate: startDateKey,
      timeSlots: [
        {id: 'slot-ator-bed', label: 'Bedtime', time: '21:30', doseUnits: 1},
      ],
      inventory: {
        currentUnits: 5, // Low supply alert #2
        capacityUnits: 30,
        lowThresholdUnits: 7,
        lastRefilledAt: addDaysToKey(todayKey, -25),
        nextFillDate: addDaysToKey(todayKey, 3),
        pharmacyNote: 'CVS Caremark · Rx #901245',
      },
      active: true,
    },
    {
      id: 'med-magnesium',
      name: 'Magnesium Glycinate',
      genericName: 'Chelated Magnesium Bisglycinate',
      strength: '200 mg',
      form: 'Capsule',
      purpose: 'Sleep Architecture & Neuromuscular Recovery',
      instructions: 'Take 2 capsules 30–60 minutes before sleep',
      prescriber: 'Self-Directed Protocol',
      frequency: 'daily',
      startDate: startDateKey,
      timeSlots: [
        {id: 'slot-mag-bed', label: 'Bedtime', time: '22:00', doseUnits: 2},
      ],
      inventory: {
        currentUnits: 68,
        capacityUnits: 120,
        lowThresholdUnits: 20,
        lastRefilledAt: recentRefillKey,
        nextFillDate: addDaysToKey(todayKey, 32),
        pharmacyNote: 'Pure Encapsulations Refill',
      },
      active: true,
    },
    {
      id: 'med-b12',
      name: 'Methylcobalamin B12',
      genericName: 'Activated Vitamin B12',
      strength: '1000 mcg',
      form: 'Sublingual',
      purpose: 'Neurological & Energy Metabolism',
      instructions: 'Dissolve under tongue on Mon, Wed, Fri mornings',
      prescriber: 'Clinical Nutrition Protocol',
      frequency: 'specific_days',
      daysOfWeek: [1, 3, 5], // Mon, Wed, Fri
      startDate: startDateKey,
      timeSlots: [
        {id: 'slot-b12-am', label: 'Morning', time: '08:15', doseUnits: 1},
      ],
      inventory: {
        currentUnits: 22,
        capacityUnits: 30,
        lowThresholdUnits: 6,
        lastRefilledAt: addDaysToKey(todayKey, -20),
        nextFillDate: addDaysToKey(todayKey, 45),
        pharmacyNote: 'Local Compounding Pharmacy',
      },
      active: true,
    },
  ];

  const logs: DoseLogMap = {};

  // Populate 40 days of realistic historical logs
  for (let offset = -40; offset <= 0; offset++) {
    const dKey = addDaysToKey(todayKey, offset);

    for (const med of medications) {
      if (!isMedicationScheduledOnDate(med, dKey)) continue;

      for (const slot of med.timeSlots) {
        const key = buildDoseKey(dKey, med.id, slot.id);

        if (offset === 0) {
          // On Today, mark Morning doses as already taken so user sees both Taken & Pending states immediately
          if (slot.label === 'Morning') {
            logs[key] = {
              key,
              dateKey: dKey,
              medicationId: med.id,
              slotId: slot.id,
              status: 'taken',
              loggedAt: slot.time,
            };
          }
          continue;
        }

        // Keep the last 11 days 100% adherent to establish a strong 11-day streak
        if (offset >= -11) {
          logs[key] = {
            key,
            dateKey: dKey,
            medicationId: med.id,
            slotId: slot.id,
            status: 'taken',
            loggedAt: slot.time,
          };
          continue;
        }

        // Introduce realistic occasional skips or misses in earlier weeks for rich heatmap contrast
        if (offset === -12 && slot.label === 'Bedtime') {
          logs[key] = {
            key,
            dateKey: dKey,
            medicationId: med.id,
            slotId: slot.id,
            status: 'missed',
            loggedAt: slot.time,
            note: 'Fell asleep early while traveling',
          };
          continue;
        }

        if (offset === -17 && med.id === 'med-metformin' && slot.label === 'Evening') {
          logs[key] = {
            key,
            dateKey: dKey,
            medicationId: med.id,
            slotId: slot.id,
            status: 'skipped',
            loggedAt: '18:45',
            note: 'Skipped due to fasting lab prep',
          };
          continue;
        }

        if (offset === -23 && slot.label === 'Midday') {
          logs[key] = {
            key,
            dateKey: dKey,
            medicationId: med.id,
            slotId: slot.id,
            status: 'missed',
            loggedAt: slot.time,
          };
          continue;
        }

        if (offset === -29 && slot.label === 'Bedtime' && med.id === 'med-magnesium') {
          logs[key] = {
            key,
            dateKey: dKey,
            medicationId: med.id,
            slotId: slot.id,
            status: 'skipped',
            loggedAt: '22:10',
            note: 'Out of home overnight',
          };
          continue;
        }

        logs[key] = {
          key,
          dateKey: dKey,
          medicationId: med.id,
          slotId: slot.id,
          status: 'taken',
          loggedAt: slot.time,
        };
      }
    }
  }

  return {medications, logs};
}
