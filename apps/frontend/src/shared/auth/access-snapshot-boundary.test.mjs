import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const boundary = readFileSync(new URL('./access-snapshot-boundary.tsx', import.meta.url), 'utf8');
const overlays = readFileSync(new URL('../ui/overlays/overlays.tsx', import.meta.url), 'utf8');
const floating = readFileSync(new URL('../ui/overlays/use-floating-position.ts', import.meta.url), 'utf8');
const menu = readFileSync(new URL('../ui/overflow-menu/overflow-menu.tsx', import.meta.url), 'utf8');

test('permission refresh hides snapshots during render, preserving child component state', () => {
  assert.match(boundary, /ancestorBlocked \|\| blocked/);
  assert.match(boundary, /hidden=\{concealed\}/);
  assert.match(boundary, /display: concealed \? 'none' : 'contents'/);
  assert.match(boundary, />\{children\}<\/div>/);
  assert.doesNotMatch(boundary, /key=|concealed\s*\?\s*null/);
});

test('native popovers subscribe to the same boundary and leave the top layer on suspension', () => {
  assert.match(floating, /if \(!open \|\| accessBlocked\) return/);
  assert.match(floating, /floating.hidePopover\(\)/);
  assert.match(floating, /return accessBlocked \? null : position/);
  assert.match(menu, /if \(accessBlocked\) \{/);
  assert.match(menu, /menu.hidePopover\(\)/);
  assert.match(menu, /style=\{accessBlocked \? \{ display: 'none' \} : undefined\}/);
});

test('top-layer overlays are immediately hidden and suspended without discarding open form state', () => {
  assert.match(overlays, /style=\{accessBlocked \? \{ \.\.\.props.style, display: 'none' \} : props.style\}/);
  assert.match(overlays, /open && !accessBlocked && !dialog.open/);
  assert.match(overlays, /if \(accessBlocked\) suspendedCloseEvents.current \+= 1/);
  assert.match(overlays, /suspendedCloseEvents.current -= 1;\s*event.stopPropagation\(\);\s*return;/);
});
