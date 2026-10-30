import { BadRequestException } from '@nestjs/common';
import type { PositionFieldsDto, TemplateDto } from './scheduling.dto';
import type { PositionView, PreviewResponse } from './scheduling.types';

const DAY = 86400000;
export function dateOnly(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('Некорректная календарная дата');
  return date;
}
export function todayMoscow(): string { return new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10); }
/** Adapter for the existing DateTime attendance column and local-time timesheet code. */
export function legacyFactDay(date: string): Date {
  dateOnly(date); const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}
export function legacyFactRange(date: string) {
  const next = new Date(dateOnly(date).getTime() + DAY).toISOString().slice(0,10);
  return {gte: legacyFactDay(date), lt: legacyFactDay(next)};
}
export function boundedDates(from: string, to: string): string[] {
  const start = dateOnly(from).getTime(); const end = dateOnly(to).getTime();
  if (end < start || (end - start) / DAY >= 93) throw new BadRequestException('Диапазон должен включать от 1 до 93 дней');
  return Array.from({length: (end - start) / DAY + 1}, (_, i) => new Date(start + i * DAY).toISOString().slice(0, 10));
}
export function validatePlan(input: PositionFieldsDto): void {
  dateOnly(input.effectiveFrom);
  if (!input.name?.trim() || !input.template || !Array.isArray(input.groups)) throw new BadRequestException('Укажите название, шаблон и группы');
  const template = input.template;
  if (template.anchorDate) dateOnly(template.anchorDate);
  if (template.kind === 'weekly' ? !template.weekdays?.length : !template.sequence?.length) throw new BadRequestException('Укажите дни недели или последовательность цикла');
  if (new Set(template.weekdays).size !== (template.weekdays?.length ?? 0)) throw new BadRequestException('Дни недели не должны повторяться');
  const exceptions = template.exceptions ?? [];
  if (new Set(exceptions.map(x => x.date)).size !== exceptions.length) throw new BadRequestException('Даты исключений не должны повторяться');
  exceptions.forEach(x => dateOnly(x.date));
  if (new Set(input.groups.map(x => x.key)).size !== input.groups.length) throw new BadRequestException('Ключи групп должны быть уникальны');
  for (const group of input.groups) {
    if (!group.name.trim()) throw new BadRequestException('Название группы пусто');
    if (new Set(group.timeRanges.map(x => x.key)).size !== group.timeRanges.length) throw new BadRequestException('Ключи интервалов должны быть уникальны в группе');
    for (const range of group.timeRanges) {
      const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
      const duration = minutes(range.end) + range.endDayOffset * 1440 - minutes(range.start);
      if (duration <= 0 || duration > 1440) throw new BadRequestException('Интервал смены должен длиться от 1 минуты до 24 часов; укажите переход через полночь');
    }
    for (const a of group.assignments) {
      dateOnly(a.from); if (a.to) dateOnly(a.to);
      if (a.to && a.to < a.from) throw new BadRequestException('Конец назначения раньше начала');
    }
    for (let i = 0; i < group.assignments.length; i++) for (let j = i + 1; j < group.assignments.length; j++) {
      const a = group.assignments[i]; const b = group.assignments[j];
      if (a.employeeId === b.employeeId && a.from <= (b.to ?? '9999-12-31') && b.from <= (a.to ?? '9999-12-31')) throw new BadRequestException('Пересекающиеся назначения одного сотрудника в группе');
    }
  }
}
function working(template: TemplateDto, date: string, offset: number): boolean {
  const exception = template.exceptions?.find(x => x.date === date);
  if (exception) return exception.working;
  if (template.kind === 'weekly') return (template.weekdays ?? []).includes(dateOnly(date).getUTCDay() || 7);
  if (!template.anchorDate || !template.sequence?.length) return false;
  const day = (dateOnly(date).getTime() - dateOnly(template.anchorDate).getTime()) / DAY - offset;
  return template.sequence[((day % template.sequence.length) + template.sequence.length) % template.sequence.length];
}
export function calendarPreview(positions: PositionView[], from: string, to: string): PreviewResponse {
  const dates = boundedDates(from, to);
  const result: PreviewResponse = {from, to, shifts: [], coverage: [], warnings: [], recommendedGroups: null};
  for (const position of positions) for (const date of dates) {
    const revision = [...position.revisions].reverse().find(x => x.effectiveFrom <= date);
    if (!revision || revision.archived) continue;
    const warning = (code: string, message: string) => { if (!result.warnings.some(x => x.positionId === position.id && x.code === code && x.date === date)) result.warnings.push({code, message, positionId: position.id, date}); };
    if (revision.headcount === null) warning('HEADCOUNT_UNSPECIFIED', 'Плановая численность не задана');
    if (revision.template.kind !== 'weekly' && !revision.template.anchorDate) warning('ANCHOR_REQUIRED', 'Шаблон сохранён без даты начала цикла');
    const sequence = revision.template.sequence;
    if (revision.template.kind === 'cycle' && sequence && /^1+0+$/.test(sequence.map(x => x ? '1' : '0').join(''))) result.recommendedGroups = Math.ceil(sequence.length / sequence.filter(Boolean).length);
    const dayShifts: PreviewResponse['shifts'] = [];
    const plannedRanges = new Map<string, {startsAt: string; endsAt: string}>();
    for (const group of revision.groups) {
      if (!working(revision.template, date, group.offsetDays)) continue;
      const assignments = group.assignments.filter(a => a.from <= date && (!a.to || a.to >= date));
      if (!assignments.length) warning('UNFILLED_GROUP', `В группе «${group.name}» нет назначенных сотрудников`);
      for (const range of group.timeRanges) for (const assignment of assignments) {
        const endDate = new Date(dateOnly(date).getTime() + range.endDayOffset * DAY).toISOString().slice(0, 10);
        dayShifts.push({positionId: position.id, revisionId: revision.id, groupKey: group.key, timeRangeKey: range.key, employeeId: assignment.employeeId, operationDate: date, startsAt: `${date}T${range.start}:00+03:00`, endsAt: `${endDate}T${range.end}:00+03:00`, contourId: range.contourId ?? null});
      }
      for (const range of group.timeRanges) {
        const endDate = new Date(dateOnly(date).getTime() + range.endDayOffset * DAY).toISOString().slice(0, 10);
        const startsAt = `${date}T${range.start}:00+03:00`; const endsAt = `${endDate}T${range.end}:00+03:00`;
        plannedRanges.set(`${startsAt}/${endsAt}`, {startsAt, endsAt});
      }
    }
    // Sweep planned AND assigned boundaries so empty/partly covered time ranges remain visible.
    const planned = [...plannedRanges.values()];
    const boundaries = [...new Set([...planned, ...dayShifts].flatMap(s => [Date.parse(s.startsAt), Date.parse(s.endsAt)]))].sort((a,b) => a-b);
    const intervals = boundaries.slice(0,-1).flatMap((t, i) => {
      const required = planned.filter(s => Date.parse(s.startsAt) <= t && Date.parse(s.endsAt) > t).length * revision.requiredPerShift;
      if (!required) return [];
      const assigned = new Set(dayShifts.filter(s => Date.parse(s.startsAt) <= t && Date.parse(s.endsAt) > t).map(s => s.employeeId)).size;
      return [{startsAt: new Date(t).toISOString(), endsAt: new Date(boundaries[i+1]).toISOString(), required, assigned, uncovered: Math.max(0, required - assigned)}];
    });
    const assigned = intervals.length ? Math.min(...intervals.map(x => x.assigned)) : 0;
    const required = intervals.length ? Math.max(...intervals.map(x => x.required)) : 0;
    const uncovered = intervals.length ? Math.max(...intervals.map(x => x.uncovered)) : 0;
    result.coverage.push({positionId: position.id, date, required, assigned, uncovered, intervals});
    if (uncovered) warning('UNCOVERED', 'Плановая потребность покрыта не полностью');
    if (intervals.some(x => x.assigned > x.required)) warning('OVER_COVERAGE', 'Назначенный состав превышает потребность смены');
    const totalStaff = new Set(revision.groups.flatMap(g => g.assignments.filter(a => a.from <= date && (!a.to || a.to >= date)).map(a => a.employeeId))).size;
    if (revision.headcount !== null && totalStaff < revision.headcount) warning('STAFFING_SHORTAGE', 'Общая численность позиции не укомплектована');
    result.shifts.push(...dayShifts);
    if (result.shifts.length > 20000) throw new BadRequestException('Предпросмотр превышает 20000 смен; сократите диапазон');
  }
  const byEmployee = new Map<string, typeof result.shifts>();
  for (const shift of result.shifts) { const list = byEmployee.get(shift.employeeId) ?? []; list.push(shift); byEmployee.set(shift.employeeId, list); }
  for (const [employeeId, shifts] of byEmployee) {
    shifts.sort((a,b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    let end = 0;
    for (const shift of shifts) {
      if (Date.parse(shift.startsAt) < end) result.warnings.push({code: 'OVERLAP', message: 'Рабочие интервалы сотрудника пересекаются', employeeId, date: shift.operationDate, positionId: shift.positionId});
      end = Math.max(end, Date.parse(shift.endsAt));
    }
  }
  return result;
}
