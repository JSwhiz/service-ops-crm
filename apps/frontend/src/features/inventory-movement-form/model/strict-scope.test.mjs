import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { itemAllowsMovement, mergeInventoryChoices, strictMovementError, strictTypeAvailable } from './strict-scope.ts';

const item = (id, capabilities = {}) => ({ id, name: id, isActive: true, deletedAt: null, capabilities });
const a = item('A', { canCreateReceipt: true, canReturn: true, canWriteoff: true, canAdjust: true });
const b = item('B');
const object = (id, allowed) => ({ id, capabilities: { canIssueToObject: allowed } });
const order = (id, allowed, link = true) => ({ id, capabilities: { canIssueToOneTimeOrder: allowed, canLinkMovement: link } });
const scope = (overrides = {}) => ({
  ready: true, items: [a, b], objects: [object('object-A', true), object('object-B', false)],
  orders: [order('order-A', true), order('order-B', false)],
  movementType: 'receipt', relationScope: 'none', objectId: '', orderId: '', ...overrides,
});
const line = (inventoryItemId = 'A', extras = {}) => ({ inventoryItemId, quantity: '1', ...extras });

test('receipt/return/writeoff/adjustment use each actual item, never the bundle or another item', () => {
  for (const [movementType, flag] of [
    ['receipt', 'canCreateReceipt'], ['return', 'canReturn'], ['writeoff', 'canWriteoff'], ['adjustment', 'canAdjust'],
  ]) {
    const context = scope({ movementType, ...(movementType === 'return' ? { relationScope: 'object', objectId: 'object-A' } : {}) });
    assert.equal(strictMovementError(context, [line()]), null);
    assert.notEqual(strictMovementError(context, [line('B')]), null);
    assert.equal(itemAllowsMovement(item('independent', { [flag]: true, canCreateMovement: false }), movementType), true);
  }
});

test('missing/false caps, missing item, inactive/deleted item and unfinished refresh fail closed', () => {
  for (const candidate of [item('A'), item('A', { canCreateReceipt: false }), { ...a, isActive: false }, { ...a, deletedAt: '2026-01-01' }]) {
    assert.notEqual(strictMovementError(scope({ items: [candidate] }), [line()]), null);
  }
  assert.notEqual(strictMovementError(scope({ items: [] }), [line()]), null);
  assert.notEqual(strictMovementError(scope({ ready: false }), [line()]), null);
  assert.equal(strictTypeAvailable(scope({ ready: false }), 'receipt'), false);
});

test('object issue uses selected target capability, not item canIssue projection or global flags', () => {
  const context = scope({ movementType: 'issue_to_object', objectId: 'object-A', items: [b] });
  assert.equal(strictMovementError(context, [line('B')]), null);
  assert.notEqual(strictMovementError({ ...context, objectId: 'object-B' }, [line('B')]), null);
  assert.notEqual(strictMovementError({ ...context, objectId: '' }, [line('B')]), null);
  assert.notEqual(strictMovementError({ ...context, objects: [{ id: 'object-A' }] }, [line('B')]), null);
  assert.notEqual(strictMovementError({ ...context, objects: [] }, [line('B')]), null);
});

test('generic order issue respects backend hard-invariant result; link/assignment-like data never grants issue', () => {
  const context = scope({ movementType: 'issue_to_one_time_order', orderId: 'order-A' });
  assert.equal(strictMovementError(context, [line()]), null);
  assert.notEqual(strictMovementError({ ...context, orderId: 'order-B' }, [line()]), null);
  assert.notEqual(strictMovementError({ ...context, orders: [{ id: 'order-A', assigned: true, capabilities: { canLinkMovement: true } }] }, [line()]), null);
});

test('return/writeoff order links require exact canLinkMovement, independently of issue capability', () => {
  for (const movementType of ['return', 'writeoff']) {
    const context = scope({ movementType, relationScope: 'one_time_order', orderId: 'order-B' });
    assert.equal(strictMovementError(context, [line()]), null);
    assert.notEqual(strictMovementError({ ...context, orders: [order('order-B', true, false)] }, [line()]), null);
    assert.notEqual(strictMovementError({ ...context, orders: [{ id: 'order-B' }] }, [line()]), null);
    assert.notEqual(strictMovementError({ ...context, orders: [] }, [line()]), null);
  }
  assert.equal(strictMovementError(scope({ movementType: 'writeoff' }), [line()]), null);
  assert.notEqual(strictMovementError(scope({ movementType: 'return' }), [line()]), null);
});

test('multi-writeoff validates the entire pending batch; denied B prevents a first business POST', () => {
  const context = scope({ movementType: 'writeoff' });
  assert.notEqual(strictMovementError(context, [line(), line('B')]), null);
  assert.equal(strictMovementError(context, [line(), line('A')]), null);
  for (const quantity of ['', '0', '-1', 'NaN', 'Infinity', '0.0001']) {
    assert.notEqual(strictMovementError(context, [line('A', { quantity })]), null);
  }
  assert.equal(strictMovementError(context, [line('A', { quantity: '0.001' })]), null);
});

test('the next new POST is rechecked after a target/item revoke between batch lines', () => {
  const context = scope({ movementType: 'issue_to_object', objectId: 'object-A' });
  assert.equal(strictMovementError(context, [line(), line('B')]), null);
  assert.equal(strictMovementError(context, [line()]), null);
  assert.notEqual(strictMovementError({ ...context, objects: [object('object-A', false)] }, [line('B')]), null);
  assert.notEqual(strictMovementError({ ...context, items: [a] }, [line('B')]), null);
});

test('created movement IDs survive evidence retry even after leaf revoke, without authorizing new rows', () => {
  const context = scope({ movementType: 'writeoff', items: [] });
  const created = line('A', { movementId: 'saved-movement' });
  assert.equal(strictMovementError(context, [created]), null);
  assert.notEqual(strictMovementError(context, [created, line('B')]), null);
  assert.notEqual(strictMovementError({ ...context, ready: false }, [created]), null);
  assert.equal(created.movementId, 'saved-movement');
});

test('revoke/regrant does not mutate draft target, amount or created ID', () => {
  const draft = { lines: [line()], objectId: 'object-A', quantity: '3.25', comment: 'Keep this draft' };
  const before = structuredClone(draft);
  const context = scope({ movementType: 'issue_to_object', objectId: draft.objectId });
  assert.equal(strictMovementError(context, draft.lines), null);
  assert.notEqual(strictMovementError({ ...context, ready: false }, draft.lines), null);
  assert.notEqual(strictMovementError({ ...context, objects: [] }, draft.lines), null);
  assert.equal(strictMovementError(context, draft.lines), null);
  assert.deepEqual(draft, before);
});

test('type availability is existential only; it never grants permission to every loaded item/target', () => {
  assert.equal(strictTypeAvailable(scope(), 'receipt'), true);
  assert.equal(strictTypeAvailable(scope(), 'issue_to_object'), true);
  assert.equal(strictTypeAvailable(scope({ objects: [] }), 'issue_to_object'), false);
  assert.equal(strictTypeAvailable(scope({ orders: [order('order-A', false)] }), 'issue_to_one_time_order'), false);
  assert.notEqual(strictMovementError(scope(), [line('B')]), null);
});

test('pagination/search retains selected direct-read rows and prefers their fresh capabilities', () => {
  const stale = item('A', { canCreateReceipt: true });
  const revoked = item('A', { canCreateReceipt: false });
  const first = mergeInventoryChoices([stale, b], [revoked]);
  assert.equal(first.length, 2);
  assert.equal(first.find(({ id }) => id === 'A'), revoked);
  const second = mergeInventoryChoices([item('page-2')], [a]);
  assert.equal(second.some(({ id }) => id === 'A'), true);
  assert.equal(strictMovementError(scope({ items: second }), [line()]), null);
});

// Wiring assertions only: these do not certify a React lifecycle or real HTTP/DB.
test('strict form checks before batch and each new POST; saved single ID skips recreation', () => {
  const source = readFileSync(new URL('../ui/inventory-movement-form.tsx', import.meta.url), 'utf8');
  assert.match(source, /strictScope = false/);
  assert.ok(source.indexOf('checkNewPost(lines)') < source.indexOf('for (const line of issueLines)'));
  assert.match(source, /if \(!movementId\) \{\s+checkNewPost\(\[line\]\)/);
  assert.match(source, /let movementId = singleMovementId;\s+if \(!movementId\)/);
  assert.match(source, /isAccessGenerationCurrent\(accessGeneration\)/);
  assert.match(source, /currentScope\.current = scope/);
  assert.match(source, /if \(strictScope && scopeReady\) setError\(null\)/);
});

test('registry wiring uses bounded server paging, independent reads and revision-keyed selected revalidation', () => {
  const source = readFileSync(new URL('../../../app/(app)/inventory/movements/page.tsx', import.meta.url), 'utf8');
  assert.match(source, /page: itemPage, limit: 100, search:/);
  assert.match(source, /selectedKey = JSON.stringify\(\[accessRevision, selectedItemIds, reload\]\)/);
  assert.match(source, /selectedItemIds.map\(\(id\) => getInventoryItemById\(id\)\)/);
  assert.match(source, /filter\(\(item\) => !selectedItemIds.includes\(item.id\)\)/);
  assert.match(source, /onSelectedItemIdsChange=\{rememberSelection\}/);
  assert.match(source, /<InventoryMovementForm\s+strictScope/);
  assert.match(source, /<AccessSnapshotBoundary blocked=\{!canAccessInventory\}>/);
  assert.doesNotMatch(source, /Promise.all\(\[\s*listInventoryItems/);
  for (const name of ['setCatalogSnapshot', 'setSelectedSnapshot', 'setObjectSnapshot', 'setOrderSnapshot']) assert.ok(source.includes(name));
});
