import assert from 'node:assert/strict';
import test from 'node:test';
import { windowCleaningDraft, windowCleaningPayload, windowCleaningSummary, windowCleaningValidation } from './window-cleaning.ts';

test('legacy summer flag never invents one annual visit; unrelated edits can retain an unknown schedule', () => {
  const legacy = { summerWindowCleaning: true };
  assert.deepEqual(windowCleaningDraft(legacy), { windowCleaningMode: null, windowCleaningSeasons: [] });
  assert.match(windowCleaningSummary(legacy), /периодичность не указана/);
  assert.doesNotMatch(windowCleaningSummary(legacy), /1 раз/);
  assert.deepEqual(windowCleaningPayload(windowCleaningDraft(legacy)), { windowCleaningMode: null, windowCleaningSeasons: [] });
});

test('repeated seasons represent separate visits and survive serialization in the same order', () => {
  const value = { windowCleaningMode: 'scheduled', windowCleaningSeasons: ['spring', 'spring', 'autumn'] };
  assert.equal(windowCleaningValidation(value), null);
  assert.deepEqual(windowCleaningPayload(value), value);
  assert.match(windowCleaningSummary({ ...value, summerWindowCleaning: false }), /^3 раза в год · Весна, Весна, Осень$/);
});

test('unfilled or out-of-scope rows cannot silently disappear from a scheduled draft', () => {
  for (const seasons of [[], [''], ['winter']]) {
    const value = { windowCleaningMode: 'scheduled', windowCleaningSeasons: seasons };
    assert.ok(windowCleaningValidation(value));
    assert.throws(() => windowCleaningPayload(value));
  }
});

test('changing mode preserves the local draft but sends no fake schedule or frequency', () => {
  for (const mode of ['on_request', 'notprovided']) {
    const value = { windowCleaningMode: mode, windowCleaningSeasons: ['summer', 'summer'] };
    assert.deepEqual(windowCleaningPayload(value), { windowCleaningMode: mode, windowCleaningSeasons: [] });
    assert.deepEqual(value.windowCleaningSeasons, ['summer', 'summer']);
    assert.doesNotMatch(windowCleaningSummary({ ...value, summerWindowCleaning: true }), /раз/);
  }
});
