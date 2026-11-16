import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Controlled hook/effect runner: execute the actual page without DOM or API writes.
function harness(mocks) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const React = {
    Fragment: 'Fragment',
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useContext: () => mocks.__ancestorBlocked?.() ?? false,
    useCallback: (callback) => callback,
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (previous && dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) return;
      previous?.cleanup?.();
      const entry = { dependencies };
      slots[index] = entry;
      effects.push(() => { entry.cleanup = effect(); });
    },
  };
  React.default = React;
  const primitives = new Proxy({}, { get: (_, name) => name });
  const exports = {};
  let dialogs;
  const requireModule = (name) => {
    if (name === 'react') return React;
    if (name === '@/shared/ui/overlays' && mocks.__realDialogs) {
      if (!dialogs) {
        dialogs = {};
        const hooks = ts.transpileModule(readFileSync(new URL('../../../shared/ui/overlays/use-dialogs.tsx', import.meta.url), 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
        }).outputText;
        new Function('require', 'exports', hooks)(requireModule, dialogs);
      }
      return dialogs;
    }
    return mocks[name] ?? (name.endsWith('.css') ? { default: {} } : primitives);
  };
  const source = ts.transpileModule(readFileSync(new URL('../../../app/(app)/tasks/[id]/page.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  new Function('require', 'exports', `${source}\nexports.Content = TaskDetailContent;`)(requireModule, exports);
  return {
    render(props, component = 'Content') { cursor = 0; return exports[component](props); },
    effects() { const pending = effects; effects = []; pending.forEach((run) => run()); },
    unmount() { slots.forEach((entry) => entry?.cleanup?.()); },
  };
}

function nodes(node, type, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (node.type === type) result.push(node);
  for (const child of node.props?.children?.flat(Infinity) ?? []) nodes(child, type, result);
  return result;
}
const boundary = (tree) => nodes(tree, 'AccessSnapshotBoundary')[0];
const snapshot = (title = 'Old', canViewHistory = true) => ({
  id: 'task-a', title, updatedAt: 'stable', objectId: null, oneTimeOrderId: null,
  assignees: [], visibleUsers: [], dueAt: null, workCycle: 1, completionRequirement: 'comment_or_file',
  completionProgress: { completed: 0, total: 0 }, capabilities: { canViewHistory, canEdit: true, canCompleteMyAssignment: true },
});
function fixture(overrides = {}) {
  const access = { generation: 1, ancestorBlocked: false };
  const auth = { user: { id: 'user', accessVersion: 1, capabilities: { canUploadFile: true } } };
  const api = {
    getTaskById: async () => snapshot(),
    listTaskHistory: async () => [],
    listTaskCompletions: async () => ({ items: [], page: 1, limit: 10, total: 0, totalPages: 0 }),
  };
  const files = { listFilesByEntity: async () => [{ id: 'old-file' }] };
  const runner = harness({
    '@/shared/auth/use-auth': { useAuth: () => auth },
    '@/shared/auth/use-open-access-refresh': { useOpenAccessRefresh: () => undefined },
    '@/shared/auth/access-generation': {
      getAccessGeneration: () => access.generation,
      isAccessGenerationCurrent: (snapshot) => snapshot === access.generation,
    },
    __ancestorBlocked: () => access.ancestorBlocked,
    '@/shared/ui/overlays': { useConfirm: () => [async () => false, null], useReasonPrompt: () => [async () => null, null] },
    '@/entities/task/api/task-client': api,
    '@/entities/file/api/file-client': files,
    '@/entities/object/api/object-client': { listObjects: async () => [] },
    '@/entities/one-time-order/api/one-time-order-client': { listOneTimeOrders: async () => ({ items: [] }) },
    '@/entities/user/api/user-client': { listSystemUsers: async () => [] },
    ...overrides,
  });
  const render = (taskId = 'task-a') => runner.render({ taskId });
  return { auth, access, api, files, runner, render, async load() { render(); runner.effects(); await flush(); return render(); } };
}

test('ACL refresh conceals the whole snapshot immediately, preserves draft/picker identity, and waits for all current reads', async () => {
  const f = fixture();
  let tree = await f.load();
  assert.equal(boundary(tree).props.blocked, false);
  nodes(tree, 'Button').find((button) => button.props.children.includes('Редактировать')).props.onClick();
  await flush();
  tree = f.render();
  const formKey = nodes(tree, 'TaskForm')[0].props.key;
  const resultKey = nodes(tree, 'TaskResultPanel')[0].props.key;
  const pickerKey = nodes(tree, 'AccessSnapshotBoundary').find((node) => node.props.key).props.key;
  const item = deferred(), attachments = deferred(), history = deferred();
  f.api.getTaskById = () => item.promise;
  f.files.listFilesByEntity = () => attachments.promise;
  f.api.listTaskHistory = () => history.promise;
  f.auth.user = { ...f.auth.user, accessVersion: 2 };
  tree = f.render();
  assert.equal(boundary(tree).props.blocked, true, 'hide during render before effects');
  assert.equal(nodes(tree, 'TaskForm')[0].props.key, formKey);
  assert.equal(nodes(tree, 'TaskResultPanel')[0].props.key, resultKey);
  assert.equal(nodes(tree, 'AccessSnapshotBoundary').find((node) => node.props.key).props.key, pickerKey);
  f.runner.effects();
  item.resolve(snapshot('Current'));
  await flush();
  assert.equal(boundary(f.render()).props.blocked, true, 'new item alone cannot expose old files');
  attachments.resolve([{ id: 'current-file' }]);
  await flush();
  assert.equal(boundary(f.render()).props.blocked, true, 'wait for current history');
  history.resolve([]);
  await flush();
  tree = f.render();
  assert.equal(boundary(tree).props.blocked, false);
  assert.equal(nodes(tree, 'TaskSummaryCard')[0].props.item.title, 'Current');
  assert.equal(nodes(tree, 'AttachmentPreviewList')[0].props.files[0].id, 'current-file');
  assert.equal(nodes(tree, 'TaskForm')[0].props.key, formKey);
  assert.equal(nodes(tree, 'TaskResultPanel')[0].props.key, resultKey);
});

test('403 leaves old server snapshot concealed and mounted; a later successful revision restores visibility', async () => {
  const f = fixture();
  const before = await f.load();
  const key = nodes(before, 'TaskResultPanel')[0].props.key;
  f.auth.user = { ...f.auth.user, accessVersion: 2 };
  f.api.getTaskById = async () => { throw Object.assign(new Error('Forbidden'), { statusCode: 403 }); };
  f.render(); f.runner.effects(); await flush();
  let tree = f.render();
  assert.equal(boundary(tree).props.blocked, true);
  assert.equal(nodes(tree, 'TaskResultPanel')[0].props.key, key);
  assert.ok(nodes(tree, 'Alert').some((alert) => alert.props.children.includes('Карточка задачи недоступна.')));
  assert.equal(nodes(tree, 'Alert').some((alert) => alert.props.children.includes('Forbidden')), false);
  f.auth.user = { ...f.auth.user, accessVersion: 3 };
  f.api.getTaskById = async () => snapshot('Restored', false);
  f.files.listFilesByEntity = async () => [];
  f.render(); f.runner.effects(); await flush();
  tree = f.render();
  assert.equal(boundary(tree).props.blocked, false);
  assert.deepEqual(nodes(tree, 'AttachmentPreviewList')[0].props.files, []);
  f.auth.capabilitiesRefreshError = 'refresh failed';
  assert.equal(boundary(f.render()).props.blocked, true);
});

test('late successful read from a superseded revision cannot unblock the page', async () => {
  const f = fixture();
  await f.load();
  const oldRead = deferred();
  f.auth.user = { ...f.auth.user, accessVersion: 2 };
  f.api.getTaskById = () => oldRead.promise;
  f.render(); f.runner.effects();
  f.auth.user = { ...f.auth.user, accessVersion: 3 };
  f.api.getTaskById = async () => { throw new Error('Denied current'); };
  f.render(); f.runner.effects(); await flush();
  oldRead.resolve(snapshot('Late old result'));
  await flush();
  assert.equal(boundary(f.render()).props.blocked, true);
  assert.notEqual(nodes(f.render(), 'TaskSummaryCard')[0].props.item.title, 'Late old result');
});

test('route resolution conceals old task immediately; actual task id keys reset all task-local state', async () => {
  const runner = harness({});
  const first = Promise.resolve({ id: 'task-a' });
  runner.render({ params: first }, 'default'); runner.effects(); await flush();
  let tree = runner.render({ params: first }, 'default');
  assert.equal(boundary(tree).props.blocked, false);
  const childA = boundary(tree).props.children[0];
  assert.equal(childA.props.key, 'task-a');
  const next = deferred();
  tree = runner.render({ params: next.promise }, 'default');
  assert.equal(boundary(tree).props.blocked, true);
  assert.equal(boundary(tree).props.children[0].props.key, 'task-a');
  runner.effects(); next.resolve({ id: 'task-b' }); await flush();
  tree = runner.render({ params: next.promise }, 'default');
  assert.equal(boundary(tree).props.blocked, false);
  assert.equal(boundary(tree).props.children[0].props.key, 'task-b');
  assert.equal(boundary(tree).props.children[0].props.taskId, 'task-b');
});

const reasonActions = [
  ['canReturnToWork', 'Вернуть в работу', 'returnTaskToWork'],
  ['canReopen', 'Переоткрыть', 'reopenTask'],
  ['canCancel', 'Отменить задачу', 'cancelTask'],
];
function actionButton(tree, label) {
  return nodes(tree, 'Button').find((node) => node.props.children.includes(label));
}
function dialogBoundary(tree) {
  return nodes(tree, 'AccessSnapshotBoundary').find((node) => nodes(node, 'ReasonDialog').length > 0 && node !== boundary(tree));
}

for (const [capability, label, method] of reasonActions) {
  for (const scenario of ['allowed', 'leaf-revoked', 'revision-changed', 'generation-changed', 'read-revoked', 'route-pending', 'unmounted']) {
    test(`${method}: ${scenario} while reason prompt is open; no stale POST and private reason retained`, async () => {
      const f = fixture({ __realDialogs: true });
      let allowed = true;
      f.api.getTaskById = async () => ({ ...snapshot(), capabilities: { ...snapshot().capabilities, [capability]: allowed } });
      const calls = [];
      f.api[method] = async (...args) => { calls.push(args); return snapshot(); };
      let tree = await f.load();
      const pending = actionButton(tree, label).props.onClick();
      tree = f.render();
      nodes(tree, 'ReasonDialog')[0].props.onReasonChange('Личная причина');
      tree = f.render();
      assert.equal(nodes(tree, 'ReasonDialog')[0].props.reason, 'Личная причина');
      if (scenario === 'leaf-revoked') {
        allowed = false;
        await nodes(tree, 'TaskResultPanel')[0].props.onChanged();
      }
      if (scenario === 'revision-changed') f.auth.user = { ...f.auth.user, accessVersion: 2 };
      if (scenario === 'generation-changed') f.access.generation += 1;
      if (scenario === 'read-revoked') f.auth.capabilitiesRefreshError = 'unavailable';
      if (scenario === 'route-pending') f.access.ancestorBlocked = true;
      tree = f.render();
      if (scenario === 'leaf-revoked') assert.equal(dialogBoundary(tree).props.blocked, true);
      if (scenario === 'revision-changed' || scenario === 'read-revoked') assert.equal(boundary(tree).props.blocked, true);
      assert.equal(nodes(tree, 'ReasonDialog')[0].props.reason, 'Личная причина', 'concealment must not reset the hook draft');
      if (scenario === 'unmounted') f.runner.unmount();
      nodes(tree, 'ReasonDialog')[0].props.onConfirm('Личная причина');
      await pending;
      await flush();
      if (scenario === 'allowed') {
        assert.deepEqual(calls, [['task-a', 'Личная причина']]);
        return;
      }
      assert.deepEqual(calls, [], 'old prompt must not post through a different leaf or restored grant');
      if (scenario === 'unmounted') return;
      allowed = true;
      f.auth.capabilitiesRefreshError = null;
      f.access.ancestorBlocked = false;
      f.render(); f.runner.effects(); await flush();
      tree = f.render();
      if (scenario === 'leaf-revoked') {
        await nodes(tree, 'TaskResultPanel')[0].props.onChanged();
        tree = f.render();
      }
      assert.deepEqual(calls, [], 'restoring read/leaf cannot automatically retry mutation');
      const retry = actionButton(tree, label).props.onClick();
      tree = f.render();
      assert.equal(nodes(tree, 'ReasonDialog')[0].props.reason, 'Личная причина', 'fresh explicit prompt is prefilled, not silently dropped');
      assert.deepEqual(calls, []);
      nodes(tree, 'ReasonDialog')[0].props.onConfirm('Личная причина');
      await retry;
      assert.deepEqual(calls, [['task-a', 'Личная причина']]);
    });
  }
}

test('a target change invalidates pending reason and does not transfer it to the new target', async () => {
  const f = fixture({ __realDialogs: true });
  let target = 'object-a';
  f.api.getTaskById = async () => ({ ...snapshot(), objectId: target, capabilities: { canCancel: true } });
  const calls = [];
  f.api.cancelTask = async (...args) => { calls.push(args); return snapshot(); };
  let tree = await f.load();
  const pending = actionButton(tree, 'Отменить задачу').props.onClick();
  tree = f.render();
  nodes(tree, 'ReasonDialog')[0].props.onReasonChange('Причина цели A');
  target = 'object-b';
  await nodes(tree, 'TaskResultPanel')[0].props.onChanged();
  tree = f.render();
  nodes(tree, 'ReasonDialog')[0].props.onConfirm('Причина цели A');
  await pending;
  assert.deepEqual(calls, []);
  tree = f.render();
  const retry = actionButton(tree, 'Отменить задачу').props.onClick();
  tree = f.render();
  assert.equal(nodes(tree, 'ReasonDialog')[0].props.reason, '');
  nodes(tree, 'ReasonDialog')[0].props.onOpenChange(false);
  await retry;
});

for (const [capability, label, method] of [['canConfirm', 'Подтвердить и завершить', 'confirmTask'], ['canCompleteNow', 'Завершить сейчас', 'completeTaskNow']]) {
  test(`generic runAction uses exact ${capability}, never another allowed leaf`, async () => {
    const f = fixture();
    let allowed = true;
    f.api.getTaskById = async () => ({ ...snapshot(), capabilities: { [capability]: allowed, canCancel: true } });
    const calls = [];
    f.api[method] = async () => { calls.push(method); return snapshot(); };
    let tree = await f.load();
    const staleClick = actionButton(tree, label).props.onClick;
    allowed = false;
    await nodes(tree, 'TaskResultPanel')[0].props.onChanged();
    f.render();
    staleClick();
    await flush();
    assert.deepEqual(calls, []);
    allowed = true;
    tree = f.render();
    await nodes(tree, 'TaskResultPanel')[0].props.onChanged();
    tree = f.render();
    actionButton(tree, label).props.onClick();
    await flush();
    assert.deepEqual(calls, [method]);
  });
}

test('a saved-without-access receipt closes the card and does not reload or render private data', async () => {
  const f = fixture({
    '@/shared/ui/overlays': { useConfirm: () => [async () => true, null], useReasonPrompt: () => [async () => null, null] },
    '@/shared/lib/display-name': { getUserDisplayName: user => user.fullName },
  });
  let reads = 0;
  f.api.getTaskById = async () => {
    reads += 1;
    const task = snapshot('Private task title');
    return { ...task, assignees: [{ id: 'user', fullName: 'User', isActive: true }, { id: 'other', fullName: 'Other', isActive: true }],
      capabilities: { ...task.capabilities, canManageAssignees: true } };
  };
  const calls = [];
  f.api.removeTaskAssignee = async (...args) => { calls.push(args); return { outcome: 'saved_without_access' }; };
  let tree = await f.load();
  actionButton(tree, 'Удалить').props.onClick();
  await flush();
  tree = f.render();
  assert.deepEqual(calls, [['task-a', 'user']]);
  assert.equal(reads, 1);
  assert.equal(nodes(tree, 'Alert').find(node => node.props.role === 'status')?.props.title, 'Изменение сохранено');
  assert.equal(nodes(tree, 'BackLink')[0].props.href, '/tasks');
  assert.equal(nodes(tree, 'TaskSummaryCard').length, 0);
  assert.equal(nodes(tree, 'TaskResultPanel').length, 0);
  assert.equal(nodes(tree, 'AttachmentPreviewList').length, 0);
});

// Execute each public lifecycle consumer against a minimal known-commit receipt.
for (const [capability, label, method] of [
  ['canConfirm', 'Подтвердить и завершить', 'confirmTask'],
  ['canCompleteNow', 'Завершить сейчас', 'completeTaskNow'],
  ...reasonActions,
]) {
  for (const change of ['revoke', 'task', 'actor', 'unmount']) {
    test(`${method}: committed minimal ACK after ${change} never rereads/retries or closes another card`, async () => {
      const f = fixture({ __realDialogs: true });
      const reply = deferred();
      const calls = [];
      let reads = 0;
      f.api.getTaskById = async (id) => {
        reads += 1;
        return { ...snapshot('Private ' + id), id, capabilities: { ...snapshot().capabilities, [capability]: true } };
      };
      f.api[method] = (...args) => { calls.push(args); return reply.promise; };
      let tree = await f.load();
      const pending = actionButton(tree, label).props.onClick();
      if (reasonActions.some(([, , name]) => name === method)) {
        tree = f.render();
        nodes(tree, 'ReasonDialog')[0].props.onConfirm('Личная причина');
      }
      await flush();
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0], 'task-a');
      if (change === 'revoke') {
        f.auth.user = { ...f.auth.user, accessVersion: 2 };
        f.access.generation += 1;
        f.render(); // ACK must still acknowledge the already committed original write.
      }
      if (change === 'task') {
        f.render('task-b'); f.runner.effects(); await flush();
        assert.equal(nodes(f.render('task-b'), 'TaskSummaryCard')[0].props.item.id, 'task-b');
      }
      if (change === 'actor') {
        f.auth.user = { ...f.auth.user, id: 'other-user' };
        f.render(); f.runner.effects(); await flush();
      }
      if (change === 'unmount') f.runner.unmount();
      const readsBeforeAck = reads;
      reply.resolve({ outcome: 'saved_without_access' });
      await pending; await flush();
      tree = f.render(change === 'task' ? 'task-b' : 'task-a');
      assert.equal(reads, readsBeforeAck, 'known commit does not reload');
      assert.equal(calls.length, 1, 'no automatic retry');
      const notice = nodes(tree, 'Alert').find(node => node.props.title === 'Изменение сохранено');
      if (change === 'revoke') {
        assert.ok(notice);
        for (const type of ['TaskSummaryCard', 'TaskResultPanel', 'AttachmentPreviewList', 'TaskForm', 'ReasonDialog']) {
          assert.equal(nodes(tree, type).length, 0, `private ${type} cleared`);
        }
        // A later route must not inherit the original task's closed-after-save state.
        f.auth.user = { ...f.auth.user, accessVersion: 3 };
        f.render('task-b'); f.runner.effects(); await flush();
        assert.equal(nodes(f.render('task-b'), 'TaskSummaryCard')[0].props.item.id, 'task-b');
      } else {
        assert.equal(notice, undefined, 'old receipt cannot close a different actor/target or unmounted view');
      }
    });
  }
}

test('a receipt closing task A must not disable open-access refresh for subsequently opened task B', async () => {
  const refreshEnabled = [];
  const f = fixture({
    '@/shared/auth/use-open-access-refresh': { useOpenAccessRefresh: enabled => refreshEnabled.push(enabled) },
  });
  f.api.getTaskById = async id => ({ ...snapshot(), id, capabilities: { ...snapshot().capabilities, canConfirm: true } });
  f.api.confirmTask = async () => ({ outcome: 'saved_without_access' });
  const tree = await f.load();
  actionButton(tree, 'Подтвердить и завершить').props.onClick();
  await flush();
  f.render();
  assert.equal(refreshEnabled.at(-1), false, 'closed original card does not poll');
  f.render('task-b'); f.runner.effects(); await flush();
  assert.equal(nodes(f.render('task-b'), 'TaskSummaryCard')[0].props.item.id, 'task-b');
  assert.equal(refreshEnabled.at(-1), true, 'current readable task B still refreshes its access');
});

test('an old task A ACK cannot erase a newer reason draft for task B', async () => {
  const f = fixture({ __realDialogs: true });
  const a = deferred(), b = deferred();
  f.api.getTaskById = async id => ({ ...snapshot(), id, capabilities: { ...snapshot().capabilities, canCancel: true } });
  f.api.cancelTask = id => id === 'task-a' ? a.promise : b.promise;
  let tree = await f.load();
  const old = actionButton(tree, 'Отменить задачу').props.onClick();
  nodes(f.render(), 'ReasonDialog')[0].props.onConfirm('Причина A');
  await flush();
  f.render('task-b'); f.runner.effects(); await flush();
  tree = f.render('task-b');
  const current = actionButton(tree, 'Отменить задачу').props.onClick();
  nodes(f.render('task-b'), 'ReasonDialog')[0].props.onConfirm('Причина B');
  await flush();
  a.resolve({ outcome: 'saved_without_access' }); await old;
  b.reject(new Error('Controlled current request refusal')); await current;
  tree = f.render('task-b');
  const retry = actionButton(tree, 'Отменить задачу').props.onClick();
  tree = f.render('task-b');
  assert.equal(nodes(tree, 'ReasonDialog')[0].props.reason, 'Причина B');
  nodes(tree, 'ReasonDialog')[0].props.onOpenChange(false); await retry;
});
