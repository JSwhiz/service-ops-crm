import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [foundation, shell, toolbar] = await Promise.all([
  readFile(new URL('./ui-foundation.css', import.meta.url), 'utf8'),
  readFile(new URL('./app-shell.css', import.meta.url), 'utf8'),
  readFile(new URL('../ui/registry-filters/registry-toolbar.module.css', import.meta.url), 'utf8'),
]);

function mobileTouchRules(css) {
  const rules = css.match(/@media \(max-width: 760px\), \(any-pointer: coarse\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(rules, '44 px targets apply to narrow fine-pointer and hybrid touch layouts');
  return rules;
}

test('registry actions wrap without forcing every link to full width or hiding overflow', () => {
  const actions = toolbar.match(/\.actions\s*\{([^}]+)\}/)?.[1];
  assert.match(actions, /flex-wrap:\s*wrap/);
  assert.match(actions, /min-width:\s*0/);
  assert.doesNotMatch(toolbar, /\.actions\s*>\s*\*\s*\{[^}]*(?<![-\w])width:\s*100%/);
  assert.doesNotMatch(toolbar, /\.actions[^{}]*\{[^}]*overflow(?:-x)?:\s*hidden/);
});

test('shared mobile icons cannot flex-shrink below the 44 px target', () => {
  const rules = mobileTouchRules(foundation);
  assert.match(rules, /\.ui-icon-button\s*\{[^}]*width:\s*44px/);
  assert.match(rules, /min-width:\s*44px/);
  assert.match(rules, /height:\s*44px/);
  assert.match(rules, /flex-shrink:\s*0/);
  assert.match(foundation, /\.ui-icon-button\s*\{[^}]*width:\s*var\(--ui-control-md\)/,
    'fine-pointer desktop keeps the existing dense base size');
});

test('compact header reserves five nonshrinking targets without negative spacing', () => {
  const rules = mobileTouchRules(shell);
  for (const selector of ['.global-command-trigger', '.global-create__trigger', '.app-header__icon-link', '.notification-bell__trigger']) {
    assert.ok(rules.includes(selector), `${selector} participates in the header target floor`);
  }
  assert.match(rules, /width:\s*44px;[\s\S]*min-width:\s*44px;[\s\S]*height:\s*44px;[\s\S]*min-height:\s*44px;[\s\S]*flex-shrink:\s*0/);
  const compact = shell.slice(shell.lastIndexOf('@media (max-width: 760px)'));
  assert.match(compact, /\.app-header\s*\{[^}]*gap:\s*4px;[^}]*padding-inline:\s*12px/);
  assert.match(compact, /\.app-header__command-zone\s*\{[^}]*margin-right:\s*0/);
  assert.match(compact, /\.app-header__actions\s*\{[^}]*flex:\s*0 0 auto/);
  assert.match(compact, /\.app-header__account-trigger\s*\{[^}]*width:\s*44px;[^}]*padding:\s*0/);
  assert.match(compact, /\.app-header__account-chevron,\s*\.app-header__separator\s*\{\s*display:\s*none/);
  // Reservation check only: main must still measure rendered inner boundaries.
  const available = 390 - 58 - 2 * 12;
  assert.ok(5 * 44 + 4 * 4 <= available, 'five controls and their gaps fit the 332 px main column');
});
