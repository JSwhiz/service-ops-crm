import assert from 'node:assert/strict';
import test from 'node:test';

import { toCreateInventoryItemPayload } from './create-inventory-item-payload.ts';

test('inventory create preserves name/category/unit and trims optional notes', () => {
  assert.deepEqual(toCreateInventoryItemPayload({
    name: ' Name ', category: ' Category ', unit: ' kg ', notes: ' note ',
  }), {
    name: ' Name ', category: ' Category ', unit: ' kg ', notes: 'note',
  });
});

test('blank inventory notes are omitted from the API payload', () => {
  assert.deepEqual(toCreateInventoryItemPayload({
    name: 'Name', category: 'Category', unit: 'pcs', notes: '  ',
  }), { name: 'Name', category: 'Category', unit: 'pcs' });
});
