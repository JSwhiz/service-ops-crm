import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { assignManagerWithConflictConfirmation } from '../../one-time-order-managers/lib/assign-manager-with-conflicts.ts';

// Execute the real, source-extracted TSX closures with controlled dependencies.
// No React renderer, browser, HTTP server or database is involved.
const root = new URL('../../../', import.meta.url);
const paths = {
  order: 'app/(app)/one-time-orders/[id]/page.tsx',
  object: 'app/(app)/objects/[id]/page.tsx',
  candidate: 'app/(app)/candidates/[id]/page.tsx',
  create: 'features/one-time-order-form/ui/one-time-order-create-dialog.tsx',
  form: 'features/one-time-order-form/ui/one-time-order-form.tsx',
  completion: 'features/one-time-order-completion/ui/one-time-order-completion-panel.tsx',
  preview: 'features/one-time-order-list/ui/one-time-order-preview-drawer.tsx',
  specification: 'features/one-time-order-specification/ui/one-time-order-specification-panel.tsx',
  photos: 'features/one-time-order-photos/ui/one-time-order-photos-panel.tsx',
};
const sources = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key,
  ts.createSourceFile(path, readFileSync(new URL(path, root), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
]));
function find(file, predicate) {
  let result;
  function visit(node) {
    if (!result && predicate(node)) result = node;
    if (!result) ts.forEachChild(node, visit);
  }
  visit(sources[file]);
  assert.ok(result, `source node in ${file}`);
  return result;
}
const declaration = (file, name) => find(file, (node) => ts.isVariableDeclaration(node) && node.name.getText() === name).initializer;
function handler(file, api, attribute = 'onConfirm') {
  return find(file, (node) => ts.isJsxAttribute(node) && node.name.getText() === attribute &&
    node.initializer && node.initializer.getText().includes(api)).initializer.expression;
}
function dialogAttribute(file, api, attribute) {
  const dialog = find(file, (node) => ts.isJsxSelfClosingElement(node) && node.attributes.properties.some((prop) =>
    ts.isJsxAttribute(prop) && prop.name.getText() === 'onConfirm' && prop.initializer?.getText().includes(api)));
  return dialog.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText() === attribute).initializer.expression;
}
function execute(node, bindings) {
  const source = ts.transpileModule(`const extracted = (${node.getText()});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
    reportDiagnostics: true,
  });
  assert.deepEqual(source.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error), []);
  return new Function(...Object.keys(bindings), `${source.outputText}\nreturn extracted;`)(...Object.values(bindings));
}
function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const noop = () => {};
function access() {
  let generation = 1;
  return {
    getAccessGeneration: () => generation,
    isAccessGenerationCurrent: (captured) => captured === generation,
    revokeRegrant: () => { generation += 2; },
  };
}
function orderFixture() {
  const item = {
    id: 'order-a', status: 'cancelled', executionStartDate: '2026-11-01', executionEndDate: '2026-11-02',
    managers: [{ userId: 'manager' }], capabilities: { canManageManagers: true, canChangeStatus: true, canEditOperationalFields: true },
  };
  const params = Promise.resolve({ id: item.id });
  const accessRevision = 'user:1';
  const orderContext = { current: { item, params, accessRevision, ready: true } };
  const acl = access();
  const captureOrderAction = execute(declaration('order', 'captureOrderAction'), { item, params, accessRevision, orderContext, ...acl });
  return { item, params, accessRevision, orderContext, acl, captureOrderAction };
}

for (const [api, attribute, leaf] of [
  ['assignOneTimeOrderManager', 'onAssign', 'canManageManagers'],
  ['changeOneTimeOrderStatus', 'onClick', 'canChangeStatus'],
  ['updateOneTimeOrder', 'onSubmit', 'canEditOperationalFields'],
]) {
  for (const scenario of ['allowed', 'leaf-denied-during-check', 'regrant-during-confirm', 'entity-changed-before-start', 'dto-refreshed-during-confirm']) {
    test(`${api}: ${scenario}`, async () => {
      const fixture = orderFixture();
      const check = deferred();
      const confirmation = deferred();
      const calls = [], writes = [];
      const fingerprint = 'a'.repeat(64);
      let confirmationGuard;
      const run = execute(handler('order', api, attribute), {
        ...fixture,
        option: { value: 'in_progress' },
        checkOneTimeOrderConflicts: () => check.promise,
        confirmScheduleConflicts: (_conflicts, isCurrent) => {
          confirmationGuard = isCurrent;
          return isCurrent() ? confirmation.promise : Promise.resolve(false);
        },
        assignManagerWithConflictConfirmation,
        getAccessSessionGeneration: () => 1,
        latestParams: { current: fixture.params },
        user: { id: 'actor-a' },
        isSavedWithoutAccess: (value) => value?.outcome === 'saved_without_access',
        setSavedManagerAssignment: noop,
        [api]: async (...args) => {
          calls.push(args);
          if (api === 'assignOneTimeOrderManager' && args[2] === undefined) {
            // The first assignment request reports a real server-side conflict
            // without persisting. A second write requires explicit confirmation.
            await check.promise;
            throw Object.assign(new Error('Schedule conflict', { cause: {
              hasConflicts: true, conflicts: [], conflictFingerprint: fingerprint,
            } }), { name: 'ApiError', statusCode: 409 });
          }
          writes.push(args);
          return fixture.item;
        },
        setItem: noop, loadAll: async () => {}, setIsEditing: noop, setIsEditFormDirty: noop,
      });
      if (scenario === 'entity-changed-before-start') {
        fixture.orderContext.current = { ...fixture.orderContext.current, item: { ...fixture.item, id: 'order-b' } };
      }
      const pending = run(api === 'assignOneTimeOrderManager' ? 'manager' : {
        executionStartDate: '2026-11-01', executionEndDate: '2026-11-02',
      });
      if (scenario === 'leaf-denied-during-check') fixture.item.capabilities[leaf] = false;
      check.resolve({ hasConflicts: true, conflicts: [], conflictFingerprint: 'fp' });
      await flush();
      if (scenario === 'regrant-during-confirm') fixture.acl.revokeRegrant();
      if (scenario === 'dto-refreshed-during-confirm') {
        fixture.orderContext.current = { ...fixture.orderContext.current, item: { ...fixture.item } };
      }
      if (confirmationGuard && scenario !== 'allowed') assert.equal(confirmationGuard(), false);
      confirmation.resolve(true);
      await pending;
      assert.equal(writes.length, scenario === 'allowed' ? 1 : 0);
      const expectedRequests = api === 'assignOneTimeOrderManager'
        ? scenario === 'entity-changed-before-start' ? 0 : scenario === 'allowed' ? 2 : 1
        : scenario === 'allowed' ? 1 : 0;
      assert.equal(calls.length, expectedRequests);
      if (writes.length) {
        assert.equal(writes[0][0], 'order-a');
        if (api === 'assignOneTimeOrderManager') assert.equal(writes[0][2], fingerprint);
      }
    });
  }
}

for (const copyFromId of [null, 'source-a']) {
  for (const scenario of ['allowed', 'denied-during-check', 'regrant-during-confirm', 'source-switched']) {
    test(`${copyFromId ? 'copy' : 'create'} conflict: ${scenario}`, async () => {
      const acl = access();
      const context = { current: { scope: 'origin', allowed: true } };
      const check = deferred();
      const calls = [];
      let prompt;
      let cleared = false;
      const run = execute(handler('create', 'copyOneTimeOrder', 'onSubmit'), {
        ...acl, context, scope: 'origin', copyFromId,
        draft: { submit: (callback) => callback(), clear: () => { cleared = true; } },
        router: { push: (url) => calls.push(['navigate', url]) },
        checkOneTimeOrderConflicts: () => check.promise,
        setConflictPrompt: (next) => { prompt = next; },
        copyOneTimeOrder: async (id) => { calls.push(['copy', id]); return { id: 'created' }; },
        createOneTimeOrder: async () => { calls.push(['create']); return { id: 'created' }; },
      });
      const pending = run({ plannedPaymentMethod: 'cash', executionStartDate: '2026-11-01', executionEndDate: '2026-11-02', managerUserIds: ['manager'] });
      if (scenario === 'denied-during-check') context.current.allowed = false;
      check.resolve({ hasConflicts: true, conflicts: [], conflictFingerprint: 'fp' });
      await flush();
      if (scenario === 'regrant-during-confirm') acl.revokeRegrant();
      if (scenario === 'source-switched') context.current.scope = 'other-source';
      if (prompt) prompt.resolve(true); // Even a retained callback cannot revive an old intent.
      await pending;
      assert.equal(calls.length, scenario === 'allowed' ? 2 : 0);
      assert.equal(cleared, scenario === 'allowed');
    });
  }
}

for (const leaf of ['canChangeStatus', 'canArchive', 'canConvert']) {
  test(`candidate ${leaf}: current leaf, entity, version, route, read snapshot and generation`, () => {
    const acl = access();
    const candidate = { id: 'candidate-a', version: 7, capabilities: { [leaf]: true } };
    const params = Promise.resolve({ id: candidate.id });
    const accessRevision = 'user:1';
    const origin = { candidate, params, accessRevision, ready: true };
    const candidateContext = { current: origin };
    const capture = execute(declaration('candidate', 'captureCandidateAction'), { ...acl, candidate, params, accessRevision, candidateContext });
    const guard = capture(leaf);
    assert.equal(guard(), true);
    for (const changed of [
      { ...origin, ready: false },
      { ...origin, params: Promise.resolve({ id: 'candidate-b' }) },
      { ...origin, candidate: { ...candidate, id: 'candidate-b' } },
      { ...origin, candidate: { ...candidate, version: 8 } },
      { ...origin, candidate: { ...candidate, capabilities: { [leaf]: false, canManage: false } } },
    ]) {
      candidateContext.current = changed;
      assert.equal(guard(), false);
      // A stale render's handler must not capture the new target and then write the old one.
      assert.equal(capture(leaf)(), false);
    }
    candidateContext.current = origin;
    acl.revokeRegrant();
    assert.equal(guard(), false);
    assert.equal(capture(leaf)(), true, 'only a new explicit intent may use the new generation');
  });
}

test('candidate status/archive final callbacks reject replaced dialog refs before mutation', () => {
  for (const [api, attribute] of [['changeCandidateStatus', null], ['setCandidateArchive', 'onConfirm']]) {
    let mutations = 0;
    const candidateIntent = { kind: api === 'changeCandidateStatus' ? 'status' : 'archive', isCurrent: () => true };
    const candidateIntentRef = { current: { ...candidateIntent } };
    const bindings = {
      candidateIntent, candidateIntentRef, statusTarget: 'accepted', isIntentCurrent: () => false,
      mutate: () => { mutations += 1; return Promise.resolve(true); },
    };
    const callback = execute(attribute ? handler('candidate', api) : declaration('candidate', 'confirmStatusChange'), bindings);
    callback();
    assert.equal(mutations, 0);
  }
});

for (const [api, kind, leaf] of [
  ['changeCandidateStatus', 'status', 'canChangeStatus'],
  ['setCandidateArchive', 'archive', 'canArchive'],
  ['convertCandidateToEmployee', 'convert', 'canConvert'],
]) {
  for (const scenario of ['allowed', 'revoked', 'read-hidden', 'regrant']) {
    test(`candidate final ${kind}: ${scenario}`, async () => {
      const acl = access();
      const candidate = { id: 'candidate-a', version: 3, capabilities: { [leaf]: true, canManage: false, canViewEmployee: false } };
      const params = Promise.resolve({ id: candidate.id });
      const accessRevision = 'user:1';
      const candidateContext = { current: { candidate, params, accessRevision, ready: true } };
      const capture = execute(declaration('candidate', 'captureCandidateAction'), { ...acl, candidate, params, accessRevision, candidateContext });
      const candidateIntent = { kind, isCurrent: capture(leaf) };
      const candidateIntentRef = { current: candidateIntent };
      const isIntentCurrent = execute(declaration('candidate', 'isIntentCurrent'), { candidateIntent, candidateIntentRef });
      const calls = [];
      let applied = 0;
      const bindings = {
        ...acl, params, accessRevision, candidateContext, mutationSequence: { current: 0 },
        candidate, candidateIntent, candidateIntentRef, isIntentCurrent, statusTarget: 'accepted', saving: false,
        reopenNeedsManagers: false, employeeType: 'regular', setSaving: noop, setError: noop, setConversionError: noop,
        setStatusTarget: noop, setArchiveOpen: noop, setConverting: noop, apply: () => { applied += 1; },
        router: { push: noop },
        [api]: async (...args) => { calls.push(args); return candidate; },
      };
      bindings.mutate = execute(declaration('candidate', 'mutate'), bindings);
      const callback = execute(kind === 'status' ? declaration('candidate', 'confirmStatusChange') : handler('candidate', api), bindings);
      if (scenario === 'revoked') candidate.capabilities[leaf] = false;
      if (scenario === 'read-hidden') candidateContext.current.ready = false;
      if (scenario === 'regrant') acl.revokeRegrant();
      callback();
      await flush();
      assert.equal(calls.length, scenario === 'allowed' ? 1 : 0);
      assert.equal(applied, scenario === 'allowed' ? 1 : 0);
      if (calls.length) assert.equal(calls[0][0], 'candidate-a');
    });
  }
}

for (const scenario of ['allowed', 'leaf-denied-during-check', 'regrant-during-confirm', 'dto-replaced']) {
  test(`preview status final guard: ${scenario}`, async () => {
    const acl = access();
    const order = { id: 'order-a', status: 'cancelled', executionStartDate: '2026-11-01', executionEndDate: '2026-11-02', managers: [{ userId: 'manager' }], capabilities: { canChangeStatus: true } };
    const liveContext = { current: { scope: 'scope-a', ready: true, details: order } };
    const captureItemOperation = execute(declaration('preview', 'captureItemOperation'), {
      ...acl, item: order, itemRef: { current: order }, itemGeneration: { current: 1 }, liveContext, scope: 'scope-a',
    });
    const check = deferred();
    const calls = [];
    let prompt;
    const run = execute(declaration('preview', 'applyStatus'), {
      order, status: order.status, nextStatus: 'in_progress', canChangeStatus: true, savingStatus: false, loadedScope: 'scope-a', scope: 'scope-a',
      liveContext, captureItemOperation, setSavingStatus: noop, setError: noop, setNotice: noop, setNextStatus: noop, setStatusMenuOpen: noop, setDetails: noop,
      checkOneTimeOrderConflicts: () => check.promise, setConflictPrompt: (next) => { prompt = next; },
      changeOneTimeOrderStatus: async (...args) => { calls.push(args); return order; }, getOneTimeOrderStatusLabel: () => '',
    });
    const pending = run();
    if (scenario === 'leaf-denied-during-check') order.capabilities.canChangeStatus = false;
    check.resolve({ hasConflicts: true, conflicts: [], conflictFingerprint: 'fp' });
    await flush();
    if (scenario === 'regrant-during-confirm') acl.revokeRegrant();
    if (scenario === 'dto-replaced') liveContext.current.details = { ...order };
    prompt?.resolve(true);
    await pending;
    assert.equal(calls.length, scenario === 'allowed' ? 1 : 0);
  });
}

for (const scenario of ['allowed', 'detach-leaf-denied', 'execute-denied', 'regrant', 'read-hidden', 'file-rebound', 'read-failure', 'revoke-during-revalidation']) {
  test(`specification attachment revalidation: ${scenario}`, async () => {
    const acl = access();
    const row = { id: 'item-a', attachments: [{ id: 'file-a' }] };
    const liveContext = { current: { orderId: 'order-a', accessRevision: 'user:1', snapshotBlocked: false, canExecute: true, canDetachCurrent: true, canCommentCurrent: true, canEditCurrentStructure: true, items: [row] } };
    const capture = execute(declaration('specification', 'captureSpecificationAction'), {
      ...acl, orderId: 'order-a', accessRevision: 'user:1', mounted: { current: true }, liveContext,
    });
    const attachmentIntent = capture('item-a', 'file-a');
    const pendingIntents = { current: { attachmentIntent } };
    const read = deferred();
    const calls = [];
    const errors = [];
    const callback = execute(handler('specification', 'detachOneTimeOrderSpecificationAttachment'), {
      attachmentIntent, pendingIntents, attachmentTarget: { item: row, fileId: 'file-a' }, isDetachingAttachment: false,
      orderId: 'order-a', setIsDetachingAttachment: noop, setItems: noop, setAttachmentTarget: noop,
      cancelAttachment: noop,
      setError: (error) => errors.push(error), load: async () => {},
      listOneTimeOrderSpecificationItems: async () => { calls.push('read'); if (scenario === 'read-failure') throw new Error('read failed'); return read.promise; },
      detachOneTimeOrderSpecificationAttachment: async (...args) => { calls.push(args); },
    });
    if (scenario === 'detach-leaf-denied') liveContext.current.canDetachCurrent = false;
    if (scenario === 'execute-denied') liveContext.current.canExecute = false;
    if (scenario === 'regrant') acl.revokeRegrant();
    if (scenario === 'read-hidden') liveContext.current.snapshotBlocked = true;
    callback();
    if (scenario === 'revoke-during-revalidation') acl.revokeRegrant();
    read.resolve(scenario === 'file-rebound' ? [{ id: 'replacement-item', attachments: [{ id: 'file-a' }] }] : [row]);
    await flush();
    assert.equal(calls.filter(Array.isArray).length, ['allowed', 'execute-denied'].includes(scenario) ? 1 : 0);
    if (['allowed', 'execute-denied'].includes(scenario)) assert.deepEqual(calls[1], ['order-a', 'item-a', 'file-a']);
    if (['allowed', 'execute-denied'].includes(scenario)) assert.equal(errors.length, 0);
    if (scenario === 'file-rebound' || scenario === 'read-failure') assert.equal(errors.length, 1);
  });
}

for (const file of ['completion', 'photos', 'specification']) {
  for (const scenario of ['allowed', 'leaf-denied', 'read-hidden', 'regrant']) {
    test(`${file} final mutation: ${scenario}`, async () => {
      const acl = access();
      const calls = [];
      const row = { id: 'row-a', oneTimeOrderId: 'order-a', updatedAt: 'original', deletedAt: null, attachments: [], capabilities: { canDelete: true } };
      const order = { id: 'order-a', status: 'completed', workCycle: 2, capabilities: { canReopen: true } };
      const photoContext = { current: { items: [row], snapshotBlocked: false } };
      const reopenContext = { current: { item: order, snapshotBlocked: false } };
      const liveContext = { current: { orderId: 'order-a', accessRevision: 'user:1', snapshotBlocked: false, canEditCurrentStructure: true, items: [row] } };
      let intent;
      const storeIntent = (next) => { intent = next(null); };
      if (file === 'completion') {
        execute(handler(file, 'setReopenIntent', 'onClick'), { ...acl, item: order, reopenContext, setReopenIntent: storeIntent })();
      } else if (file === 'photos') {
        const opener = find(file, (node) => ts.isPropertyAssignment(node) && node.name.getText() === 'onSelect' && node.initializer.getText().includes('setPhotoToDelete')).initializer;
        execute(opener, { ...acl, item: row, photoContext, setDeleteIntent: storeIntent, setPhotoToDelete: noop, setDeleteReason: noop })();
      } else {
        const capture = execute(declaration(file, 'captureSpecificationAction'), { ...acl, orderId: 'order-a', accessRevision: 'user:1', mounted: { current: true }, liveContext });
        intent = capture(row.id);
      }
      assert.equal(intent(), true);
      const api = file === 'completion' ? 'onReopen' : file === 'photos' ? 'onDelete' : 'deleteOneTimeOrderSpecificationItem';
      const callback = execute(handler(file, api), {
        reopenIntent: intent, reopenIntentRef: { current: intent }, isReopening: false,
        deleteIntent: intent, deleteIntentRef: { current: intent }, pendingIntents: { current: { deleteIntent: intent } },
        photoToDelete: row.id, busyPhotoId: null, deleteTarget: row, isDeleting: false, orderId: 'order-a',
        setIsReopening: noop, setReopenIntent: noop, setError: noop, setBusyPhotoId: noop, setPhotoToDelete: noop,
        setIsDeleting: noop, setDeleteTarget: noop, load: async () => {},
        cancelDelete: noop,
        [api]: async (...args) => { calls.push(args); },
      });
      if (scenario === 'leaf-denied') {
        row.capabilities.canDelete = false; order.capabilities.canReopen = false; liveContext.current.canEditCurrentStructure = false;
      }
      if (scenario === 'read-hidden') {
        photoContext.current.snapshotBlocked = true; reopenContext.current.snapshotBlocked = true; liveContext.current.snapshotBlocked = true;
      }
      if (scenario === 'regrant') acl.revokeRegrant();
      callback('reason');
      await flush();
      assert.equal(calls.length, scenario === 'allowed' ? 1 : 0);
    });
  }
}

for (const [file, api, intentName, refName] of [
  ['specification', 'deleteOneTimeOrderSpecificationItem', 'deleteIntent', 'pendingIntents'],
  ['photos', 'onDelete', 'deleteIntent', 'deleteIntentRef'],
  ['completion', 'onReopen', 'reopenIntent', 'reopenIntentRef'],
  ['candidate', 'convertCandidateToEmployee', null, null],
]) {
  test(`${api}: retained final callback rejects cancelled/replaced intent`, () => {
    let mutations = 0;
    const intent = () => true;
    const bindings = {
      ...(intentName ? { [intentName]: intent } : {}),
      ...(refName ? { [refName]: { current: file === 'specification' ? { deleteIntent: () => true } : () => true } } : {}),
      deleteTarget: { id: 'item-a' }, photoToDelete: 'photo-a', isDeleting: false, busyPhotoId: null, isReopening: false,
      saving: false, candidateIntent: { isCurrent: () => true }, candidateIntentRef: { current: null }, isIntentCurrent: () => false,
      [api]: () => { mutations += 1; return Promise.resolve(); },
    };
    execute(handler(file, api), bindings)();
    assert.equal(mutations, 0);
  });
}

test('preview item guard rejects access generation, read concealment and order replacement', () => {
  const acl = access();
  const item = { id: 'order-a' };
  const itemRef = { current: item };
  const itemGeneration = { current: 1 };
  const liveContext = { current: { scope: 'order-a:user:1', ready: true } };
  const capture = execute(declaration('preview', 'captureItemOperation'), {
    ...acl, item, itemRef, itemGeneration, liveContext, scope: 'order-a:user:1',
  });
  const guard = capture();
  assert.equal(guard(), true);
  liveContext.current.ready = false;
  assert.equal(guard(), false);
  liveContext.current.ready = true;
  itemRef.current = { id: 'order-b' };
  assert.equal(guard(), false);
  itemRef.current = item;
  itemGeneration.current += 2;
  assert.equal(guard(), false, 'A → B → A does not revive an in-flight operation');
  const fresh = capture();
  acl.revokeRegrant();
  assert.equal(fresh(), false);
});

test('history rows, counts and facets are revision/finance keyed and stale actor responses are dropped', async () => {
  const source = sources.order.text;
  const historyQueryKey = declaration('order', 'historyQueryKey').getText();
  assert.match(historyQueryKey, /accessRevision/);
  assert.match(historyQueryKey, /canReadFinance/);
  assert.match(declaration('order', 'currentHistoryPageData').getText(), /snapshotReady[\s\S]*canRead\('canReadHistory'\)[\s\S]*historyLoadedQueryKey === historyQueryKey/);
  assert.doesNotMatch(source.slice(source.indexOf('<HistoryFilterBar')), /(?<!currentHistoryPageData)historyPageData\??\./);
  const acl = access();
  const response = deferred();
  const orderContext = { current: { ready: true, item: { capabilities: { canReadHistory: true } } } };
  const latestHistoryQueryKey = { current: 'revision-1' };
  const run = execute(handler('order', 'listOneTimeOrderHistoryPage', 'onActorSearch'), {
    ...acl, historyQueryKey: 'revision-1', latestHistoryQueryKey, orderContext, item: { id: 'order-a' },
    listOneTimeOrderHistoryPage: () => response.promise,
  });
  const pending = run('private actor');
  latestHistoryQueryKey.current = 'revision-2:finance-denied';
  response.resolve({ facets: { actors: [{ id: 'private' }] } });
  assert.deepEqual(await pending, []);
});

test('Me refresh failure conceals both parents and recovery schedules a fresh read', () => {
  for (const file of ['object', 'order']) {
    const source = sources[file].text;
    assert.match(source, /if \(capabilitiesRefreshError\) return/);
    assert.match(source, /\[params,[^\]]*capabilitiesRefreshError\]/);
    if (file === 'object') assert.match(source, /blocked=\{!!capabilitiesRefreshError \|\| coreLoading/);
    else assert.match(declaration(file, 'snapshotReady').getText(), /!capabilitiesRefreshError/);
  }
});

test('owned order sections remain mounted behind leaf/read boundaries; drafts are not revision-keyed', () => {
  const source = sources.order.text;
  for (const read of ['canReadPhotos', 'canReadSpecification']) {
    assert.match(source, new RegExp(`<AccessSnapshotBoundary blocked=\\{!canRead\\('${read}'\\)\\}>`));
  }
  assert.match(source, /AccessSnapshotBoundary blocked=\{!item.capabilities.canEditOperationalFields\}/);
  assert.match(source, /<div key=\{item.id\} className="ui-stack/);
  for (const name of ['OneTimeOrderPhotosPanel', 'OneTimeOrderSpecificationPanel', 'OneTimeOrderCompletionPanel']) {
    const tag = find('order', (node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText() === name).getText();
    assert.doesNotMatch(tag, /key=\{[^}]*access/);
  }
});

for (const [file, api, cancelName] of [
  ['specification', 'deleteOneTimeOrderSpecificationItem', 'cancelDelete'],
  ['specification', 'detachOneTimeOrderSpecificationAttachment', 'cancelAttachment'],
  ['photos', 'onDelete', 'cancelDelete'],
  ['candidate', 'setCandidateArchive', 'cancelCandidateIntent'],
]) {
  test(`${file}/${api}: real close callback invalidates a held final callback synchronously`, () => {
    let mutations = 0;
    const intent = () => true;
    const candidateIntent = { kind: 'archive', isCurrent: intent };
    const candidateIntentRef = { current: candidateIntent };
    const pendingIntents = { current: { deleteIntent: intent, attachmentIntent: intent } };
    const deleteIntentRef = { current: intent };
    const isIntentCurrent = execute(declaration('candidate', 'isIntentCurrent'), { candidateIntent, candidateIntentRef });
    const bindings = {
      deleteIntent: intent, attachmentIntent: intent, pendingIntents, deleteIntentRef, candidateIntent, candidateIntentRef, isIntentCurrent,
      deleteTarget: { id: 'item' }, attachmentTarget: { item: { id: 'item' }, fileId: 'file' }, photoToDelete: 'photo',
      isDetachingAttachment: false, isDeleting: false, busyPhotoId: null, saving: false,
      setDeleteIntent: noop, setDeleteTarget: noop, setAttachmentIntent: noop, setAttachmentTarget: noop, setPhotoToDelete: noop,
      setCandidateIntent: noop, setArchiveOpen: noop, setStatusTarget: noop, setConverting: noop,
      [api]: () => { mutations += 1; return Promise.resolve(); }, mutate: () => { mutations += 1; return Promise.resolve(); },
    };
    const heldConfirm = execute(handler(file, api), bindings);
    const cancel = execute(declaration(file, cancelName), bindings);
    execute(dialogAttribute(file, api, 'onOpenChange'), { ...bindings, [cancelName]: cancel })(false);
    heldConfirm('reason');
    assert.equal(mutations, 0);
  });
}

test('specification own read conceals retained rows on failure and rejects an earlier parent snapshot response', async () => {
  const acl = access();
  const originSnapshot = {};
  const liveContext = { current: { orderId: 'order-a', accessRevision: 'user:1', readSnapshot: originSnapshot } };
  const readSequence = { current: 0 };
  let loadedSpecification = { orderId: 'order-a', revision: 'user:0', snapshot: {} };
  let specificationError = null;
  let items = [{ id: 'old-private-row', attachments: [{ originalName: 'old-private.txt' }] }];
  const response = deferred();
  const bindings = {
    ...acl, liveContext, readSequence, mounted: { current: true }, orderId: 'order-a', accessRevision: 'user:1', readSnapshot: originSnapshot,
    setLoadedSpecification: (value) => { loadedSpecification = value; }, setSpecificationError: (value) => { specificationError = value; },
    setItems: (value) => { items = value; }, listOneTimeOrderSpecificationItems: () => response.promise,
  };
  const ready = () => execute(declaration('specification', 'specificationReady'), {
    snapshotBlocked: false, specificationError, loadedSpecification, orderId: 'order-a', accessRevision: 'user:1', readSnapshot: liveContext.current.readSnapshot,
  });
  const pending = execute(declaration('specification', 'load'), bindings)();
  assert.equal(ready(), false, 'A fresh parent alone cannot reveal earlier rows');
  liveContext.current.readSnapshot = {};
  response.resolve([{ id: 'late-row' }]);
  await pending;
  assert.equal(items[0].id, 'old-private-row');
  assert.equal(ready(), false, 'Retained raw rows stay behind the boundary');
  const fresh = { ...bindings, readSnapshot: liveContext.current.readSnapshot, listOneTimeOrderSpecificationItems: async () => { throw new Error('failed read'); } };
  await assert.rejects(execute(declaration('specification', 'load'), fresh)());
  assert.equal(ready(), false);
  assert.match(specificationError, /Старые пункты и вложения скрыты/);
  fresh.listOneTimeOrderSpecificationItems = async () => [{ id: 'fresh-row' }];
  await execute(declaration('specification', 'load'), fresh)();
  assert.equal(ready(), true);
  assert.equal(items[0].id, 'fresh-row');
  assert.match(sources.specification.text, /clearLoadedComments\(\);\s*\}, \[orderId, accessRevision, readSnapshot\]\)/);
});

for (const leaf of ['canRestore', 'canManage', 'canRespond', 'canManageAssignments']) {
  test(`candidate common mutation ${leaf}: denied before write and late A result cannot replace B/regrant`, async () => {
    const acl = access();
    const candidate = { id: 'A', version: 1, capabilities: { [leaf]: true } };
    const params = Promise.resolve({ id: 'A' });
    const accessRevision = 'user:1';
    const candidateContext = { current: { candidate, params, accessRevision, ready: true } };
    const capture = execute(declaration('candidate', 'captureCandidateAction'), { ...acl, candidate, params, accessRevision, candidateContext });
    let applied = 0;
    let writes = 0;
    const bindings = { ...acl, candidate, params, accessRevision, candidateContext, mutationSequence: { current: 0 }, saving: false, setSaving: noop, setError: noop, apply: () => { applied += 1; } };
    const mutate = execute(declaration('candidate', 'mutate'), bindings);
    candidate.capabilities[leaf] = false;
    assert.equal(await mutate(async () => { writes += 1; return candidate; }, capture(leaf)), false);
    assert.equal(writes, 0);
    candidate.capabilities[leaf] = true;
    const response = deferred();
    const pending = mutate(() => { writes += 1; return response.promise; }, capture(leaf));
    candidateContext.current = { ...candidateContext.current, candidate: { ...candidate, id: 'B' }, params: Promise.resolve({ id: 'B' }) };
    acl.revokeRegrant();
    response.resolve({ ...candidate, version: 2 });
    assert.equal(await pending, false);
    assert.equal(writes, 1, 'Only the operation already authorized at dispatch was sent');
    assert.equal(applied, 0);
  });
}

for (const scenario of ['execute-denied', 'comment-denied', 'revoke-before-followup']) {
  test(`specification comment source handler: ${scenario}`, async () => {
    const acl = access();
    const row = { id: 'item', attachments: [] };
    const liveContext = { current: { orderId: 'order-a', accessRevision: 'user:1', snapshotBlocked: false, items: [row], canExecute: false, canCommentCurrent: true } };
    const mounted = { current: true };
    const captureSpecificationAction = execute(declaration('specification', 'captureSpecificationAction'), { ...acl, orderId: 'order-a', accessRevision: 'user:1', liveContext, mounted });
    if (scenario === 'comment-denied') { liveContext.current.canCommentCurrent = false; liveContext.current.canExecute = true; }
    const first = deferred();
    const requests = [];
    let commentDrafts = { key: 'private new text' };
    const commentRequests = { current: scenario === 'revoke-before-followup' ? { key: { requestId: 'existing-request', content: 'earlier text' } } : {} };
    const run = execute(handler('specification', 'createOneTimeOrderSpecificationComment', 'onSubmit'), {
      captureSpecificationAction, item: row, orderId: 'order-a', commentKey: () => 'key', commentDrafts, commentRequests,
      commentPosting: { current: new Set() }, setPostingComments: noop, setCommentErrors: noop,
      setCommentDrafts: (update) => { commentDrafts = update(commentDrafts); },
      mounted, activeOrderId: { current: 'order-a' }, mergeComments: noop,
      createOneTimeOrderSpecificationComment: (...args) => { requests.push(args); return first.promise; },
    });
    const pending = run({ preventDefault: noop });
    if (scenario === 'revoke-before-followup') acl.revokeRegrant();
    first.resolve({ id: 'comment' });
    await pending;
    assert.equal(requests.length, scenario === 'comment-denied' ? 0 : 1);
    assert.equal(commentDrafts.key, scenario === 'execute-denied' ? '' : 'private new text');
    if (scenario === 'revoke-before-followup') assert.equal(commentRequests.current.key.requestId, 'existing-request');
  });
}

test('copy finance resolves fresh source independently from retained private edits and strips denied payload fields', async () => {
  const fields = ['agreedSum', 'plannedPaymentMethod', 'financialNotes', 'expenseNotes'];
  const resolve = execute(declaration('form', 'resolveFinancialFields'), { financialFieldNames: fields });
  const retain = execute(declaration('form', 'retainPrivateFinancialFields'), { financialFieldNames: fields });
  const old = { agreedSum: '99999', plannedPaymentMethod: 'cash', financialNotes: 'old private source note', expenseNotes: 'old source expense' };
  const fresh = { agreedSum: '10', plannedPaymentMethod: 'cash', financialNotes: 'fresh', expenseNotes: '' };
  assert.deepEqual(resolve(old, fresh, []), fresh, 'Unedited copied values never outrank the fresh redacted/projection source');
  assert.equal(resolve(old, fresh, ['financialNotes']).financialNotes, old.financialNotes);
  const form = { ...old, title: 'Own title', executionAddress: 'Own address', contactName: 'Own contact', dateMode: 'none', managerUserIds: [] };
  const privateForm = retain(form, fresh, ['financialNotes']);
  assert.equal(privateForm.financialNotes, old.financialNotes);
  assert.equal(privateForm.agreedSum, '', 'Server-copied amount is not stored as a user draft');
  let payload;
  const run = execute(declaration('form', 'handleSubmit'), {
    isSubmitting: false, setError: noop, setNativeValidationIssue: noop, findSectionValidationIssue: () => null,
    form, financialForm: old, privateForm, privateFinancialFields: ['financialNotes'], requirePlannedPaymentMethod: true,
    canEditFinancialFields: false, includeSpecificationItems: false, canComposeSpecification: false, specificationItems: [], specificationDraft: {},
    newPaymentMethodContext: undefined, newPaymentMethodValue: '', newPaymentMethod: null,
    canSelectLinkedObject: false, includeManagers: false, allowStatusEdit: false, notesDisclosureOpen: false, selectedManagers: [],
    setIsSubmitting: noop, onBusyChange: noop, prepareCreateSubmission: (draft) => ({ draft, creationRequestId: 'id' }),
    creationRequestRef: { current: null }, onDraftChange: noop, onSubmit: async (value) => { payload = value; },
  });
  await run({ preventDefault: noop, currentTarget: { querySelectorAll: () => [] } });
  for (const field of fields) assert.equal(field in payload, false, field);
  assert.match(sources.create.text, /canEditFinancialFields=\{!copyFromId \|\| copyFinanceAllowed\}/);
  assert.doesNotMatch(sources.create.text, /canSubmit && \(!copyFromId \|\| copyFinanceAllowed\)/);
  assert.match(sources.order.text, /item.capabilities.canEditFinancialFields && canRead\('canReadFinance'\)/);
});

test('authorized copy with source finance hidden submits an explicitly selected NEW method, never cached finance', async () => {
  const acl = access();
  const newPaymentMethodContext = 'source-a:user:2';
  let newPaymentMethod = null;
  const selectedValue = () => execute(declaration('form', 'newPaymentMethodValue'), { newPaymentMethod, newPaymentMethodContext });
  assert.equal(selectedValue(), '', 'No copied or old private method preselects the new input');
  newPaymentMethod = { context: 'source-a:user:1', value: 'cash' };
  assert.equal(selectedValue(), '', 'An earlier access snapshot choice stays private, not restored into the fresh input');
  const select = execute(handler('form', 'setNewPaymentMethod', 'onChange'), {
    newPaymentMethodContext, setNewPaymentMethod: (value) => { newPaymentMethod = value; },
  });
  select('organization_transfer');
  assert.equal(selectedValue(), 'organization_transfer');
  const contextValue = find('create', (node) => ts.isBinaryExpression(node) && node.left.getText() === 'context.current').right;
  const context = { current: execute(contextValue, {
    scope: 'source-a:user:2', loadedScope: 'source-a:user:2', capabilitiesRefreshError: null,
    isLoading: false, error: null, canSubmit: true, copyFromId: 'source-a', copyFinanceAllowed: false,
  }) };
  assert.equal(context.current.allowed, true, 'Source finance read is not copy authority');
  const requests = [];
  const copy = execute(handler('create', 'copyOneTimeOrder', 'onSubmit'), {
    ...acl, context, scope: 'source-a:user:2', copyFromId: 'source-a',
    draft: { submit: (callback) => callback(), clear: noop }, router: { push: noop },
    copyOneTimeOrder: async (id, payload) => { requests.push({ id, payload }); return { id: 'new-order' }; },
  });
  const form = {
    title: 'Own copy', executionAddress: 'Own address', contactName: 'Own contact', dateMode: 'none', managerUserIds: [],
    agreedSum: '99999', financialNotes: 'hidden source note', expenseNotes: 'hidden source expense', plannedPaymentMethod: 'cash',
  };
  let retainedDraft;
  const submit = execute(declaration('form', 'handleSubmit'), {
    form, financialForm: form, privateForm: form, privateFinancialFields: ['financialNotes'], newPaymentMethod,
    newPaymentMethodContext, newPaymentMethodValue: selectedValue(), requirePlannedPaymentMethod: true,
    isSubmitting: false, canEditFinancialFields: false, setError: noop, setNativeValidationIssue: noop, findSectionValidationIssue: () => null,
    includeSpecificationItems: false, canComposeSpecification: false, specificationItems: [], specificationDraft: {},
    canSelectLinkedObject: false, includeManagers: false, allowStatusEdit: false, notesDisclosureOpen: false, selectedManagers: [],
    setIsSubmitting: noop, onBusyChange: noop, creationRequestRef: { current: null },
    prepareCreateSubmission: (draft) => ({ draft, creationRequestId: 'creation-id' }),
    onDraftChange: (draft) => { retainedDraft = draft; }, onSubmit: copy,
  });
  await submit({ preventDefault: noop, currentTarget: { querySelectorAll: () => [] } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].id, 'source-a');
  assert.equal(requests[0].payload.plannedPaymentMethod, 'organization_transfer');
  assert.equal(requests[0].payload.creationRequestId, 'creation-id');
  for (const field of ['agreedSum', 'financialNotes', 'expenseNotes']) assert.equal(field in requests[0].payload, false, field);
  assert.equal(retainedDraft.form.financialNotes, 'hidden source note', 'Private fields are retained, not submitted');
  assert.deepEqual(retainedDraft.newPaymentMethod, { context: newPaymentMethodContext, value: 'organization_transfer' });
  assert.match(sources.create.text, /newPaymentMethodContext=\{copyFromId && !copyFinanceAllowed/);
});

test('same-revision comment reload A → B drops late A and fresh reopen waits for B, preserving disclosure correctness', async () => {
  const acl = access();
  const row = { id: 'item' };
  const snapshotA = {}, snapshotB = {};
  const liveContext = { current: { orderId: 'order-a', accessRevision: 'user:1', readSnapshot: snapshotA, snapshotBlocked: false, items: [row] } };
  let open = null, comments = {}, loading = {}, errors = {};
  const setOpenCommentsFor = (value) => { open = value; };
  const setCommentsByItem = (update) => { comments = typeof update === 'function' ? update(comments) : update; };
  const setCommentLoading = (update) => { loading = typeof update === 'function' ? update(loading) : update; };
  const setCommentErrors = (update) => { errors = typeof update === 'function' ? update(errors) : update; };
  const mergeComments = execute(declaration('specification', 'mergeComments'), { setCommentsByItem });
  const responseA = deferred(), responseB = deferred();
  const commentKey = () => 'key';
  const makeOpen = (readSnapshot, response) => {
    const captureSpecificationRead = execute(declaration('specification', 'captureSpecificationRead'), {
      ...acl, liveContext, mounted: { current: true }, orderId: 'order-a', accessRevision: 'user:1', readSnapshot,
    });
    const refreshComments = execute(declaration('specification', 'refreshComments'), {
      captureSpecificationRead, commentKey, orderId: 'order-a', mergeComments,
      listOneTimeOrderSpecificationComments: () => response.promise,
    });
    return execute(handler('specification', 'setOpenCommentsFor', 'onClick'), {
      item: row, openCommentsFor: open, commentsByItem: comments, commentKey, captureSpecificationRead, refreshComments,
      setOpenCommentsFor, setCommentLoading, setCommentErrors,
    });
  };
  const pendingA = makeOpen(snapshotA, responseA)();
  assert.equal(open, 'item');
  assert.equal(loading.key, true);
  liveContext.current.readSnapshot = snapshotB; // Same order/revision/generation; only the exact DTO snapshot changed.
  execute(declaration('specification', 'clearLoadedComments'), { setOpenCommentsFor, setCommentsByItem, setCommentLoading, setCommentErrors })();
  assert.equal(open, null, 'Reload collapses the prior server section instead of showing a false empty result');
  assert.deepEqual(comments, {});
  assert.doesNotMatch(declaration('specification', 'clearLoadedComments').getText(), /setCommentDrafts|commentRequests/);
  const pendingB = makeOpen(snapshotB, responseB)();
  assert.equal(open, 'item');
  responseA.resolve([{ id: 'private-old', createdAt: '2026-11-01' }]);
  await pendingA;
  assert.deepEqual(comments, {}, 'Late A does not merge into B');
  assert.equal(loading.key, true, 'Late A finally cannot clear the fresh B loading state');
  responseB.resolve([{ id: 'fresh', createdAt: '2026-11-02' }]);
  await pendingB;
  assert.deepEqual(comments.key.map(({ id }) => id), ['fresh']);
  assert.equal(loading.key, false);
  assert.equal(errors.key, null);
  assert.equal(open, 'item');
});


// A successful committed response is not a stale DTO, failure, or conflict retry.
for (const scenario of ['minimal-ack', 'revoked-before-delivery', 'new-session', 'new-order']) {
  test(`assignment committed acknowledgement: ${scenario}`, async () => {
    const fixture = orderFixture();
    const response = deferred();
    const writes = [], notices = [], applied = [], reloads = [];
    let session = 1;
    const latestParams = { current: fixture.params };
    const run = execute(handler('order', 'assignOneTimeOrderManager', 'onAssign'), {
      ...fixture,
      user: { id: 'actor-a' },
      getAccessSessionGeneration: () => session,
      latestParams,
      assignManagerWithConflictConfirmation,
      assignOneTimeOrderManager: async (...args) => { writes.push(args); return response.promise; },
      confirmScheduleConflicts: async () => { throw Error('ACK must not open a conflict confirmation'); },
      isSavedWithoutAccess: (value) => value?.outcome === 'saved_without_access',
      setSavedManagerAssignment: (value) => notices.push(value),
      setItem: (value) => applied.push(value),
      loadAll: async (id) => reloads.push(id),
    });
    const pending = run('private-target');
    if (scenario === 'revoked-before-delivery') fixture.acl.revokeRegrant();
    if (scenario === 'new-session') session += 1;
    if (scenario === 'new-order') latestParams.current = Promise.resolve({ id: 'order-b' });
    response.resolve({ outcome: 'saved_without_access' });
    await pending;
    assert.equal(writes.length, 1);
    assert.deepEqual(applied, []);
    assert.deepEqual(reloads, []);
    const sameContext = scenario === 'minimal-ack' || scenario === 'revoked-before-delivery';
    assert.equal(notices.length, sameContext ? 1 : 0);
    if (sameContext) {
      assert.equal(notices[0].params, fixture.params);
      assert.equal(notices[0].userId, 'actor-a');
      assert.equal(notices[0].session, 1);
    }
  });
}
