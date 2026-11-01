import assert from 'node:assert/strict';
import test from 'node:test';
import { equipmentTypePayload, equipmentUnitPayload } from './equipment-create-payload.ts';

test('type payload preserves original strings and omits only blank optional fields', () => {
  assert.deepEqual(equipmentTypePayload({ category: ' category ', name: ' name ', brand: ' brand ', model: ' ', notes: '' }), {
    category: ' category ', name: ' name ', brand: ' brand ',
  });
});
test('unit creation stays distinct from catalog creation and preserves its complete payload', () => {
  assert.deepEqual(equipmentUnitPayload({ catalogItemId: 'type', inventoryNumber: ' INV ', serialNumber: ' SN ', notes: ' note ' }), {
    catalogItemId: 'type', inventoryNumber: ' INV ', serialNumber: ' SN ', notes: ' note ',
  });
});
