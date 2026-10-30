import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarPreview, legacyFactDay, legacyFactRange, validatePlan } from '../src/modules/object-scheduling/scheduling-calendar';
import type { PositionView } from '../src/modules/object-scheduling/scheduling.types';

function position(): PositionView {
  return {id: 'position', objectId: 'object', clientKey: 'key', version: 1, revisions: [{id: 'v1', version: 1, name: 'Пост', effectiveFrom: '2024-01-01', headcount: 2, requiredPerShift: 1, archived: false, createdAt: '', createdByUserId: 'actor', template: {kind: 'cycle', anchorDate: '2024-02-27', sequence: [true,true,false,false]}, groups: ['A','B'].map((key, index) => ({key, name: key, offsetDays: index * 2, assignments: [{employeeId: key, from: '2024-01-01'}], timeRanges: [{key: 'day', start: '08:00', end: '16:00', endDayOffset: 0}]}))}]};
}
test('anchored rotation crosses leap day, month/year; staffing differs from concurrent demand', () => {
  const p = position(); const result = calendarPreview([p], '2024-02-27', '2024-03-02');
  assert.deepEqual(result.shifts.map(s => s.employeeId), ['A','A','B','B','A']);
  assert.ok(result.coverage.every(c => c.required === 1 && c.uncovered === 0));
  const endOfYear = calendarPreview([p], '2024-12-30', '2025-01-02');
  assert.equal(endOfYear.shifts.length, 4);
  for (const sequence of [[true,true,true,false,false,false], [true,false,false,false]]) {
    p.revisions[0].template.sequence = sequence;
    const n = sequence.length / sequence.filter(Boolean).length;
    p.revisions[0].groups = Array.from({length: n}, (_, i) => ({...p.revisions[0].groups[0], key: String(i), offsetDays: i * sequence.filter(Boolean).length, assignments: [{employeeId: String(i), from: '2024-01-01'}]}));
    const preview = calendarPreview([p], '2024-02-27', '2024-03-04');
    assert.ok(preview.coverage.every(c => c.uncovered === 0)); assert.equal(preview.recommendedGroups, n);
  }
});
test('weekly weekdays, custom exceptions, tied versions, temporal gaps and overnight overlap', () => {
  const p = position(); p.revisions[0].template = {kind: 'weekly', weekdays: [1,2,3,4,5]};
  assert.equal(calendarPreview([p], '2024-03-02', '2024-03-03').shifts.length, 0);
  p.revisions.push({...p.revisions[0], id: 'v2', version: 2, template: {kind: 'custom', anchorDate: '2024-01-01', sequence: [true], exceptions: [{date: '2024-03-03', working: false}]}, groups: [{...p.revisions[0].groups[0], timeRanges: [{key: 'day', start: '08:00', end: '16:00', endDayOffset: 0}, {key: 'night', start: '20:00', end: '06:00', endDayOffset: 1}]}]});
  const result = calendarPreview([p], '2024-03-02', '2024-03-03');
  assert.equal(result.shifts.length, 2); assert.ok(result.shifts.every(s => s.revisionId === 'v2'));
  assert.equal(result.coverage[0].intervals.length, 2); assert.equal(result.coverage[0].uncovered, 0);
  const empty = position(); empty.revisions[0].groups[0].assignments = []; empty.revisions[0].groups[1].assignments = [];
  assert.equal(calendarPreview([empty], '2024-02-27', '2024-02-27').coverage[0].uncovered, 1);
  assert.throws(() => validatePlan({...p.revisions[1], groups: [{...p.revisions[1].groups[0], timeRanges: [{key: 'bad', start: '22:00', end: '06:00', endDayOffset: 0}]}]}));
});
test('legacy daily adapter preserves first/last/month/year boundaries under UTC and Moscow', () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ['UTC', 'Europe/Moscow']) {
      process.env.TZ = zone;
      for (const date of ['2024-02-29','2024-03-01','2024-12-31','2025-01-01']) {
        const [year, month, day] = date.split('-').map(Number); const value = legacyFactDay(date);
        assert.equal(value.getFullYear(), year); assert.equal(value.getMonth()+1, month); assert.equal(value.getDate(), day);
        assert.equal(value.getTime(), new Date(year,month-1,day).getTime());
        const range = legacyFactRange(date); assert.ok(value >= range.gte && value < range.lt);
      }
    }
  } finally { process.env.TZ = previous; }
});
