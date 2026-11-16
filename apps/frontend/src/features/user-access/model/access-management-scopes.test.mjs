import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { changeAccessMode, initialAccessDraft, isValidManagementChange, managementScopes, updateAccessChanges } from './access-management-scopes.ts';

const action = { code: 'accountability.review', name: 'Сверка счетов', manageable: true,
  allowedScopes: ['own','assigned','selected','all'], managementScopes: ['own','selected','all'] };
const original = { actionCode: action.code, effect: 'deny', scope: 'assigned', selectedIds: [] };

test('old catalog fallback, new draft scope, unchanged legacy draft and unrelated payload preservation', () => {
  const oldCatalog = { ...action };
  delete oldCatalog.managementScopes;
  assert.deepEqual(managementScopes(oldCatalog), action.allowedScopes);
  assert.deepEqual(managementScopes(action), ['own','selected','all']);
  assert.equal(initialAccessDraft(action).scope, 'own');
  assert.deepEqual(initialAccessDraft(action, original), original, 'No automatic assigned-to-own conversion');
  let changes = updateAccessChanges({}, { actionCode: 'tasks.read', effect: 'allow', scope: 'all', selectedIds: [] });
  changes = updateAccessChanges(changes, initialAccessDraft(action, original), original);
  assert.deepEqual(Object.keys(changes), ['tasks.read']);
  assert.deepEqual(original, { actionCode: action.code, effect: 'deny', scope: 'assigned', selectedIds: [] });
  changes = updateAccessChanges(changes, changeAccessMode(action, { ...original, scope: 'own' }, 'default', original), original);
  assert.equal(changes[action.code].scope, 'assigned');
  assert(isValidManagementChange(action, changes[action.code]));
});

test('assigned cannot be submitted as an edited grant/deny; explicit reset and supported replacement are permitted', () => {
  for (const effect of ['allow','deny']) assert.equal(isValidManagementChange(action, { ...original, effect }), false);
  assert(isValidManagementChange(action, { ...original, effect: 'default' }));
  assert(isValidManagementChange(action, { ...original, scope: 'own' }));
  assert.equal(isValidManagementChange(action, { ...original, scope: 'selected' }), false);
  assert(isValidManagementChange(action, { ...original, scope: 'selected', selectedIds: ['owner'] }));
  const constrained = { ...action, manageable: false, constraint: 'policy_decision_required' };
  assert.equal(isValidManagementChange(constrained, { ...original, effect: 'allow', scope: 'all' }), false);
  assert.equal(isValidManagementChange(constrained, { ...original, effect: 'deny', scope: 'own' }), false);
  assert(isValidManagementChange(constrained, { ...original, effect: 'default' }));
});

// Render the real editor; replace only the shared design-system wrappers.
// The component's conditional rendering, labels, fields and handlers execute.
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../ui/access-rule-editor.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } });
let controls = [];
const module = { exports: {} };
const localRequire = id => {
  if (id.endsWith('.module.css')) return new Proxy({}, { get: (_, key) => String(key) });
  if (id === '@/shared/ui/foundation') return {
    Field: ({ label, children, error }) => React.createElement('label', null, label, children, error ? React.createElement('span', { role: 'alert' }, error) : null),
    Button: props => { controls.push({ kind: 'button', ...props }); return React.createElement('button', props); },
  };
  if (id === '@/shared/ui/searchable-select/select') return { Select: props => {
    controls.push({ kind: 'select', ...props }); return React.createElement('select', { name: props.name, value: props.value, disabled: props.disabled, onChange: () => {} }, props.children);
  } };
  return require(id);
};
new Function('require','module','exports', compiled.outputText)(localRequire, module, module.exports);
const Editor = module.exports.AccessRuleEditor;
const baseProps = { title: action.name, editable: true, mode: 'deny', hasPersonalRule: true, scope: 'assigned',
  effectiveResult: 'По прежним правилам', source: 'Персональное правило', effectiveScope: 'Назначенные',
  supportedScopes: managementScopes(action).map(value => ({ value, label: value })),
  legacyScopeLabel: 'Назначенные', legacyScopeUnchanged: true, onModeChange: () => {}, onScopeChange: () => {} };

test('legacy display explains preserved rule without offering assigned or producing an automatic edit', () => {
  controls = []; const edits = [];
  const html = renderToStaticMarkup(React.createElement(Editor, { ...baseProps, onModeChange: v => edits.push(v), onScopeChange: v => edits.push(v) }));
  assert.match(html, /Прежняя область: Назначенные/);
  assert.match(html, /не меняется при сохранении других прав/);
  assert.doesNotMatch(html, /value="assigned"/);
  assert.doesNotMatch(html, /role="alert"/);
  assert.deepEqual(edits, []);
  const selector = controls.find(c => c.name === 'accessScope');
  assert.equal(selector.value, '', 'Only the display is blank; the legacy draft remains assigned');
  selector.onChange({ target: { value: 'assigned' } }); assert.deepEqual(edits, []);
  selector.onChange({ target: { value: 'own' } }); assert.deepEqual(edits, ['own']);
});

test('constrained legacy rule keeps the existing read-only policy boundary, including no new reset controls', () => {
  controls = []; const edits = [];
  const html = renderToStaticMarkup(React.createElement(Editor, { ...baseProps, editable: false,
    unavailableReason: 'Решение политики не утверждено', onModeChange: v => edits.push(v) }));
  assert.match(html, /Персональное управление этим действием остаётся недоступным/);
  assert.doesNotMatch(html, /Разрешить персонально|Запретить персонально|<select|<button/);
  assert.deepEqual(edits, []);
  assert.equal(controls.length, 0);
});
