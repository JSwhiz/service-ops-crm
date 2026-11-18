import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Cheap wiring contracts only; no claim of browser/network-race execution.
const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

test('create discovery is server-projected and fails closed during revision refresh', () => {
  assert.match(page, /const accessRevision = useAccessRevision\(\)/);
  assert.match(page, /JSON\.stringify\(\[accessRevision, page, reloadKey\]\)/);
  assert.match(page, /loadedScope === scope && !loading && !error/);
  assert.match(page, /list\?\.capabilities\?\.canCreate === true/);
  assert.match(page, /actions=\{canCreate \?/);
  assert.match(page, /accessCurrent && list\?\.items\.map/);
  assert.match(page, /accessCurrent && list \? <TablePagination/);
  assert.doesNotMatch(page, /roleCodes|permissionCodes/);
  assert.match(page, /list\?\.capabilities\?\.canCreateForOthers === true/);
});

test('revision hides stale options without destroying the private draft', () => {
  assert.match(page, /currentOptionsScope\.current === optionsScope/);
  assert.match(page, /setLoadedOptionsScope\(null\)/);
  assert.match(page, /options=\{optionsCurrent && canCreate \? users : \[\]\}/);
  assert.match(page, /optionsCurrent && canCreate && objects\.map/);
  assert.match(page, /<SearchableSelect key=\{optionsScope\}/);
  assert.match(page, /<Dialog open=\{open\}/);
  assert.match(page, /selectedOption=\{draft\.value\.replacementOption\}/);
  assert.match(page, /selected\.map\(\(item\)/);
  assert.doesNotMatch(page, /useEffect\([^]*?draft\.clear\(\)[^]*?\[accessRevision\]/);
});

test('principal is separate from replacement and only an actual target change clears incompatible selections', () => {
  assert.match(page, /label="Чей доступ передаётся" value=\{principal\}/);
  assert.match(page, /label="Кто замещает" value=\{replacement\}/);
  assert.match(page, /value === principal\) return/);
  assert.match(page, /principal: value, principalOption: target,\s*replacement: '', replacementOption: null, selected: \[\]/);
  assert.match(page, /principal: canCreateOwn && user \? user\.id : ''/);
  assert.match(page, /createUserSubstitution\(\{ principalUserId: principal/);
  assert.match(page, /getSubstitutionOptions\(\{ principalSearch: query \}\)/);
  assert.match(page, /const selectedIdsKey = selected\.map\(item => item\.id\)\.sort\(\)\.join\(','\)/);
  assert.match(page, /JSON\.stringify\(\[scope, principal, objectSearch, selectedIdsKey\]\)/);
  assert.match(page, /selectedObjectIds: selectedIdsKey \? selectedIdsKey\.split\(','\) : \[\]/);
  assert.match(page, /setEligibleSelectedObjectIds\(response\.eligibleSelectedObjectIds \?\? \[\]\)/);
  assert.match(page, /selectedObjectsAllowed = selected\.every\(item => eligibleSelectedObjectIds\.includes\(item\.id\)\)/);
  assert.match(page, /canSubmit = canCreate && optionsCurrent && !!principal && selectedObjectsAllowed/);
});

test('submit and revoke consult current capabilities, not a stale target snapshot', () => {
  assert.match(page, /!actionState\.current\.canSubmit \|\| actionState\.current\.scope !== scope/);
  assert.match(page, /list\?\.items\.find\(\(item\) => item\.id === revokeTarget\?\.id && item\.canRevoke\)/);
  assert.match(page, /const target = actionState\.current\.currentRevokeTarget/);
  assert.match(page, /revokeUserSubstitution\(target\.id, value\)/);
  assert.match(page, /<ReasonDialog open=\{!!currentRevokeTarget\}/);
  assert.doesNotMatch(page, /revokeUserSubstitution\(revokeTarget\.id/);
  assert.match(page, /if \(currentScope\.current !== scope\) \{ submitLock\.current = false; return; \}/);
});
