import assert from 'node:assert/strict';
import test from 'node:test';
import { describeTimesheetValue, humanizeCellCorrectionError, isCellCorrectionRetryBlocked, validateCellCorrection } from './cell-presentation.ts';

test('zero is an amount with independent attendance, never missing data', () => {
  for (const hasFact of [true, false]) {
    const text = describeTimesheetValue({ finalValue: 0, manualValue: null, isChangedManually: false, hasFact });
    assert.match(text, /0 ₽/);
    assert.doesNotMatch(text, /нет данных|нет запис|не было выхода/i);
  }
});

test('manual zero is distinct from absent manual value and a normal zero', () => {
  const zero = describeTimesheetValue({ finalValue: 0, manualValue: 0, isChangedManually: true, hasFact: true });
  assert.match(zero, /Ручная корректировка: 0 ₽/);
  const absent = describeTimesheetValue({ finalValue: 0, manualValue: null, isChangedManually: false, hasFact: true });
  assert.notEqual(zero, absent);
});

test('a nonzero manual amount is not described as an automatic result', () => {
  assert.match(describeTimesheetValue({ finalValue: 1500, manualValue: 1500, isChangedManually: true, hasFact: false }), /ручная корректировка/);
});

test('sensitive correction preserves integer, nonnegative and mandatory reason checks', () => {
  for (const value of ['', ' ', '-1', '1.5', 'Infinity', 'NaN']) assert.ok(validateCellCorrection(value, 'Причина', 1000, true));
  assert.match(validateCellCorrection('0', ' ', 1000, true), /причину/);
  assert.equal(validateCellCorrection('0', 'Обнуление по согласованию', 1000, true), null);
  assert.equal(validateCellCorrection('2000', 'Доплата', 1000, false), null);
});

test('restore-auto remains a separate direct-correction permission', () => {
  assert.equal(validateCellCorrection('1000', '', 1000, true), null);
  assert.match(validateCellCorrection('1000', '', 1000, false), /правом прямой корректировки/);
});

test('actual already-pending response has an actionable message distinct from a version conflict', () => {
  const pending = humanizeCellCorrectionError({ statusCode: 409, code: null, message: 'Timesheet manual exception approval is already pending for this day' });
  assert.equal(pending.recovery, 'pending');
  assert.match(pending.message, /уже есть запрос на согласование/);
  assert.match(pending.message, /повторный запрос не нужен/);
  const conflict = humanizeCellCorrectionError({ statusCode: 409, code: null, message: 'Timesheet cell changed after approval request was created' });
  assert.equal(conflict.recovery, 'refresh');
  assert.match(conflict.message, /сравните новое начисление/);
  assert.notEqual(pending.message, conflict.message);
});

test('permission and session failures instruct the user without exposing raw response text', () => {
  const denied = humanizeCellCorrectionError({ statusCode: 403, code: null, message: 'Manual timesheet correction denied' });
  assert.match(denied.message, /Недостаточно прав/);
  assert.equal(denied.recovery, 'refresh');
  assert.match(humanizeCellCorrectionError({ statusCode: 401, code: null, message: 'Unauthorized' }).message, /Войдите в систему/);
  assert.doesNotMatch(denied.message, /denied|Manual timesheet/);
});

test('known server validation keeps the draft editable; changed automatic value requires refresh', () => {
  const reason = humanizeCellCorrectionError({ statusCode: 400, code: null, message: 'Manual timesheet correction requires a comment' });
  assert.equal(reason.recovery, 'edit');
  assert.match(reason.message, /Укажите причину/);
  for (const message of ['Manual exception must differ from current automatic value', 'Direct manual correction is available for current user']) {
    assert.equal(humanizeCellCorrectionError({ statusCode: 400, code: null, message }).recovery, 'refresh');
  }
  assert.equal(humanizeCellCorrectionError({ statusCode: 422, code: null, message: 'dayValue must be an integer number' }).recovery, 'edit');
});

test('unknown/network failures never echo backend text or allow retry before a fresh read', () => {
  for (const failure of [null, { statusCode: 0, code: 'NETWORK_ERROR', message: 'fetch failed' }, { statusCode: 500, code: null, message: 'Prisma stack trace SECRET' }]) {
    const result = humanizeCellCorrectionError(failure);
    assert.equal(result.recovery, 'refresh');
    assert.match(result.message, /Результат сохранения не подтверждён/);
    assert.doesNotMatch(result.message, /Prisma|SECRET|fetch|stack/);
  }
  assert.equal(isCellCorrectionRetryBlocked(false, 4, 4), true);
  assert.equal(isCellCorrectionRetryBlocked(false, 4, 3), true);
  assert.equal(isCellCorrectionRetryBlocked(false, 4, 5), false);
  assert.equal(isCellCorrectionRetryBlocked(false, null, 4), false);
  assert.equal(isCellCorrectionRetryBlocked(true, null, 5), true);
});
