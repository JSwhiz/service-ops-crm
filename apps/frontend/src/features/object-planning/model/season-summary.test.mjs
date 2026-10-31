import assert from 'node:assert/strict';
import test from 'node:test';
import { contourDisplayRate, nextSeasonBoundary } from './season-summary.ts';

test('no season shows the default; legacy manual winter preserves the actual backend rate', () => {
  assert.equal(contourDisplayRate({ dailyRate: 100, summerDailyRate: 200, winterDailyRate: 300 }, 'none'), 100);
  assert.equal(contourDisplayRate({ dailyRate: 100, summerDailyRate: 200, winterDailyRate: 300 }, 'winter'), 300);
});
test('active seasonal zero is a real zero; missing seasonal amount falls back to default', () => {
  assert.equal(contourDisplayRate({ dailyRate: 100, summerDailyRate: 0, winterDailyRate: null }, 'summer'), 0);
  assert.equal(contourDisplayRate({ dailyRate: 100, summerDailyRate: 0, winterDailyRate: null }, 'winter'), 100);
});
test('next boundary rolls into the next year and excludes today, which is already active', () => {
  assert.deepEqual(nextSeasonBoundary('04-01', '10-01', new Date('2026-10-01T09:00:00Z')), { season: 'summer', date: '2027-04-01' });
});
test('next boundary uses the Moscow calendar day', () => {
  assert.deepEqual(nextSeasonBoundary('04-01', '10-01', new Date('2026-09-30T21:30:00Z')), { season: 'summer', date: '2027-04-01' });
});
test('custom annual dates work across reversed seasons; invalid dates are not invented', () => {
  assert.deepEqual(nextSeasonBoundary('11-01', '03-01', new Date('2026-10-31T10:00:00Z')), { season: 'summer', date: '2026-11-01' });
  assert.equal(nextSeasonBoundary(null, '10-01'), null);
  assert.equal(nextSeasonBoundary('02-30', '10-01'), null);
});
