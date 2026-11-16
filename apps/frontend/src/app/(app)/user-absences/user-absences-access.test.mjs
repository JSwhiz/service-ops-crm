import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Source contracts only: browser interaction, focus and network races belong to the main runner.
const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const dialog = readFileSync(new URL('../../../features/user-absence-create/ui/user-absence-create-dialog.tsx', import.meta.url), 'utf8');

test('selected rights use target capabilities instead of aggregate flags or roles', () => {
  for (const source of [page, dialog]) {
    assert.doesNotMatch(source, /canManageAll|canManage\b|canViewAll|\.role\b/);
    assert.match(source, /capabilities\?\.canCreate === true/);
  }
  assert.match(page, /params\.set\('forUser', target\.id\)/);
  assert.match(dialog, /const next = key === 'userId'\s*\? changeUserAbsenceCreateTarget\(draft\.value, value\)/);
});

test('update and delete actions have separate item gates and submit guards', () => {
  assert.match(page, /const canUpdate = currentEditing\?\.capabilities\?\.canUpdate === true/);
  assert.match(page, /const canDelete = currentDeleteTarget\?\.capabilities\?\.canDelete === true/);
  assert.match(page, /const canEdit = accessCurrent && item\.capabilities\?\.canUpdate === true/);
  assert.match(page, /const canDeleteItem = accessCurrent && item\.capabilities\?\.canDelete === true/);
  assert.match(page, /if \(mutationLock\.current \|\| !accessCurrent \|\| !canUpdate/);
  assert.match(page, /if \(mutationLock\.current \|\| !accessCurrent \|\| !canDelete/);
  assert.doesNotMatch(page, /createUserAbsence/);
});

test('private fields and event descriptions require target or item private capability', () => {
  assert.match(dialog, /const showComment = selectedTarget\?\.capabilities\?\.canViewPrivateReasons === true/);
  assert.match(page, /const showEditorComment = currentEditing\?\.capabilities\?\.canViewPrivateReasons === true/);
  assert.match(page, /const editorComment = commentTouched \? form\.comment : currentEditing\?\.comment \?\? ''/);
  assert.match(page, /showEditorComment \? <Field label="Комментарий"><input value=\{editorComment\}/);
  assert.match(page, /onChange=\{\(event\) => \{ setCommentTouched\(true\); setForm/);
  assert.match(page, /const openEdit = [\s\S]*?setEditing\(item\);\s*setCommentTouched\(false\);/);
  assert.equal([...page.matchAll(/setCommentTouched\(false\)/g)].length, 1, 'Only opening an editor resets comment intent; refresh must preserve typed text');
  assert.match(page, /toUpdateUserAbsencePayload\(form, currentEditing, commentTouched\)/);
  assert.match(page, /const comment = item\?\.capabilities\?\.canViewPrivateReasons \? item\.comment : null/);
  for (const source of [page, dialog]) {
    assert.doesNotMatch(source, /userId\s*(?:===|!==)\s*user\?\.id\s*\|\||canViewPrivateReasons\s*\|\|/);
  }
});

test('revision refresh fails closed and keeps open drafts mounted', () => {
  assert.match(page, /const accessRevision = useAccessRevision\(\)/);
  assert.match(page, /loadedScope === scope && !loading && !loadFailed/);
  assert.match(page, /request !== requestSequence\.current \|\| currentScope\.current !== scope/);
  assert.match(page, /if \(currentScope\.current !== scope\) return/);
  assert.match(page, /editorOpen && editing \? \(/);
  assert.match(page, /disabled=\{!canUpdate \|\| savePending \|\| deletePending\}/);
  assert.match(dialog, /\[accessRevision, retry\]/);
  assert.match(dialog, /const options = await listUserAbsenceUsers\(\);\s*if \(!active\) return;\s*setUsers\(options\);\s*setError\(null\);\s*setLoadedAccessRevision\(accessRevision\);/);
  assert.match(dialog, /loadedAccessRevision === accessRevision && !loading/);
  assert.match(dialog, /!accessCurrent \|\| !canCreate/);
  assert.match(dialog, /toCreateUserAbsencePayload\(draft\.value, selectedTarget\)/);
  assert.doesNotMatch(dialog, /draft\.setValue\([^)]*(?:user\?\.id|users\[0\])/);
});
