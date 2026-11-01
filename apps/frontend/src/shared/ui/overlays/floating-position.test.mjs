import test from 'node:test';
import assert from 'node:assert/strict';
import { getFloatingPosition } from './floating-position.ts';

test('absence calendar uses the viewport rather than the short dialog body', () => {
  const position = getFloatingPosition({ left: 385, right: 634, top: 410, bottom: 452 }, { width: 296, height: 350 }, { width: 1280, height: 800 });
  assert.equal(position.placement, 'above');
  assert.equal(position.top, 54);
  assert.ok(position.maxHeight >= 350);
  assert.ok(position.top + 350 <= 800 - 12);
});

test('calendar clamps horizontally at the right viewport edge', () => {
  const position = getFloatingPosition({ left: 320, right: 380, top: 250, bottom: 294 }, { width: 296, height: 350 }, { width: 390, height: 844 });
  assert.equal(position.left, 82);
  assert.ok(position.top >= 12);
});
