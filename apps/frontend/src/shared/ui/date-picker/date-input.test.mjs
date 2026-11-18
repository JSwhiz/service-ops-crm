import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarDate, formatDateInput, moscowDateKey, parseDateInput } from './date-input.ts';

test('typed and pasted Russian dates commit ISO without calendar rollover', () => {
  assert.deepEqual(parseDateInput(' 29.02.2000 '), { value: '2000-02-29', error: null });
  for (const text of ['31.02.2000', '29.02.1900', '31.04.2020', '00.12.2000', '01.13.2000']) assert.equal(parseDateInput(text).value, null, text);
  assert.equal(calendarDate('2026-02-31'), null);
  assert.equal(calendarDate('2024-02-29')?.getDate(), 29);
  assert.equal(formatDateInput('2000-02-29'), '29.02.2000');
  assert.equal(parseDateInput('12.04.').value, null);
  assert.deepEqual(parseDateInput(''), { value: '', error: null });
});

test('birthday rejects future dates and follows the Moscow calendar day', () => {
  const options = { max: '2026-11-17', maxError: 'Дата рождения не может быть в будущем.' };
  assert.deepEqual(parseDateInput('18.11.2026', options), { value: null, error: options.maxError });
  assert.equal(parseDateInput('17.11.2026', options).value, '2026-11-17');
  assert.equal(parseDateInput('01.01.1900', options).value, '1900-01-01');
  assert.equal(moscowDateKey(new Date('2026-11-16T21:01:00Z')), '2026-11-17');
});

test('datetime retains time and enforces exact date/time range boundaries', () => {
  assert.equal(parseDateInput('17.11.2026', { withTime: true, time: '20:15' }).value, '2026-11-17T20:15');
  assert.equal(parseDateInput('17.11.2026 00:05', { withTime: true }).value, '2026-11-17T00:05');
  assert.equal(formatDateInput('2026-11-17T20:15', true), '17.11.2026 20:15');
  assert.equal(parseDateInput('17.11.2026 24:00', { withTime: true }).value, null);
  const options = { withTime: true, min: '2026-11-17T09:30', max: '2026-11-18T17:00' };
  assert.equal(parseDateInput('17.11.2026 09:29', options).value, null);
  assert.equal(parseDateInput('17.11.2026 09:30', options).value, '2026-11-17T09:30');
  assert.equal(parseDateInput('18.11.2026 17:01', options).value, null);
  assert.equal(parseDateInput('16.11.2026', { min: '2026-11-17' }).value, null);
});
