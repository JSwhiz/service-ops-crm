import type { CreatePositionInput, ScheduleRevision } from '@/entities/object/model/object-scheduling.types';

/** Editable values stay strings until validation/serialization at the API boundary. */
export interface IntervalDraft {
  key: string;
  start: string;
  end: string;
  nextDay: boolean;
  contourId: string | null;
}
export interface AssignmentDraft {
  employeeId: string;
  employeeName: string;
  startDate: string;
  endDate: string;
}
export interface GroupDraft {
  key: string;
  name: string;
  offset: string;
  assignments: AssignmentDraft[];
  intervals: IntervalDraft[];
}
export interface PositionDraft {
  key: string;
  name: string;
  headcount: string;
  requiredPerShift: string;
  preset: string;
  cycle: boolean[];
  weekdays: number[];
  anchorDate: string;
  effectiveDate: string;
  intervals: IntervalDraft[];
  groups: GroupDraft[];
  exceptions: { date: string; working: boolean }[];
}
export const schedulePresets = [
  { value: 'weekly', label: '5/2 — понедельник–пятница' },
  { value: '2/2', label: '2/2 — стандартный' },
  { value: '3/3', label: '3/3' },
  { value: '1/3', label: '1/3' },
  { value: '5/2', label: '5 рабочих / 2 отдыха — скользящий цикл' },
  { value: 'custom', label: 'Своя последовательность' },
];
export function applyPreset(draft: PositionDraft, preset: string): PositionDraft {
  const [work, rest] = preset === 'weekly' ? [5, 2] : preset.split('/').map(Number);
  if (!work || !rest) return { ...draft, preset };
  const length = work + rest;
  const phase = Number(draft.groups[0]?.offset ?? 0);
  const offsets = preset === '1/3' ? [phase, phase + 1, phase + 2, phase + 3] : preset === '2/2' || preset === '3/3' ? [phase, phase + work] : [phase];
  const groups = [...draft.groups];
  const modulo = (offset: number): number => ((offset % length) + length) % length;
  for (const offset of offsets) {
    if (groups.some((group) => modulo(Number(group.offset)) === modulo(offset))) continue;
    groups.push({ key: crypto.randomUUID(), name: `Группа ${groups.length + 1}`, offset: String(offset), assignments: [],
      intervals: (draft.groups[0]?.intervals ?? draft.intervals).map((interval) => ({ ...interval, key: crypto.randomUUID() })),
    });
  }
  return {
    ...draft, preset,
    cycle: [...Array<boolean>(work).fill(true), ...Array<boolean>(rest).fill(false)],
    weekdays: [1, 2, 3, 4, 5],
    // Preserve keys, assignments and intervals; offer only missing partner phases.
    groups,
  };
}
export function newPositionDraft(): PositionDraft {
  return applyPreset({
    key: crypto.randomUUID(), name: '', headcount: '', requiredPerShift: '', preset: 'weekly',
    cycle: [], weekdays: [], anchorDate: '', effectiveDate: '',
    intervals: [{ key: crypto.randomUUID(), start: '09:00', end: '18:00', nextDay: false, contourId: null }], groups: [], exceptions: [],
  }, 'weekly');
}

export function positionPayload(value: PositionDraft): CreatePositionInput {
  if (!value.name.trim()) throw new Error('Укажите название позиции.');
  if (!value.effectiveDate) throw new Error('Укажите дату начала действия графика.');
  const integer = (input: string, label: string, min: number, max: number): number => {
    const number = Number(input);
    if (input.trim() === '' || !Number.isInteger(number) || number < min || number > max) throw new Error(`Проверьте поле «${label}».`);
    return number;
  };
  return {
    clientKey: value.key, name: value.name.trim(),
    headcount: value.headcount.trim() === '' ? null : integer(value.headcount, 'Количество мест', 0, 10000),
    ...(value.requiredPerShift.trim() === '' ? {} : { requiredPerShift: integer(value.requiredPerShift, 'Нужно одновременно на смене', 1, 10000) }),
    effectiveFrom: value.effectiveDate,
    template: {
      kind: value.preset === 'weekly' ? 'weekly' : value.preset === 'custom' ? 'custom' : 'cycle',
      ...(value.preset === 'weekly' ? { weekdays: value.weekdays } : { anchorDate: value.anchorDate || null, sequence: value.cycle }),
      exceptions: value.exceptions,
    },
    groups: value.groups.map((group) => {
      if (!group.name.trim()) throw new Error('Укажите название каждой группы.');
      return {
        key: group.key, name: group.name.trim(), offsetDays: integer(group.offset, 'Сдвиг группы', -3660, 3660),
        timeRanges: group.intervals.map((interval) => {
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(interval.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(interval.end)) throw new Error('Укажите время в формате ЧЧ:ММ.');
          return { key: interval.key, start: interval.start, end: interval.end, endDayOffset: interval.nextDay ? 1 : 0, contourId: interval.contourId };
        }),
        assignments: group.assignments.map((assignment) => {
          if (!assignment.startDate) throw new Error(`Укажите начало назначения: ${assignment.employeeName}.`);
          if (assignment.endDate && assignment.endDate < assignment.startDate) throw new Error('Окончание назначения раньше начала.');
          return { employeeId: assignment.employeeId, from: assignment.startDate, to: assignment.endDate || null };
        }),
      };
    }),
  };
}

export function revisionDraft(clientKey: string, revision: ScheduleRevision, employeeNames: Map<string, string>): PositionDraft {
  const intervals = revision.groups[0]?.timeRanges.map((item) => ({ key: item.key, start: item.start, end: item.end, nextDay: item.endDayOffset === 1, contourId: item.contourId ?? null })) ?? [];
  return {
    key: clientKey, name: revision.name, headcount: revision.headcount === null ? '' : String(revision.headcount),
    requiredPerShift: String(revision.requiredPerShift), preset: revision.template.kind === 'weekly' ? 'weekly' : 'custom',
    cycle: revision.template.sequence ?? [], weekdays: revision.template.weekdays ?? [],
    anchorDate: revision.template.anchorDate ?? '', effectiveDate: '', intervals,
    exceptions: revision.template.exceptions ?? [],
    groups: revision.groups.map((group) => ({
      key: group.key, name: group.name, offset: String(group.offsetDays),
      intervals: group.timeRanges.map((item) => ({ key: item.key, start: item.start, end: item.end, nextDay: item.endDayOffset === 1, contourId: item.contourId ?? null })),
      assignments: group.assignments.map((item) => ({ employeeId: item.employeeId, employeeName: employeeNames.get(item.employeeId) ?? 'Сотрудник из сохранённого назначения', startDate: item.from, endDate: item.to ?? '' })),
    })),
  };
}
