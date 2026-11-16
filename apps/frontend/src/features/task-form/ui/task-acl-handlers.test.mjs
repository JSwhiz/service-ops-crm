import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Execute the real TSX handlers without a browser, API, database or semantic build.
// Hook slots persist between controlled prop updates; confirmation stays pending
// until the test resolves it, so permission/target races are observable.
function componentHarness(path, mocks) {
  const slots = [];
  const cleanups = [];
  let cursor = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useMemo: (calculate) => calculate(),
    useEffect(effect) {
      const index = cursor++;
      if (!(index in slots)) { slots[index] = true; cleanups.push(effect()); }
    },
  };
  React.default = React;
  const primitives = new Proxy({}, { get: (_, name) => name });
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  new Function('require', 'exports', source)((name) => name === 'react' ? React
    : mocks[name] ?? (name.endsWith('.css') ? { default: {} } : primitives), exports);
  return {
    render(name, props) { cursor = 0; return exports[name](props); },
    unmount() { cleanups.forEach((cleanup) => cleanup?.()); },
  };
}

function nodes(node, type, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (node.type === type) result.push(node);
  for (const child of node.props?.children?.flat(Infinity) ?? []) nodes(child, type, result);
  return result;
}

function deferredConfirm() {
  let resolve;
  const options = [];
  return {
    options,
    confirm: (next) => { options.push(next); return new Promise((settle) => { resolve = settle; }); },
    settle: (answer) => resolve(answer),
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

for (const scenario of ['allowed', 'cancelled', 'revoked', 'generation-changed', 'task-changed', 'unmounted']) {
  test(`undo confirmation revalidates current context: ${scenario}; keeps result text`, async () => {
    const dialog = deferredConfirm();
    let generation = 1;
    const calls = [];
    const harness = componentHarness('../../task-result/ui/task-result-panel.tsx', {
      '@/shared/ui/overlays': { useConfirm: () => [dialog.confirm, null] },
      '@/shared/auth/access-generation': {
        getAccessGeneration: () => generation,
        isAccessGenerationCurrent: (snapshot) => snapshot === generation,
      },
      '@/shared/lib/task-presentation': { getCompletionRequirementLabel: () => '' },
      '@/entities/task/api/task-client': { undoTaskCompletion: async (id) => { calls.push(id); } },
    });
    const props = { taskId: 'task-a', requirement: 'comment_or_file', canComplete: true, canUndo: true, onChanged: async () => {} };
    let tree = harness.render('TaskResultPanel', props);
    nodes(tree, 'textarea')[0].props.onChange({ target: { value: 'Личный текст' } });
    tree = harness.render('TaskResultPanel', props);
    const pending = nodes(tree, 'Button').find((node) => node.props.children.includes('Отменить выполнение')).props.onClick();
    assert.deepEqual(calls, []);
    let next = props;
    if (scenario === 'revoked') next = { ...props, canUndo: false };
    if (scenario === 'task-changed') next = { ...props, taskId: 'task-b' };
    if (scenario === 'generation-changed') {
      // Even revoke + regrant ending with canUndo=true invalidates the old dialog.
      generation += 2;
    }
    tree = harness.render('TaskResultPanel', next);
    if (scenario === 'unmounted') harness.unmount();
    dialog.settle(scenario !== 'cancelled');
    await pending;
    await flush();
    assert.deepEqual(calls, scenario === 'allowed' ? ['task-a'] : []);
    if (scenario !== 'unmounted') {
      assert.equal(nodes(harness.render('TaskResultPanel', next), 'textarea')[0].props.value, 'Личный текст');
    }
  });
}

function taskFormFixture() {
  const dialog = deferredConfirm();
  const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];
  const changes = [];
  const submissions = [];
  const draft = {
    value: { title: 'Задача', description: '', priority: 'important_not_urgent', objectId: 'object-a', oneTimeOrderId: '', assigneeUserIds: ['user'], visibleUserIds: [], visibilityType: 'target_participants', requiresConfirmation: true, completionRequirement: 'comment_or_file', dueDate: '2026-11-10', dueTime: '' },
    files,
    setValue(next) { draft.value = typeof next === 'function' ? next(draft.value) : next; },
    setFiles(next) { draft.files = typeof next === 'function' ? next(draft.files) : next; },
  };
  const harness = componentHarness('./task-form.tsx', {
    '@/shared/ui/overlays': { useConfirm: () => [dialog.confirm, null] },
    '@/shared/lib/task-presentation': { TASK_COMPLETION_OPTIONS: [], TASK_PRIORITY_OPTIONS: [] },
  });
  const props = {
    objects: [], orders: [], users: [], visibilityUsers: [], draft, canUploadFiles: true,
    onTargetsChange: (...ids) => changes.push(ids),
    onSubmit: async (payload, attachments) => { submissions.push({ payload, attachments }); },
  };
  return { dialog, files, draft, changes, submissions, props, harness, render: (extra = {}) => harness.render('TaskForm', { ...props, ...extra }) };
}

for (const field of ['objectId', 'oneTimeOrderId']) {
  for (const confirmed of [false, true]) {
    test(`pending selected files require explicit ${confirmed ? 'acceptance' : 'cancellation'} for ${field} switch`, async () => {
      const fixture = taskFormFixture();
      const { draft, files, changes, dialog } = fixture;
      let tree = fixture.render();
      const oldPick = nodes(tree, 'MediaActionPicker')[0].props.onPick;
      const targetSelect = nodes(tree, 'Select').find((node) => node.props.value === draft.value[field]);
      targetSelect.props.onChange({ target: { value: 'target-b' } });
      assert.equal(dialog.options.length, 1);
      assert.equal(draft.value.objectId, 'object-a');
      assert.equal(draft.value.oneTimeOrderId, '');
      assert.equal(draft.files, files);
      assert.deepEqual(changes, []);
      tree = fixture.render();
      assert.equal(nodes(tree, 'MediaActionPicker')[0].props.disabled, true);
      await assert.rejects(oldPick(new File(['c'], 'c.txt')), /смене цели/);
      nodes(tree, 'form')[0].props.onSubmit({ preventDefault() {} });
      assert.equal(fixture.submissions.length, 0);
      dialog.settle(confirmed);
      await flush();
      tree = fixture.render();
      if (confirmed) {
        assert.equal(draft.value[field], 'target-b');
        assert.deepEqual(draft.files, []);
        assert.equal(changes.length, 1);
        await assert.rejects(oldPick(new File(['c'], 'c.txt')), /Цель задачи изменилась/);
      } else {
        assert.equal(draft.value.objectId, 'object-a');
        assert.equal(draft.value.oneTimeOrderId, '');
        assert.equal(draft.files, files);
        assert.deepEqual(changes, []);
      }
    });
  }
}

test('same-target ACL revoke/regrant keeps exact selected files without confirmation or auto-upload', async () => {
  const fixture = taskFormFixture();
  const original = fixture.render();
  const originalKey = nodes(original, 'AccessSnapshotBoundary')[0].props.key;
  const revoked = fixture.render({ canUploadFiles: false });
  assert.equal(nodes(revoked, 'AccessSnapshotBoundary')[0].props.blocked, true);
  assert.equal(nodes(revoked, 'AccessSnapshotBoundary')[0].props.key, originalKey);
  nodes(revoked, 'Select').find((node) => node.props.value === 'object-a').props.onChange({ target: { value: 'object-a' } });
  await flush();
  fixture.render();
  assert.equal(fixture.draft.files, fixture.files);
  assert.equal(fixture.dialog.options.length, 0);
  assert.deepEqual(fixture.changes, []);
  assert.deepEqual(fixture.submissions, []);
});

test('target switch without attachments and comment-only creation do not require upload permission', async () => {
  const fixture = taskFormFixture();
  fixture.draft.files = [];
  let tree = fixture.render({ canUploadFiles: false });
  nodes(tree, 'Select').find((node) => node.props.value === 'object-a').props.onChange({ target: { value: 'object-b' } });
  await flush();
  assert.equal(fixture.draft.value.objectId, 'object-b');
  assert.equal(fixture.dialog.options.length, 0);
  tree = fixture.render({ canUploadFiles: false });
  nodes(tree, 'form')[0].props.onSubmit({ preventDefault() {} });
  await flush();
  assert.equal(fixture.submissions.length, 1);
  assert.equal(fixture.submissions[0].payload.objectId, 'object-b');
  assert.deepEqual(fixture.submissions[0].attachments, []);
});
