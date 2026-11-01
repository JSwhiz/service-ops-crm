import assert from 'node:assert/strict';
import test from 'node:test';

import { isRealReportDate, isReportId, shouldRenderCachedReportsForDate } from './report-link.ts';

test('validates report dates as real calendar dates, including leap days', () => {
  assert.equal(isRealReportDate('2024-02-29'), true);
  assert.equal(isRealReportDate('2026-02-31'), false);
  assert.equal(isRealReportDate('2026-2-03'), false);
});

test('accepts canonical report ids and rejects malformed deep-link ids', () => {
  assert.equal(isReportId('a41f6b20-9d3c-4e75-8a12-5f6b3d9e2c40'), true);
  assert.equal(isReportId(''), false);
  assert.equal(isReportId(null), false);
});

test('keeps same-date report editors mounted during background refetch but hides them for a new date', () => {
  assert.equal(shouldRenderCachedReportsForDate('2026-10-31', '2026-10-31'), true);
  assert.equal(shouldRenderCachedReportsForDate('2026-11-01', '2026-10-31'), false);
});
