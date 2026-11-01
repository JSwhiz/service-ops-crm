import assert from 'node:assert/strict';
import test from 'node:test';

import { getMediaMenuPosition } from './media-action-position.ts';

test('a scrolled-out trigger cannot make a tall menu exceed the viewport', () => {
  assert.deepEqual(getMediaMenuPosition(
    { top: 900, bottom: 940, left: 4, right: 44 },
    { width: 220, height: 800 },
    { width: 390, height: 600 },
  ), { left: 12, top: 12, placement: 'above', maxHeight: 576 });
});

test('uses the visible viewport offsets after zoom or keyboard resize', () => {
  assert.deepEqual(getMediaMenuPosition(
    { top: 440, bottom: 480, left: 350, right: 390 },
    { width: 220, height: 180 },
    { width: 300, height: 400, left: 100, top: 120 },
  ), { left: 168, top: 254, placement: 'above', maxHeight: 302 });
});

test('clamps an attachment menu against the right viewport edge', () => {
  assert.deepEqual(
    getMediaMenuPosition(
      { top: 200, bottom: 240, left: 1210, right: 1250 },
      { width: 240, height: 140 },
      { width: 1280, height: 800 },
    ),
    { left: 1028, top: 246, placement: 'below', maxHeight: 542 },
  );
});

test('flips above a low trigger and limits height to available room', () => {
  const position = getMediaMenuPosition(
    { top: 720, bottom: 760, left: 40, right: 80 },
    { width: 220, height: 260 },
    { width: 390, height: 800 },
  );
  assert.deepEqual(position, { left: 40, top: 454, placement: 'above', maxHeight: 702 });
});

test('keeps oversized menus inside the safe viewport bounds', () => {
  const position = getMediaMenuPosition(
    { top: 4, bottom: 24, left: 4, right: 24 },
    { width: 600, height: 900 },
    { width: 320, height: 240 },
  );
  assert.deepEqual(position, { left: 12, top: 30, placement: 'below', maxHeight: 198 });
});
