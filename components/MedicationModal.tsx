'use client';

import React, {useState} from 'react';
import {X, Plus, Trash2, Bell, BellOff} from 'lucide-react';
import {
  Medication,
  MedicationForm,
  ScheduleFrequency,
  TimeOfDayBlock,
  TimeSlot,
} from '@/lib/medication-data';

interface MedicationModalProps {
  isOpen: boolean;
  initialMedication: Medication | null;
  todayKey: string;
  onClose: () => void;
  onSave: (medication: Medication) => void;
}

const FORMS: MedicationForm[] = [
  'Tablet',
  'Capsule',
  'Softgel',
  'Sublingual',
  'Liquid',
  'Inhaler',
];

const TIME_BLOCKS: TimeOfDayBlock[] = [
  'Morning',
  'Midday',
  'Evening',
  'Bedtime',
];

const DEFAULT_TIME_FOR_BLOCK: Record<TimeOfDayBlock, string> = {
  Morning: '08:00',
  Midday: '12:30',
  Evening: '18:30',
  Bedtime: '21:30',
};

const WEEKDAYS = [
  {day: 1, label: 'Mon'},
  {day: 2, label: 'Tue'},
  {day: 3, label: 'Wed'},
  {day: 4, label: 'Thu'},
  {day: 5, label: 'Fri'},
  {day: 6, label: 'Sat'},
  {day: 0, label: 'Sun'},
];

export default function MedicationModal({
  isOpen,
  initialMedication,
  todayKey,
  onClose,
  onSave,
}: MedicationModalProps) {
  if (!isOpen) return null;

  return (
    <MedicationModalForm
      key={initialMedication ? initialMedication.id : 'new-medication'}
      initialMedication={initialMedication}
      todayKey={todayKey}
      onClose={onClose}
      onSave={onSave}
    />
  );
}

function MedicationModalForm({
  initialMedication,
  todayKey,
  onClose,
  onSave,
}: Omit<MedicationModalProps, 'isOpen'>) {
  const [name, setName] = useState(initialMedication?.name || '');
  const [genericName, setGenericName] = useState(
    initialMedication?.genericName || ''
  );
  const [strength, setStrength] = useState(
    initialMedication?.strength || '10 mg'
  );
  const [form, setForm] = useState<MedicationForm>(
    initialMedication?.form || 'Tablet'
  );
  const [purpose, setPurpose] = useState(
    initialMedication?.purpose || 'Cardiovascular Support'
  );
  const [instructions, setInstructions] = useState(
    initialMedication?.instructions || 'Take with water'
  );
  const [prescriber, setPrescriber] = useState(
    initialMedication?.prescriber || ''
  );
  const [frequency, setFrequency] = useState<ScheduleFrequency>(
    initialMedication?.frequency || 'daily'
  );
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(
    initialMedication?.daysOfWeek || [1, 3, 5]
  );
  const [intervalDays, setIntervalDays] = useState<number>(
    initialMedication?.intervalDays || 2
  );
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>(() => {
    if (initialMedication && initialMedication.timeSlots.length > 0) {
      return initialMedication.timeSlots.map((s) => ({
        ...s,
        reminderEnabled: s.reminderEnabled !== false,
        leadMinutes: s.leadMinutes || 0,
      }));
    }
    return [
      {
        id: 'slot-1',
        label: 'Morning',
        time: '08:00',
        doseUnits: 1,
        reminderEnabled: true,
        leadMinutes: 0,
      },
    ];
  });
  const [currentUnits, setCurrentUnits] = useState<number>(
    initialMedication?.inventory.currentUnits ?? 30
  );
  const [capacityUnits, setCapacityUnits] = useState<number>(
    initialMedication?.inventory.capacityUnits ?? 30
  );
  const [lowThresholdUnits, setLowThresholdUnits] = useState<number>(
    initialMedication?.inventory.lowThresholdUnits ?? 7
  );
  const [nextFillDate, setNextFillDate] = useState<string>(
    initialMedication?.inventory.nextFillDate || ''
  );
  const [pharmacyNote, setPharmacyNote] = useState<string>(
    initialMedication?.inventory.pharmacyNote || ''
  );
  const [errorMessage, setErrorMessage] = useState<string>('');

  const handleToggleDay = (day: number) => {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleAddSlot = () => {
    const nextBlock: TimeOfDayBlock =
      timeSlots.length === 1
        ? 'Evening'
        : timeSlots.length === 2
        ? 'Bedtime'
        : 'Midday';
    setTimeSlots((prev) => [
      ...prev,
      {
        id: `slot-${Date.now()}-${prev.length}`,
        label: nextBlock,
        time: DEFAULT_TIME_FOR_BLOCK[nextBlock],
        doseUnits: 1,
        reminderEnabled: true,
        leadMinutes: 0,
      },
    ]);
  };

  const handleRemoveSlot = (id: string) => {
    if (timeSlots.length <= 1) return;
    setTimeSlots((prev) => prev.filter((s) => s.id !== id));
  };

  const handleUpdateSlot = (
    id: string,
    patch: Partial<Omit<TimeSlot, 'id'>>
  ) => {
    setTimeSlots((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const updated = {...s, ...patch};
        if (patch.label && !patch.time) {
          updated.time = DEFAULT_TIME_FOR_BLOCK[patch.label];
        }
        return updated;
      })
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMessage('Please enter a medication or supplement name.');
      return;
    }
    if (!strength.trim()) {
      setErrorMessage('Please specify the dosage strength (e.g., 20 mg).');
      return;
    }
    if (frequency === 'specific_days' && daysOfWeek.length === 0) {
      setErrorMessage('Select at least one day of the week.');
      return;
    }

    const medication: Medication = {
      id: initialMedication ? initialMedication.id : `med-${Date.now()}`,
      name: name.trim(),
      genericName: genericName.trim() || undefined,
      strength: strength.trim(),
      form,
      purpose: purpose.trim() || 'Daily Regimen',
      instructions: instructions.trim() || 'Take as directed',
      prescriber: prescriber.trim() || undefined,
      frequency,
      daysOfWeek: frequency === 'specific_days' ? daysOfWeek : undefined,
      intervalDays:
        frequency === 'interval' ? Math.max(1, intervalDays) : undefined,
      startDate: initialMedication ? initialMedication.startDate : todayKey,
      timeSlots,
      inventory: {
        currentUnits: Math.max(0, Number(currentUnits) || 0),
        capacityUnits: Math.max(
          1,
          Number(capacityUnits) || Number(currentUnits) || 30
        ),
        lowThresholdUnits: Math.max(1, Number(lowThresholdUnits) || 5),
        lastRefilledAt: initialMedication
          ? initialMedication.inventory.lastRefilledAt
          : todayKey,
        nextFillDate: nextFillDate.trim() || undefined,
        pharmacyNote: pharmacyNote.trim() || undefined,
        googleCalendarEventId:
          initialMedication?.inventory.googleCalendarEventId,
      },
      active: initialMedication ? initialMedication.active : true,
    };

    onSave(medication);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="med-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg max-w-2xl w-full overflow-hidden shadow-lg my-8">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2
              id="med-modal-title"
              className="text-lg font-semibold text-slate-900"
              style={{fontFamily: 'var(--font-display), sans-serif'}}
            >
              {initialMedication
                ? `Edit ${initialMedication.name}`
                : 'Add Medication to Regimen'}
            </h2>
            <p className="text-xs text-slate-500">
              Configure dosage strength, schedule cadence, and refill inventory
              thresholds
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-6 space-y-5 max-h-[80vh] overflow-y-auto"
        >
          {errorMessage && (
            <div className="p-3 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md">
              {errorMessage}
            </div>
          )}

          {/* Primary Medication Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Medication / Supplement Name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Rosuvastatin or Omega-3 EPA"
                className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-teal-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Generic / Compound Name (Optional)
              </label>
              <input
                type="text"
                value={genericName}
                onChange={(e) => setGenericName(e.target.value)}
                placeholder="e.g., Rosuvastatin Calcium"
                className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-teal-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Dosage Strength *
              </label>
              <input
                type="text"
                required
                value={strength}
                onChange={(e) => setStrength(e.target.value)}
                placeholder="e.g., 20 mg, 1000 IU, 500 mcg"
                className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-teal-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Dosage Form
              </label>
              <select
                value={form}
                onChange={(e) => setForm(e.target.value as MedicationForm)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-teal-600 cursor-pointer"
              >
                {FORMS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Clinical Indication / Purpose
              </label>
              <input
                type="text"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="e.g., Blood Pressure, Lipid Control"
                className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-teal-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Prescriber / Protocol Source
              </label>
              <input
                type="text"
                value={prescriber}
                onChange={(e) => setPrescriber(e.target.value)}
                placeholder="e.g., Dr. Elena Rostova, MD"
                className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-teal-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Administration Instructions
            </label>
            <input
              type="text"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g., Take with morning meal and a full glass of water"
              className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-teal-600"
            />
          </div>

          {/* Schedule Frequency & Time Slots */}
          <div className="pt-3 border-t border-slate-200 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-xs font-semibold text-slate-800">
                Schedule Frequency
              </label>
              <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md">
                {(
                  [
                    {id: 'daily', label: 'Every Day'},
                    {id: 'specific_days', label: 'Specific Days'},
                    {id: 'interval', label: 'Day Interval'},
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setFrequency(opt.id)}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                      frequency === opt.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {frequency === 'specific_days' && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-500">Active Days:</span>
                {WEEKDAYS.map(({day, label}) => {
                  const selected = daysOfWeek.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => handleToggleDay(day)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                        selected
                          ? 'bg-teal-600 text-white border-teal-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}

            {frequency === 'interval' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600">Take once every</span>
                <input
                  type="number"
                  min={2}
                  max={30}
                  value={intervalDays}
                  onChange={(e) =>
                    setIntervalDays(Math.max(2, parseInt(e.target.value) || 2))
                  }
                  className="w-20 px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-md text-slate-900"
                />
                <span className="text-xs text-slate-600">days</span>
              </div>
            )}

            {/* Time Slots List */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800">
                  Daily Scheduled Time Slots
                </span>
                <button
                  type="button"
                  onClick={handleAddSlot}
                  className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Time Slot
                </button>
              </div>

              {timeSlots.map((slot) => {
                const isReminder = slot.reminderEnabled !== false;
                return (
                  <div
                    key={slot.id}
                    className="bg-slate-50 p-3 rounded-md border border-slate-200 space-y-2"
                  >
                    <div className="grid grid-cols-12 gap-2.5 items-center">
                      <div className="col-span-5 sm:col-span-4">
                        <select
                          value={slot.label}
                          onChange={(e) =>
                            handleUpdateSlot(slot.id, {
                              label: e.target.value as TimeOfDayBlock,
                            })
                          }
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded text-slate-900"
                        >
                          {TIME_BLOCKS.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-4 sm:col-span-4">
                        <input
                          type="time"
                          value={slot.time}
                          onChange={(e) =>
                            handleUpdateSlot(slot.id, {time: e.target.value})
                          }
                          className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded text-slate-900"
                        />
                      </div>
                      <div className="col-span-2 sm:col-span-3 flex items-center gap-1.5">
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={slot.doseUnits}
                          onChange={(e) =>
                            handleUpdateSlot(slot.id, {
                              doseUnits:
                                Math.max(1, parseInt(e.target.value) || 1),
                            })
                          }
                          className="w-14 px-2 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded text-slate-900"
                        />
                        <span className="hidden sm:inline text-xs text-slate-500">
                          units
                        </span>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        {timeSlots.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveSlot(slot.id)}
                            aria-label="Remove time slot"
                            className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Per-Slot Reminder Configuration */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-200/70 text-xs">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateSlot(slot.id, {
                              reminderEnabled: !isReminder,
                            })
                          }
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                            isReminder
                              ? 'bg-teal-100/70 text-teal-800 border border-teal-200'
                              : 'bg-white text-slate-500 border border-slate-200'
                          }`}
                        >
                          {isReminder ? (
                            <>
                              <Bell className="w-3 h-3 text-teal-600" />
                              <span>Reminder Alert Active</span>
                            </>
                          ) : (
                            <>
                              <BellOff className="w-3 h-3 text-slate-400" />
                              <span>Reminder Muted</span>
                            </>
                          )}
                        </button>

                        {isReminder && (
                          <div className="flex items-center gap-1 text-[11px] text-slate-600">
                            <span>Lead time:</span>
                            <select
                              value={slot.leadMinutes || 0}
                              onChange={(e) =>
                                handleUpdateSlot(slot.id, {
                                  leadMinutes:
                                    parseInt(e.target.value, 10) || 0,
                                })
                              }
                              className="px-1.5 py-0.5 text-[11px] bg-white border border-slate-200 rounded text-slate-800"
                            >
                              <option value={0}>At scheduled time</option>
                              <option value={5}>5 min before</option>
                              <option value={10}>10 min before</option>
                              <option value={15}>15 min before</option>
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cabinet Inventory Settings */}
          <div className="pt-3 border-t border-slate-200 space-y-3">
            <span className="block text-xs font-semibold text-slate-800">
              Cabinet Inventory, Fill Date & Low-Supply Alert
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-slate-600 mb-1">
                  Current Supply (Units)
                </label>
                <input
                  type="number"
                  min={0}
                  max={2000}
                  value={currentUnits}
                  onChange={(e) =>
                    setCurrentUnits(Math.max(0, parseInt(e.target.value) || 0))
                  }
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-md text-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">
                  Full Bottle Capacity
                </label>
                <input
                  type="number"
                  min={1}
                  max={2000}
                  value={capacityUnits}
                  onChange={(e) =>
                    setCapacityUnits(Math.max(1, parseInt(e.target.value) || 30))
                  }
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-md text-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">
                  Low-Supply Alert At (≤ Units)
                </label>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={lowThresholdUnits}
                  onChange={(e) =>
                    setLowThresholdUnits(
                      Math.max(1, parseInt(e.target.value) || 7)
                    )
                  }
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-md text-slate-900"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <div>
                <label className="block text-xs text-slate-600 mb-1">
                  Next Prescription Fill Date (Tool & Google Calendar)
                </label>
                <input
                  type="date"
                  value={nextFillDate}
                  onChange={(e) => setNextFillDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-teal-600"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">
                  Pharmacy / Rx Reference Note (Optional)
                </label>
                <input
                  type="text"
                  value={pharmacyNote}
                  onChange={(e) => setPharmacyNote(e.target.value)}
                  placeholder="e.g., Walgreens #0419 · Rx #449102"
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-teal-600"
                />
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-md transition-colors cursor-pointer"
            >
              {initialMedication ? 'Save Changes' : 'Add to Regimen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
