import assert from 'node:assert/strict';
import test from 'node:test';
import { findExtraWorkSource } from './extra-work-source.ts';
import { initialHolidayContour, isHolidayContourSelected } from './holiday-contour-selection.ts';

const credit = { id: 'credit', sourceKey: 'extra:original', operationDate: '2026-11-03', amount: 700, updatedAt: '2026-11-03T10:20:30.456Z', explanation: 'Допработа' };
const explanation = (entries) => ({ rows: [{ employeeId: 'employee', employeeName: 'Сотрудник', entries }] });

test('extra correction reads the current original credit, excluding base exit and other extras', () => {
  const saved = findExtraWorkSource(explanation([{ ...credit, sourceKey: 'shift:employee:date:day', amount: 1700 }, { ...credit, sourceKey: 'extra:other', amount: 9999 }, credit]), 'original', '2026-11-03');
  assert.equal(saved.amount, 700);
  assert.equal(saved.updatedAt, '2026-11-03T10:20:30.456Z');
  assert.equal(saved.employeeName, 'Сотрудник');
});

test('a saved zero remains available for a later correction, without falling back to original amount', () => {
  assert.equal(findExtraWorkSource(explanation([{ ...credit, amount: 0 }]), 'original', '2026-11-03').amount, 0);
});

test('missing or ambiguous credit and invalid concurrency timestamp remain unavailable', () => {
  for (const entries of [[], [credit, credit], [{ ...credit, updatedAt: undefined }], [{ ...credit, updatedAt: 'invalid' }], [{ ...credit, amount: null }]]) {
    assert.equal(findExtraWorkSource(explanation(entries), 'original', '2026-11-03'), null);
  }
  assert.equal(findExtraWorkSource(explanation([credit]), 'original', '2026-11-02'), null);
});

test('holiday base route auto-selects only when there are no named conditions', () => {
  assert.equal(initialHolidayContour([]), null);
  assert.equal(initialHolidayContour([{ id: 'day' }]), undefined);
  assert.equal(initialHolidayContour([{ id: 'day' }, { id: 'night' }]), undefined);
});

test('multiple holiday conditions require an explicit valid selection, including explicit base', () => {
  const contours = [{ id: 'day' }, { id: 'night' }];
  assert.equal(isHolidayContourSelected(contours, undefined), false);
  assert.equal(isHolidayContourSelected(contours, ''), false);
  assert.equal(isHolidayContourSelected(contours, 'unrelated'), false);
  assert.equal(isHolidayContourSelected(contours, 'night'), true);
  assert.equal(isHolidayContourSelected(contours, null), true);
});
