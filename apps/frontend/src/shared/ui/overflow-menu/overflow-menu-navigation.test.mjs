import assert from 'node:assert/strict';
import test from 'node:test';

import { getMenuBoundaryIndex } from './overflow-menu-navigation.ts';

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
