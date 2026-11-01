import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const cssUrl = new URL('../../../entities/one-time-order/ui/one-time-order-ui.module.css', import.meta.url);
const componentUrl = new URL('./one-time-order-list-table.tsx', import.meta.url);

test('order address clipping stays inside a semantic table cell', async () => {
  const [css, component] = await Promise.all([
    readFile(cssUrl, 'utf8'),
    readFile(componentUrl, 'utf8'),
  ]);
  const addressContentRules = css.match(/\.oneTimeOrderRegistryAddressContent\s*\{[^}]*\}/)?.[0];
  const addressCellRules = css.match(/\.oneTimeOrderRegistryAddress\s*\{[^}]*\}/)?.[0];

  assert.match(component, /<td[^>]*oneTimeOrderRegistryAddress[^>]*>[\s\S]*?<span className=\{orderStyles\.oneTimeOrderRegistryAddressContent\}>/);
  assert.ok(addressContentRules, 'address text has its own clamped content wrapper');
  assert.match(addressContentRules, /display:\s*-webkit-box/);
  assert.ok(addressCellRules, 'address cell keeps its own wrapping rules');
  assert.doesNotMatch(addressCellRules, /display:\s*(?:flow-root|block|grid|-webkit-box)/);
  assert.match(component, /closest\('a, button, \[role="button"\]'\)/);
});
