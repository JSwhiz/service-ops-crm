import assert from 'node:assert/strict';
import test from 'node:test';
import { getCellRevealScroll, getCellScrollDelta, getDayHeading, getHorizontalOverflow, getMoscowToday, getNextMatrixCell } from './matrix-navigation.ts';

test('today uses the Moscow day across month and year boundaries', () => {
  assert.deepEqual(getMoscowToday(new Date('2026-10-31T21:30:00Z')), { year: 2026, month: 11, day: 1 });
  assert.deepEqual(getMoscowToday(new Date('2026-12-31T21:00:00Z')), { year: 2027, month: 1, day: 1 });
});

test('date-only headings preserve weekdays, weekends and leap-day dates', () => {
  assert.equal(getDayHeading(2026, 11, 1).weekend, true);
  assert.equal(getDayHeading(2026, 11, 2).weekend, false);
  assert.equal(getDayHeading(2026, 11, 2).weekday, 'пн');
  assert.match(getDayHeading(2024, 2, 29).label, /29 февраля 2024/);
});

test('overflow hints reflect hidden content, including at each scroll boundary', () => {
  assert.deepEqual(getHorizontalOverflow(0, 500, 500), { before: false, after: false });
  assert.deepEqual(getHorizontalOverflow(0, 500, 1500), { before: false, after: true });
  assert.deepEqual(getHorizontalOverflow(400, 500, 1500), { before: true, after: true });
  assert.deepEqual(getHorizontalOverflow(1000, 500, 1500), { before: true, after: false });
  assert.deepEqual(getHorizontalOverflow(0.5, 500, 500.8), { before: false, after: false });
});

test('arrows move within matrix bounds without wrapping to another employee', () => {
  assert.deepEqual(getNextMatrixCell(0, 0, 'ArrowLeft', 2, 31), { row: 0, column: 0 });
  assert.deepEqual(getNextMatrixCell(0, 30, 'ArrowRight', 2, 31), { row: 0, column: 30 });
  assert.deepEqual(getNextMatrixCell(0, 15, 'ArrowDown', 2, 31), { row: 1, column: 15 });
  assert.deepEqual(getNextMatrixCell(0, 15, 'ArrowUp', 2, 31), { row: 0, column: 15 });
  assert.deepEqual(getNextMatrixCell(1, 15, 'ArrowDown', 2, 31), { row: 1, column: 15 });
});

test('Home and End respect 28/29/30/31-day months, optionally across employees', () => {
  for (const days of [28, 29, 30, 31]) {
    assert.deepEqual(getNextMatrixCell(1, 10, 'Home', 3, days), { row: 1, column: 0 });
    assert.deepEqual(getNextMatrixCell(1, 10, 'End', 3, days), { row: 1, column: days - 1 });
    assert.deepEqual(getNextMatrixCell(1, 10, 'Home', 3, days, true), { row: 0, column: 0 });
    assert.deepEqual(getNextMatrixCell(1, 10, 'End', 3, days, true), { row: 2, column: days - 1 });
  }
  assert.equal(getNextMatrixCell(0, 0, 'Enter', 1, 31), null);
  assert.equal(getNextMatrixCell(0, 0, 'ArrowRight', 0, 0), null);
});

test('focus scroll exposes a day behind sticky identities or the total column', () => {
  assert.equal(getCellScrollDelta(100, 176, 240, 600), -140);
  assert.equal(getCellScrollDelta(560, 636, 240, 600), 36);
  assert.equal(getCellScrollDelta(300, 376, 240, 600), 0);
});

test('ArrowDown reveals the full row beyond the matrix viewport without moving the page', () => {
  const viewport = { left: 100, right: 900, top: 200, bottom: 650 };
  const sticky = { left: 240, right: 0, top: 56 };
  assert.deepEqual(getCellRevealScroll({ left: 400, right: 476, top: 630, bottom: 674 }, viewport, sticky), { left: 0, top: 24 });
  assert.deepEqual(getCellRevealScroll({ left: 400, right: 476, top: 700, bottom: 744 }, viewport, sticky), { left: 0, top: 94 });
});

test('ArrowUp reveals a row hidden behind the sticky date header', () => {
  const viewport = { left: 100, right: 900, top: 200, bottom: 650 };
  const sticky = { left: 240, right: 0, top: 56 };
  assert.deepEqual(getCellRevealScroll({ left: 400, right: 476, top: 230, bottom: 274 }, viewport, sticky), { left: 0, top: -26 });
  assert.deepEqual(getCellRevealScroll({ left: 400, right: 476, top: 256, bottom: 300 }, viewport, sticky), { left: 0, top: 0 });
});

test('diagonal reveal accounts for sticky identities, total and date header together', () => {
  assert.deepEqual(getCellRevealScroll({ left: 250, right: 326, top: 180, bottom: 224 }, { left: 100, right: 900, top: 200, bottom: 650 }, { left: 240, right: 120, top: 56 }), { left: -90, top: -76 });
  assert.deepEqual(getCellRevealScroll({ left: 750, right: 826, top: 630, bottom: 674 }, { left: 100, right: 900, top: 200, bottom: 650 }, { left: 240, right: 120, top: 56 }), { left: 46, top: 24 });
});
