import assert from 'node:assert/strict';
import test from 'node:test';

import { getMenuBoundaryIndex, getOverflowMenuPosition } from './overflow-menu-navigation.ts';

test('Home and End target the first and last enabled menu items', () => {
  const enabledIndexes = [0, 2, 4];
  assert.equal(getMenuBoundaryIndex(enabledIndexes, false), 0);
  assert.equal(getMenuBoundaryIndex(enabledIndexes, true), 4);
});

test('menu boundary navigation handles an empty or single-item menu', () => {
  assert.equal(getMenuBoundaryIndex([], true), null);
  assert.equal(getMenuBoundaryIndex([3], false), 3);
  assert.equal(getMenuBoundaryIndex([3], true), 3);
});

test('overflow menu flips above its anchor and stays inside a scroll boundary', () => {
  const position = getOverflowMenuPosition(
    { top: 390, bottom: 430, left: 710, right: 750 },
    { width: 260, height: 220 },
    { top: 100, bottom: 460, left: 500, right: 780 },
  );
  assert.equal(position.top, 162);
  assert.equal(position.left, 508);
  assert.equal(position.maxHeight, 344);
});

test('overflow menu clamps an oversized menu within a narrow viewport', () => {
  const position = getOverflowMenuPosition(
    { top: 12, bottom: 48, left: 4, right: 44 },
    { width: 320, height: 900 },
    { top: 0, bottom: 600, left: 0, right: 390 },
  );
  assert.equal(position.left, 8);
  assert.equal(position.top, 8);
  assert.equal(position.maxWidth, 374);
  assert.equal(position.maxHeight, 584);
});
