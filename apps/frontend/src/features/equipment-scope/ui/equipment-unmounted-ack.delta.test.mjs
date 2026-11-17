import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function nodes(node, type, result = []) {
  if (Array.isArray(node)) { node.forEach(child => nodes(child, type, result)); return result; }
  if (!node || typeof node !== 'object') return result;
  if (node.type === type) result.push(node);
  nodes(node.props?.children, type, result);
  return result;
}
const button = (tree, label) => nodes(tree, 'Button').find(node => node.props.children.flat(Infinity).includes(label));

// Execute the actual consumer and its panel callback. Hold the real handler's
// write promise across cleanup; detect any local state write after unmount.
function harness(file, mocks) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let unmounted = false;
  let lateStateWrites = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const React = {
    Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => { if (unmounted) lateStateWrites++; slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useId() { cursor++; return 'resource-form'; },
    useCallback(callback, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { callback, deps }; return slots[index].callback; },
    useEffect(effect, deps) { const index = cursor++; const old = slots[index]; if (same(old?.deps, deps)) return;
      const entry = { deps }; slots[index] = entry; effects.push(() => { old?.cleanup?.(); entry.cleanup = effect(); }); },
  };
  React.default = React;
  const primitives = new Proxy({}, { get: (_, name) => name });
  const exports = {};
  const output = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  new Function('require', 'exports', output)(name => name === 'react' ? React : mocks[name] ?? (name.endsWith('.css') ? { default: {} } : primitives), exports);
  return {
    render(name, props) { cursor = 0; const tree = exports[name](props); const pending = effects; effects = []; pending.forEach(effect => effect()); return tree; },
    unmount() { unmounted = true; slots.forEach(slot => slot?.cleanup?.()); },
    lateStateWrites: () => lateStateWrites,
  };
}

for (const responseKind of ['saved_without_access', 'plain-201']) for (const change of ['same-context', 'new-session', 'new-actor', 'new-order']) {
  test(`unmounted equipment delta: ${responseKind}, ${change}`, async () => {
    let actorId = 'actor-a';
    let session = 1;
    let generation = 1;
    let orderId = 'order-a';
    let reads = 0;
    let refreshes = 0;
    let posts = 0;
    const notices = [];
    const response = deferred();
    const h = harness('./equipment-order-actions.tsx', {
      '@/shared/auth/use-auth': { useAuth: () => ({ user: { id: actorId } }) },
      '@/shared/auth/use-access-revision': { useAccessRevision: () => `${actorId}:${generation}` },
      '@/shared/auth/use-open-access-refresh': { useOpenAccessRefresh() {} },
      '@/shared/lib/use-page-exit-guard': { usePageExitGuard() {} },
      '@/shared/auth/access-generation': { getAccessGeneration: () => generation, getAccessSessionGeneration: () => session, isAccessGenerationCurrent: value => value === generation },
      '@/shared/api/saved-without-access': { isSavedWithoutAccess: result => result.outcome === 'saved_without_access' },
      '@/shared/api/fetcher': { ApiError: class extends Error {},
        fetcher: async () => { reads++; return { canAssign: true, availableUnits: [{ id: 'unit-a', name: 'Machine', inventoryNumber: 'EQ-1' }], returnableUnitIds: [] }; },
        postCommittedWrite: () => { posts++; return response.promise; },
      },
      '@/shared/ui/overlays': { useConfirm: () => [async () => true, null] },
    });
    const units = [];
    const render = () => h.render('EquipmentOrderActions', { orderId, units, onRefresh: async () => { refreshes++; }, onSavedWithoutAccess: (...args) => notices.push(args) });
    render(); await flush();
    button(render(), 'Закрепить оборудование').props.onClick();
    nodes(render(), 'SearchableSelect')[0].props.onChange('unit-a');
    nodes(render(), 'textarea')[0].props.onChange({ target: { value: 'Private unfinished comment' } });
    nodes(render(), 'form')[0].props.onSubmit({ preventDefault() {} });
    assert.equal(posts, 1);
    if (change === 'new-session') session++;
    if (change === 'new-actor') actorId = 'actor-b';
    if (change === 'new-order') orderId = 'order-b';
    if (change !== 'same-context') render();
    h.unmount();
    const readsBeforeReply = reads;
    response.resolve(responseKind === 'saved_without_access' ? { outcome: 'saved_without_access' }
      : { id: 'unit-a', movementId: 'movement-a', status: 'assigned_to_one_time_order', privateDetails: 'must never be projected' });
    await flush();
    assert.equal(notices.length, change === 'same-context' ? 1 : 0);
    if (notices.length) assert.deepEqual(notices[0], [], 'Root receives a generic acknowledgement, never the protected response');
    assert.equal(reads, readsBeforeReply);
    assert.equal(refreshes, 0);
    assert.equal(posts, 1);
    assert.equal(h.lateStateWrites(), 0);
  });
}

test('unmounted scope panel forwards its captured generic callback without a local state update', () => {
  let notices = 0;
  const h = harness('./equipment-scope-panel.tsx', { './equipment-order-actions': { EquipmentOrderActions: 'EquipmentOrderActions' } });
  const tree = h.render('EquipmentScopePanel', { title: 'Equipment', orderId: 'order-a', units: [], onRefresh: async () => {}, onSavedWithoutAccess: () => { notices++; } });
  const callback = nodes(tree, 'EquipmentOrderActions')[0].props.onSavedWithoutAccess;
  h.unmount(); callback();
  assert.equal(notices, 1);
  assert.equal(h.lateStateWrites(), 0);
});
