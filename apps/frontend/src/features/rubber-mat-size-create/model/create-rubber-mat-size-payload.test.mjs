import assert from 'node:assert/strict';
import test from 'node:test';

import { toCreateRubberMatSizePayload } from './create-rubber-mat-size-payload.ts';

test('size create keeps centimeter dimensions and explicit null for an unknown replacement cost', () => {
  assert.deepEqual(toCreateRubberMatSizePayload({ length: '120.5', width: '80', replacementCost: '  ' }), {
    lengthCm: 120.5,
    widthCm: 80,
    replacementCost: null,
  });
});

test('zero replacement cost remains distinct from an unknown cost', () => {
  assert.deepEqual(toCreateRubberMatSizePayload({ length: '100', width: '50', replacementCost: '0' }), {
    lengthCm: 100,
    widthCm: 50,
    replacementCost: '0',
  });
});
