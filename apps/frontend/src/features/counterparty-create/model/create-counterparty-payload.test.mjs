import assert from 'node:assert/strict';
import test from 'node:test';

import { toCreateCounterpartyPayload } from './create-counterparty-payload.ts';

test('counterparty payload trims all values and preserves nullable API fields', () => {
  assert.deepEqual(toCreateCounterpartyPayload({
    name: '  Acme  ',
    legalName: '  Acme LLC ',
    contactName: ' Alice ',
    contactPhone: ' +7 900 ',
    notes: ' terms ',
  }), {
    name: 'Acme',
    legalName: 'Acme LLC',
    contactName: 'Alice',
    contactPhone: '+7 900',
    notes: 'terms',
  });
});

test('empty optional counterparty values remain explicit nulls', () => {
  assert.deepEqual(toCreateCounterpartyPayload({
    name: ' Acme ', legalName: ' ', contactName: '', contactPhone: '  ', notes: '',
  }), {
    name: 'Acme', legalName: null, contactName: null, contactPhone: null, notes: null,
  });
});
