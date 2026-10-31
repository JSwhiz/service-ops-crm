import assert from 'node:assert/strict';
import test from 'node:test';
import { formatUiDate } from './format-date.ts';
test('date-only stays the same calendar day in any caller zone', () => {
  assert.equal(formatUiDate('2020-01-01', { timeZone: 'America/Los_Angeles' }), formatUiDate('2020-01-01', { timeZone: 'Europe/Moscow' }));
  assert.match(formatUiDate('2020-01-01'), /2020/);
});
test('timestamp keeps Moscow midnight transition and drops only seconds', () => {
  const result = formatUiDate('2026-10-31T22:15:59Z', { timeZone: 'Europe/Moscow', time: true });
  assert.match(result, /1 нояб/);
  assert.match(result, /01:15/);
  assert.doesNotMatch(result, /:59/);
  assert.equal(formatUiDate('bad'), '—');
});
