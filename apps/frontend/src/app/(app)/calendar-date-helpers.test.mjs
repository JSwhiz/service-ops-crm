import assert from 'node:assert/strict';
import test from 'node:test';
import { formatIsoDay, isoMonthDays, resolveIsoDay, shiftIsoDay, visitPlanEmptyCopy } from './calendar-date-helpers.ts';

test('URL dates reject empty, malformed and impossible days without guessing a different date', () => {
  for (const value of [null, '', 'bad-date', '2026-02-29', '2026-13-01', '2026-11-31', '2026-1-01']) {
    assert.equal(resolveIsoDay(value, '2026-11-01'), '2026-11-01');
  }
  assert.equal(resolveIsoDay('2024-02-29', '2026-11-01'), '2024-02-29');
});

test('day navigation crosses month, year, and leap-day boundaries in UTC', () => {
  assert.equal(shiftIsoDay('2026-10-31', 1), '2026-11-01');
  assert.equal(shiftIsoDay('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftIsoDay('2024-02-28', 1), '2024-02-29');
  assert.equal(shiftIsoDay('2024-03-01', -1), '2024-02-29');
});

test('calendar month dates include the correct number of days', () => {
  assert.equal(isoMonthDays(2024, 2).length, 29);
  assert.equal(isoMonthDays(2025, 2).length, 28);
  assert.deepEqual(isoMonthDays(2026, 11).slice(0, 2), ['2026-11-01', '2026-11-02']);
  assert.equal(isoMonthDays(2026, 11).at(-1), '2026-11-30');
});

test('missing plan state names the selected date and keeps the manager selection gate', () => {
  const editable = visitPlanEmptyCopy('2026-11-01', true, true);
  assert.match(editable.title, /1 ноября 2026/);
  assert.match(editable.description, /выбранного менеджера/);

  const selectionRequired = visitPlanEmptyCopy('2026-11-01', true, false);
  assert.match(selectionRequired.description, /Выберите менеджера/);

  const readOnly = visitPlanEmptyCopy('2026-11-01', false, false);
  assert.equal(readOnly.description, 'Посещения на этот день не запланированы.');
  assert.match(formatIsoDay('2026-11-01'), /1 ноября 2026/);
});
