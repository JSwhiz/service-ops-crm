import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function dialog() {
  const calls = [];
  let pending;
  return { calls, ask(options) { calls.push(options); pending = deferred(); return pending.promise; }, settle(value) { pending.resolve(value); } };
}
function nodes(node, type, result = []) {
  if (Array.isArray(node)) { node.forEach(child => nodes(child, type, result)); return result; }
  if (!node || typeof node !== 'object') return result;
  if (node.type === type) result.push(node);
  nodes(node.props?.children, type, result);
  return result;
}
const button = (tree, label) => nodes(tree, 'Button').find(node => node.props.children.flat(Infinity).includes(label));

// Execute actual TSX handlers, retaining hook state while props, auth generation,
// source DTOs and ancestor concealment change. No browser/API/DB/build needed.
function harness(path, mocks) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const React = {
    Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    isValidElement: node => !!node && typeof node === 'object' && 'type' in node && 'props' in node,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useMemo: calculate => calculate(), useCallback: callback => callback,
    useContext: () => mocks.blocked?.() ?? false,
    useEffect(effect, deps) {
      const index = cursor++;
      const old = slots[index];
      if (old && deps?.every((value, i) => Object.is(value, old.deps[i]))) return;
      const entry = { deps };
      slots[index] = entry;
      effects.push(() => { old?.cleanup?.(); entry.cleanup = effect(); });
    },
  };
  React.default = React;
  const primitives = new Proxy({}, { get: (_, name) => name });
  function load(url) {
    const exports = {};
    const output = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
    new Function('require', 'exports', output)(name => name === 'react' ? React
      : mocks[name] ?? (mocks.__realDialogs && name === '@/shared/ui/overlays/use-dialogs' ? load(new URL('../../../shared/ui/overlays/use-dialogs.tsx', import.meta.url))
        : name === '../model/attachment-correction-draft' ? load(new URL('../model/attachment-correction-draft.ts', import.meta.url))
        : name.endsWith('.css') ? { default: {} } : primitives), exports);
    return exports;
  }
  const exports = load(new URL(path, import.meta.url));
  return {
    render(name, props) { cursor = 0; const tree = exports[name](props); const next = effects; effects = []; next.forEach(effect => effect()); return tree; },
    replace(predicate, replacement) { const index = slots.findIndex(predicate); assert.notEqual(index, -1); slots[index] = replacement; },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

for (const checkpoint of ['reason', 'confirm']) for (const changeGeneration of [true, false]) test(`unresolved real ${checkpoint} overlay suspends without settling (generation=${changeGeneration}); operation releases busy and requires new intent`, async () => {
  let generation = 1;
  let writable = true;
  const writes = [];
  const report = { id: 'report-a', objectId: 'object-a', revision: 3, publicationState: 'submitted', attachments: [], capabilities: { editAttachments: true } };
  const file = new File(['private'], 'private.txt');
  const h = harness('./object-report-attachments-editor.tsx', {
    __realDialogs: true,
    '@/shared/auth/access-generation': { getAccessGeneration: () => generation, isAccessGenerationCurrent: value => value === generation },
    '@/shared/api/fetcher': { ApiError: class extends Error {} },
    '@/entities/object/api/object-operations-client': {
      stageDailyReportAttachment: async (...args) => { writes.push(['stage', ...args]); return { file: { id: 'file-a' } }; },
      correctDailyReportAttachments: async (...args) => { writes.push(['patch', ...args]); return { publication: { status: 'queued' } }; },
    },
  });
  const render = () => h.render('ObjectReportAttachmentsEditor', { report: { ...report, capabilities: { editAttachments: writable } }, onUpdated: async () => {} });
  await nodes(render(), 'MediaActionPicker')[0].props.onPick(file);
  button(render(), 'Исправить вложения').props.onClick();
  let tree = render();
  if (checkpoint === 'reason') { nodes(tree, 'ReasonDialog')[0].props.onReasonChange('Private unfinished reason'); tree = render(); }
  if (checkpoint === 'confirm') { nodes(tree, 'ReasonDialog')[0].props.onConfirm('Private reason'); await flush(); tree = render(); }
  assert.equal(nodes(tree, checkpoint === 'reason' ? 'ReasonDialog' : 'ConfirmDialog')[0].props.open, true);
  writable = false; if (changeGeneration) generation += 1; render(); await flush(); tree = render();
  // Never call the suspended overlay's onConfirm/onOpenChange: its real hook
  // resolver intentionally remains pending while the logical operation ends.
  assert.equal(nodes(tree, checkpoint === 'reason' ? 'ReasonDialog' : 'ConfirmDialog')[0].props.open, true);
  assert.equal(button(tree, 'Исправить вложения').props.pending, false);
  assert.deepEqual(nodes(tree, 'PendingMediaList')[0].props.files, [file]);
  assert.deepEqual(writes, []);
  writable = true; if (changeGeneration) generation += 1; tree = render(); await flush(); tree = render();
  assert.equal(button(tree, 'Исправить вложения').props.disabled, false);
  assert.equal(nodes(tree, 'AccessSnapshotBoundary')[0].props.blocked, true, 'Abandoned dialog remains concealed until new explicit intent, even without a generation change');
  assert.deepEqual(writes, [], 'Regrant is not permission to replay the abandoned logical operation');
  button(tree, 'Исправить вложения').props.onClick(); tree = render();
  if (checkpoint === 'reason') {
    assert.equal(nodes(tree, 'ReasonDialog')[0].props.reason, 'Private unfinished reason', 'A new ask must retain the unsubmitted private text as initialValue');
    assert.deepEqual(writes, []);
    nodes(tree, 'ReasonDialog')[0].props.onConfirm('Private unfinished reason'); await flush(); tree = render();
  }
  nodes(tree, 'ConfirmDialog')[0].props.onConfirm(); await flush();
  assert.deepEqual(writes.map(row => row[0]), ['stage', 'patch']);
  assert.equal(writes[0][3], file);
  h.unmount();
});

for (const feature of ['contact', 'inventory']) for (const scenario of ['allowed', 'cancelled', 'leaf-denied', 'generation-changed', 'target-changed', 'ancestor-blocked', 'unmounted']) {
  test(`${feature} pending dialog checks fresh leaf/generation/target: ${scenario}`, async () => {
    let generation = 1, blocked = false;
    const prompt = dialog();
    const calls = [];
    const contact = { id: 'contact-a', name: 'Contact', version: 1, phones: [], emails: [], links: [] };
    const movement = { id: 'movement-a', inventoryItem: { id: 'item-a', name: 'Item', unit: 'шт' }, quantity: 2,
      unitPriceSnapshot: 17, totalAmountSnapshot: 34, createdBy: { fullName: 'User' }, createdAt: '2026-11-08', status: 'applied',
      relatedObject: { id: 'object-a' }, relatedOneTimeOrder: null, attachments: [], projection: { canCorrectMovement: true } };
    const mock = {
      blocked: () => blocked,
      '@/shared/auth/access-generation': { getAccessGeneration: () => generation, isAccessGenerationCurrent: value => value === generation },
      '@/shared/ui/overlays': { useConfirm: () => [prompt.ask, 'confirm-dialog'], useReasonPrompt: () => [prompt.ask, 'reason-dialog'] },
      '@/entities/object/api/object-planning-client': { listObjectContacts: async () => [contact], deleteObjectContact: async (...args) => { calls.push(args); } },
      '@/shared/ui/phone-list-field/phone-list-field': { phoneDrafts: () => [], phoneDraftValues: () => [] },
      '@/entities/inventory/api/inventory-client': { correctInventoryMovement: async (...args) => { calls.push(args); } },
      '@/shared/lib/display-name': { getUserDisplayName: () => 'User' },
      '@/shared/lib/inventory-presentation': { formatInventoryQuantity: () => '2 шт' },
    };
    const h = harness(feature === 'contact' ? '../../object-contacts/ui/object-contacts-panel.tsx' : '../../object-inventory/ui/object-inventory-panel.tsx', mock);
    const name = feature === 'contact' ? 'ObjectContactsPanel' : 'ObjectInventoryPanel';
    let props = feature === 'contact' ? { objectId: 'object-a', canEdit: true } : {
      movements: [movement], availableItems: [], canIssueInventoryToObject: false, onRefresh: async () => {},
    };
    h.render(name, props); await flush();
    let tree = h.render(name, props);
    button(tree, feature === 'contact' ? 'Удалить' : 'Исправить выдачу').props.onClick();
    assert.equal(prompt.calls.length, 1);
    assert.deepEqual(calls, []);
    if (scenario === 'leaf-denied') props = feature === 'contact' ? { ...props, canEdit: false }
      : { ...props, movements: [{ ...movement, projection: { canCorrectMovement: false } }] };
    if (scenario === 'target-changed') props = feature === 'contact' ? { ...props, objectId: 'object-b' }
      : { ...props, movements: [{ ...movement, relatedObject: { id: 'object-b' } }] };
    if (scenario === 'generation-changed') generation += 2; // revoke + regrant, leaf true again
    if (scenario === 'ancestor-blocked') blocked = true;
    tree = h.render(name, props);
    if (scenario === 'leaf-denied') assert.ok(nodes(tree, 'AccessSnapshotBoundary').some(node => node.props.blocked));
    if (scenario === 'unmounted') h.unmount();
    prompt.settle(scenario === 'cancelled' ? feature === 'contact' ? false : null : feature === 'contact' ? true : 'Reason');
    await flush();
    assert.deepEqual(calls, scenario === 'allowed' ? feature === 'contact' ? [['object-a', contact]] : [['movement-a', 'Reason']] : []);
  });
}

function attachmentFixture() {
  let generation = 1, blocked = false;
  const reason = dialog(), confirm = dialog();
  const staged = [], patches = [];
  let upload;
  let patch;
  const h = harness('./object-report-attachments-editor.tsx', {
    blocked: () => blocked,
    '@/shared/auth/access-generation': { getAccessGeneration: () => generation, isAccessGenerationCurrent: value => value === generation },
    '@/shared/ui/overlays/use-dialogs': { useConfirm: () => [confirm.ask, 'confirm-dialog'], useReasonPrompt: () => [reason.ask, 'reason-dialog'] },
    '@/shared/api/fetcher': { ApiError: class extends Error {} },
    '@/entities/object/api/object-operations-client': {
      stageDailyReportAttachment: async (...args) => { staged.push(args); return upload ? upload.promise : { file: { id: `file-${staged.length}` } }; },
      correctDailyReportAttachments: async (...args) => { patches.push(args); return patch ? patch.promise : { publication: { status: 'queued' } }; },
    },
  });
  const report = { id: 'report-a', objectId: 'object-a', revision: 3, publicationState: 'submitted', attachments: [], capabilities: { editAttachments: true } };
  let props = { report, onUpdated: async () => {} };
  const render = () => h.render('ObjectReportAttachmentsEditor', props);
  const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];
  return { h, render, files, report, reason, confirm, staged, patches,
    setProps: value => { props = { ...props, ...value }; }, revoke: () => { props = { ...props, report: { ...report, capabilities: { editAttachments: false } } }; },
    regrant: () => { props = { ...props, report }; generation += 1; }, invalidate: () => { generation += 2; }, block: () => { blocked = true; },
    deferUpload: () => (upload = deferred()), clearUpload: () => { upload = undefined; }, deferPatch: () => (patch = deferred()),
    async pick() { for (const file of files) await nodes(render(), 'MediaActionPicker')[0].props.onPick(file); },
    apply() { button(render(), 'Исправить вложения').props.onClick(); },
  };
}

for (const checkpoint of ['reason', 'confirm']) for (const scenario of ['allowed', 'cancelled', 'leaf-denied', 'generation-changed', 'target-changed', 'ancestor-blocked', 'parent-stale', 'unmounted']) {
  test(`report correction stops before staging after ${checkpoint}: ${scenario}`, async () => {
    const f = attachmentFixture(); await f.pick(); f.apply();
    if (checkpoint === 'confirm') { f.reason.settle('Private reason'); await flush(); assert.equal(f.confirm.calls.length, 1); }
    if (scenario === 'leaf-denied') f.revoke();
    if (scenario === 'generation-changed') f.invalidate();
    if (scenario === 'target-changed') f.setProps({ report: { ...f.report, id: 'report-b' } });
    if (scenario === 'ancestor-blocked') f.block();
    if (scenario === 'parent-stale') f.setProps({ accessCurrent: false });
    const tree = f.render();
    if (['leaf-denied', 'ancestor-blocked', 'parent-stale'].includes(scenario)) assert.ok(nodes(tree, 'AccessSnapshotBoundary').some(node => node.props.blocked));
    if (scenario === 'unmounted') f.h.unmount();
    (checkpoint === 'reason' ? f.reason : f.confirm).settle(scenario === 'cancelled' ? checkpoint === 'reason' ? null : false : checkpoint === 'reason' ? 'Private reason' : true);
    await flush();
    if (scenario === 'allowed' && checkpoint === 'reason') { f.confirm.settle(true); await flush(); }
    assert.equal(f.staged.length, scenario === 'allowed' ? 2 : 0);
    assert.equal(f.patches.length, scenario === 'allowed' ? 1 : 0);
    if (scenario !== 'allowed' && scenario !== 'unmounted') assert.equal(nodes(f.render(), 'PendingMediaList')[0].props.files.length, 2);
  });
}

test('staging acknowledgement survives revoke/regrant; no next upload/PATCH or auto replay; manual continuation reuses ID', async () => {
  const f = attachmentFixture(); await f.pick();
  const upload = f.deferUpload(); f.apply(); f.reason.settle('Keep my reason'); await flush(); f.confirm.settle(true); await flush();
  assert.equal(f.staged.length, 1);
  const acknowledgedRequest = f.staged[0][3];
  f.revoke(); f.render(); upload.resolve({ file: { id: 'acknowledged-file-a' } }); await flush();
  assert.equal(f.staged.length, 1); assert.equal(f.patches.length, 0);
  f.regrant(); f.clearUpload(); f.render(); await flush();
  assert.equal(f.staged.length, 1); assert.equal(f.patches.length, 0);
  f.apply(); await flush(); assert.equal(f.reason.calls.length, 1, 'Retain the private reason');
  f.confirm.settle(true); await flush();
  assert.equal(f.staged.length, 2, 'Only the second file is uploaded after explicit continuation');
  assert.equal(f.staged[0][3], acknowledgedRequest);
  assert.equal(f.staged[1][2], f.files[1]);
  assert.deepEqual(f.patches[0][2].addFileIds, ['acknowledged-file-a', 'file-2']);
  assert.equal(f.patches[0][2].reason, 'Keep my reason');
});

test('revocation during final PATCH retains exact explicit retry payload and staged IDs', async () => {
  const f = attachmentFixture(); await f.pick(); const patch = f.deferPatch(); f.apply();
  f.reason.settle('Private reason'); await flush(); f.confirm.settle(true); await flush();
  assert.equal(f.patches.length, 1); const payload = f.patches[0][2];
  f.revoke(); f.render(); patch.resolve({ publication: { status: 'queued' } }); await flush();
  f.regrant(); let tree = f.render(); await flush();
  assert.equal(f.patches.length, 1); assert.equal(f.staged.length, 2);
  button(tree, 'Повторить применение').props.onClick(); await flush(); tree = f.render();
  assert.equal(f.patches.length, 2); assert.equal(f.patches[1][2], payload); assert.equal(f.staged.length, 2);
});

for (const operation of ['link', 'master', 'clear-master', 'unlink']) for (const scenario of ['allowed', 'cancelled', 'leaf-denied', 'generation-changed', 'target-changed', 'selection-changed', 'unmounted']) {
  test(`counterparty ${operation} confirms only the fresh exact leaf/target: ${scenario}`, async () => {
    let generation = 1;
    const confirm = dialog(), writes = [];
    const object = { id: 'object-a', name: 'Object', address: 'Address', status: 'active' };
    const card = { id: 'cp-a', name: 'Counterparty', status: 'active', objects: [object], objectCount: 1, visibleObjectCount: 1,
      masterObject: operation === 'clear-master' ? object : null, capabilities: { canManage: true, canLinkObjects: true, canManageMasterObject: true } };
    const api = { getCounterparty: async () => card, listCounterpartyInventoryMovements: async () => ({ items: [], total: 0, totalPages: 0 }) };
    for (const [name, key] of [['linkCounterpartyObject', 'link'], ['setCounterpartyMasterObject', 'master'], ['unlinkCounterpartyObject', 'unlink']]) {
      api[name] = async (...args) => { writes.push([key, ...args]); return card; };
    }
    api.clearCounterpartyMasterObject = async (...args) => { writes.push(['clear-master', ...args]); return card; };
    const h = harness('../../../app/(app)/counterparties/[id]/page.tsx', {
      '@/shared/auth/access-generation': { getAccessGeneration: () => generation, isAccessGenerationCurrent: value => value === generation },
      '@/shared/auth/use-access-revision': { useAccessRevision: () => 'user:1' },
      '@/shared/ui/overlays': { useConfirm: () => [confirm.ask, 'confirm-dialog'] },
      '@/shared/lib/use-page-exit-guard': { usePageExitGuard: () => {} },
      '@/entities/counterparty/api/counterparty-client': api,
    });
    const props = { params: Promise.resolve({ id: card.id }) };
    const render = () => h.render('default', props);
    // Only a local hook timer needs a window shim; no DOM/browser operations.
    const oldWindow = globalThis.window, oldDocument = globalThis.document;
    globalThis.window = { setTimeout, clearTimeout }; globalThis.document = { getElementById: () => null };
    try {
      render(); await flush(); let tree = render(); await flush(); tree = render();
      button(tree, 'Редактировать').props.onClick(); tree = render();
      nodes(tree, 'textarea')[0].props.onChange({ target: { value: 'Private counterparty notes' } }); tree = render();
      if (operation === 'link') {
        button(tree, 'Добавить объект').props.onClick(); tree = render();
        nodes(tree, 'SearchableSelect')[0].props.onChange('object-a'); tree = render();
        button(tree, 'Привязать объект').props.onClick();
      } else {
        nodes(tree, 'OverflowMenu').flatMap(node => node.props.items).find(item => item.key === (operation === 'clear-master' ? 'master' : operation)).onSelect();
      }
      assert.equal(confirm.calls.length, 1); assert.deepEqual(writes, []);
      if (scenario === 'leaf-denied') h.replace(value => value === card, { ...card, capabilities: { ...card.capabilities,
        ...(['master', 'clear-master'].includes(operation) ? { canManageMasterObject: false } : { canLinkObjects: false }) } });
      if (scenario === 'target-changed') h.replace(value => value === card, { ...card, id: 'cp-b' });
      if (scenario === 'selection-changed') {
        if (operation === 'link') h.replace(value => value === 'object-a', 'object-b');
        else h.replace(value => value === card, { ...card, objects: [] });
      }
      if (scenario === 'generation-changed') generation += 2;
      tree = render();
      if (scenario === 'leaf-denied') assert.ok(nodes(tree, 'AccessSnapshotBoundary').some(node => node.props.blocked));
      if (scenario === 'unmounted') h.unmount();
      confirm.settle(scenario !== 'cancelled'); await flush();
      assert.deepEqual(writes, scenario === 'allowed' ? [operation === 'clear-master' ? [operation, 'cp-a'] : [operation, 'cp-a', 'object-a']] : []);
      if (scenario !== 'unmounted') assert.equal(nodes(render(), 'textarea')[0].props.value, 'Private counterparty notes');
    } finally { h.unmount(); globalThis.window = oldWindow; globalThis.document = oldDocument; }
  });
}

test('report-history access refresh conceals but retains same-key editors until fresh capabilities arrive', async () => {
  let revision = 'user:1', generation = 1;
  let nextRead;
  const report = { id: 'report-a', objectId: 'object-a', revision: 3, reportDate: '2026-11-08', updatedAt: '2026-11-08',
    updatedBy: { fullName: 'User' }, content: 'Content', publicationState: 'submitted', capabilities: { editAttachments: true } };
  const h = harness('./object-reports-panel.tsx', {
    'next/navigation': { useSearchParams: () => ({ get: key => key === 'reportDate' ? '2026-11-08' : null, has: () => false }) },
    '@/shared/auth/use-access-revision': { useAccessRevision: () => revision },
    '@/shared/auth/access-generation': { getAccessGeneration: () => generation, isAccessGenerationCurrent: value => value === generation },
    '@/entities/object/api/object-operations-client': { listObjectDailyReports: async () => nextRead ? nextRead.promise : [report] },
    '../model/report-link': { isRealReportDate: () => true, isReportId: () => true, shouldRenderCachedReportsForDate: (date, loaded) => date === loaded },
  });
  const render = () => h.render('ObjectReportsPanel', { objectId: 'object-a' });
  render(); await flush(); let tree = render();
  assert.equal(nodes(tree, 'ObjectReportAttachmentsEditor')[0].props.accessCurrent, true);
  const key = nodes(tree, 'AccessSnapshotBoundary')[0].props.key;
  nextRead = deferred(); revision = 'user:2'; generation += 1;
  render(); tree = render();
  assert.equal(nodes(tree, 'ObjectReportAttachmentsEditor').length, 1, 'Do not unmount the local attachment draft during access refresh');
  assert.equal(nodes(tree, 'ObjectReportAttachmentsEditor')[0].props.accessCurrent, false);
  assert.equal(nodes(tree, 'AccessSnapshotBoundary')[0].props.blocked, true);
  assert.equal(nodes(tree, 'AccessSnapshotBoundary')[0].props.key, key);
  nextRead.resolve([{ ...report, capabilities: { editAttachments: false } }]); await flush(); tree = render();
  assert.equal(nodes(tree, 'ObjectReportAttachmentsEditor')[0].props.report.capabilities.editAttachments, false);
  h.unmount();
});

test('daily report passes fresh item correction denial before its cached report effect runs', () => {
  const report = { id: 'report-a', objectId: 'object-a', revision: 3, updatedAt: '2026-11-08', updatedBy: { fullName: 'User' },
    content: 'Private report', publicationState: 'submitted', capabilities: { editAttachments: true } };
  const h = harness('./object-daily-report-panel.tsx', {});
  const props = { item: report, onSave: async () => report, onAttachmentsUpdated: async () => report };
  let tree = h.render('ObjectDailyReportPanel', props);
  assert.equal(nodes(tree, 'ObjectReportAttachmentsEditor')[0].props.accessCurrent, true);
  tree = h.render('ObjectDailyReportPanel', { ...props, item: { ...report, capabilities: { editAttachments: false } } });
  assert.equal(nodes(tree, 'ObjectReportAttachmentsEditor')[0].props.accessCurrent, false);
  assert.equal(nodes(tree, 'textarea')[0].props.value, 'Private report');
  h.unmount();
});

for (const checkpoint of ['issue', 'refresh', 'first-upload', 'last-upload', 'second-issue']) {
  for (const scenario of ['leaf-denied', 'revoke-regrant', 'ancestor-blocked', 'target-unmounted']) test(`issue chain ${checkpoint}: ${scenario} stops before another side effect and retains acknowledgements`, async () => {
    let generation = 1, writable = true, blocked = false, paused = false;
    const pause = deferred(), issued = [], uploaded = [];
    let reads = 0;
    const files = [new File(['a'], 'a.jpg'), new File(['b'], 'b.jpg')];
    const props = {
      movements: [], availableItems: ['item-a', 'item-b'].map(id => ({ id, name: id, unit: 'шт', currentStock: 10, currentUnitPrice: 17 })),
      onIssue: async payload => {
        issued.push(payload);
        const id = payload.inventoryItemId === 'item-a' ? 'movement-a' : 'movement-b';
        if (!paused && ((checkpoint === 'issue' && issued.length === 1) || (checkpoint === 'second-issue' && issued.length === 2))) { paused = true; await pause.promise; }
        return id;
      },
      onRefresh: async () => { reads += 1; if (!paused && checkpoint === 'refresh') { paused = true; await pause.promise; } },
      onAttachEvidence: async (id, attachments) => {
        uploaded.push([id, ...attachments]);
        if (!paused && ((checkpoint === 'first-upload' && uploaded.length === 1) || (checkpoint === 'last-upload' && uploaded.length === 2))) { paused = true; await pause.promise; }
      },
    };
    const h = harness('../../object-inventory/ui/object-inventory-panel.tsx', {
      blocked: () => blocked,
      '@/shared/auth/access-generation': { getAccessGeneration: () => generation, isAccessGenerationCurrent: value => value === generation },
      '@/shared/ui/overlays': { useReasonPrompt: () => [async () => null, null] },
      '@/shared/lib/inventory-presentation': { formatInventoryQuantity: () => '10 шт' },
    });
    const render = () => h.render('ObjectInventoryPanel', { ...props, canIssueInventoryToObject: writable });
    let tree = render(); nodes(tree, 'SearchableSelect')[0].props.onChange('item-a'); tree = render();
    button(tree, 'Добавить позицию').props.onClick(); tree = render();
    nodes(tree, 'SearchableSelect')[1].props.onChange('item-b'); tree = render();
    nodes(tree, 'textarea')[0].props.onChange({ target: { value: 'Private issue comment' } });
    for (const file of files) await nodes(render(), 'MediaActionPicker')[0].props.onPick(file);
    tree = render(); nodes(tree, 'form')[0].props.onSubmit({ preventDefault() {} }); await flush();
    assert.equal(paused, true);
    const counts = [issued.length, uploaded.length, reads];
    if (scenario === 'leaf-denied') writable = false;
    if (scenario === 'revoke-regrant') generation += 2;
    if (scenario === 'ancestor-blocked') blocked = true;
    render();
    if (scenario === 'target-unmounted') h.unmount(); // Actual parent changes the objectId key.
    pause.resolve(); await flush();
    assert.deepEqual([issued.length, uploaded.length, reads], counts, 'No refresh/upload/next issue after the awaited step invalidates');
    if (scenario === 'target-unmounted') return;
    tree = render();
    assert.equal(nodes(tree, 'textarea')[0].props.value, 'Private issue comment');
    assert.deepEqual(nodes(tree, 'PendingMediaList')[0].props.files, files);
    writable = true; blocked = false; generation += 1; tree = render(); await flush();
    assert.deepEqual([issued.length, uploaded.length, reads], counts, 'Regrant never automatically continues the chain');
    tree = render(); nodes(tree, 'form')[0].props.onSubmit({ preventDefault() {} }); await flush();
    assert.deepEqual(issued.map(row => row.inventoryItemId), ['item-a', 'item-b'], 'Acknowledged movement IDs are reused rather than issued twice');
    assert.deepEqual(uploaded, [['movement-a', files[0]], ['movement-a', files[1]], ['movement-b', files[0]], ['movement-b', files[1]]], 'Every movement/file pair uploads once, including pre-revoke acknowledgements');
    h.unmount();
  });
}

for (const checkpoint of ['before-post', 'awaiting-response']) test(`contact edit ${checkpoint}: live deny blocks writes/clearing while preserving private form`, async () => {
  let generation = 1, writable = true;
  const writes = [], pending = deferred();
  const contact = { id: 'contact-a', name: 'Original', version: 1, phones: [], emails: [], links: [], notes: 'Original notes' };
  const h = harness('../../object-contacts/ui/object-contacts-panel.tsx', {
    '@/shared/auth/access-generation': { getAccessGeneration: () => generation, isAccessGenerationCurrent: value => value === generation },
    '@/shared/ui/overlays': { useConfirm: () => [async () => false, null] },
    '@/shared/ui/phone-list-field/phone-list-field': { phoneDrafts: () => [], phoneDraftValues: () => [] },
    '@/entities/object/api/object-planning-client': { listObjectContacts: async () => [contact], saveObjectContact: async (...args) => {
      writes.push(args); return checkpoint === 'awaiting-response' && writes.length === 1 ? pending.promise : { ...contact, ...args[2] };
    } },
  });
  const render = () => h.render('ObjectContactsPanel', { objectId: 'object-a', canEdit: writable });
  render(); await flush(); let tree = render(); button(tree, 'Изменить').props.onClick(); tree = render();
  nodes(tree, 'ContactEditor')[0].props.onChange({ ...nodes(tree, 'ContactEditor')[0].props.value, name: 'Private name', notes: 'Private notes' });
  tree = render(); const oldSubmit = nodes(tree, 'form')[0].props.onSubmit;
  if (checkpoint === 'awaiting-response') { oldSubmit({ preventDefault() {} }); await flush(); assert.equal(writes.length, 1); }
  writable = false; generation += 1; tree = render();
  assert.equal(nodes(tree, 'ContactEditor')[0].props.disabled, true);
  assert.equal(button(tree, 'Сохранить контакт').props.disabled, true);
  assert.ok(nodes(tree, 'AccessSnapshotBoundary').some(node => node.props.blocked));
  oldSubmit({ preventDefault() {} }); await flush();
  assert.equal(writes.length, checkpoint === 'awaiting-response' ? 1 : 0);
  if (checkpoint === 'awaiting-response') { pending.resolve({ ...contact, name: 'Private name', notes: 'Private notes' }); await flush(); }
  tree = render(); assert.equal(nodes(tree, 'ContactEditor')[0].props.value.notes, 'Private notes');
  writable = true; generation += 1; tree = render(); await flush();
  assert.equal(nodes(tree, 'ContactEditor')[0].props.value.name, 'Private name');
  assert.equal(writes.length, checkpoint === 'awaiting-response' ? 1 : 0, 'Regrant does not submit the retained form');
  if (checkpoint === 'before-post') { nodes(tree, 'form')[0].props.onSubmit({ preventDefault() {} }); await flush(); assert.equal(writes.length, 1); }
  h.unmount();
});

test('in-flight report staging retains its acknowledgement before releasing busy; no overlapping upload after regrant', async () => {
  const f = attachmentFixture(); await f.pick(); const upload = f.deferUpload();
  f.apply(); f.reason.settle('Private reason'); await flush(); f.confirm.settle(true); await flush();
  assert.equal(f.staged.length, 1);
  f.revoke(); f.render(); await flush();
  f.regrant(); let tree = f.render(); await flush(); tree = f.render();
  assert.equal(button(tree, 'Исправить вложения').props.pending, true, 'Network acknowledgement still outstanding');
  f.apply(); await flush(); assert.equal(f.staged.length, 1, 'Invalidation is not permission to overlap a network upload');
  upload.resolve({ file: { id: 'ack-before-release' } }); await flush(); tree = f.render();
  assert.equal(button(tree, 'Исправить вложения').props.pending, false);
  assert.equal(f.patches.length, 0);
  f.clearUpload(); f.apply(); await flush(); f.confirm.settle(true); await flush();
  assert.equal(f.staged.length, 2);
  assert.deepEqual(f.patches[0][2].addFileIds, ['ack-before-release', 'file-2']);
});

for (const editWhilePending of [true, false]) test(`successful issue clears only its submitted comment; newer mid-await edit=${editWhilePending}`, async () => {
  const pending = deferred(), issued = [];
  const props = {
    movements: [], availableItems: [{ id: 'item-a', name: 'Item', unit: 'шт', currentStock: 10, currentUnitPrice: 17 }],
    canIssueInventoryToObject: true,
    onIssue: async payload => { issued.push(payload); await pending.promise; return 'movement-a'; },
    onRefresh: async () => {}, onAttachEvidence: async () => {},
  };
  const h = harness('../../object-inventory/ui/object-inventory-panel.tsx', {
    '@/shared/auth/access-generation': { getAccessGeneration: () => 1, isAccessGenerationCurrent: value => value === 1 },
    '@/shared/ui/overlays': { useReasonPrompt: () => [async () => null, null] },
    '@/shared/lib/inventory-presentation': { formatInventoryQuantity: () => '10 шт' },
  });
  const render = () => h.render('ObjectInventoryPanel', props);
  let tree = render(); nodes(tree, 'SearchableSelect')[0].props.onChange('item-a');
  tree = render(); nodes(tree, 'textarea')[0].props.onChange({ target: { value: '  Submitted comment  ' } });
  tree = render(); nodes(tree, 'form')[0].props.onSubmit({ preventDefault() {} }); await flush();
  assert.deepEqual(issued, [{ inventoryItemId: 'item-a', quantity: 1, comment: 'Submitted comment' }]);
  if (editWhilePending) {
    tree = render();
    assert.notEqual(nodes(tree, 'textarea')[0].props.disabled, true);
    nodes(tree, 'textarea')[0].props.onChange({ target: { value: 'New private comment typed during issuance' } });
    render();
  }
  pending.resolve(); await flush(); tree = render();
  assert.equal(nodes(tree, 'textarea')[0].props.value, editWhilePending ? 'New private comment typed during issuance' : '');
  assert.equal(issued.length, 1, 'Keeping the newer draft must not replay the successful issue');
  assert.equal(nodes(tree, 'SearchableSelect')[0].props.value, '', 'The successful batch completed and reset its issue line');
  h.unmount();
});
