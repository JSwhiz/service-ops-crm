import assert from 'node:assert/strict';
import test from 'node:test';
import { handleSelectEscape } from './select-escape.ts';

function keyEvent(key) {
  const native = new Event('keydown', { cancelable: true, bubbles: true });
  let stopped = false;
  return {
    event: { key, preventDefault: () => native.preventDefault(), stopPropagation: () => { stopped = true; native.stopPropagation(); } },
    native,
    get stopped() { return stopped; },
  };
}

test('first Escape closes only the open menu and restores its trigger; second Escape reaches the parent', () => {
  let open = true;
  let parentOpen = true;
  let focused = 'option';
  const pressEscape = () => {
    const key = keyEvent('Escape');
    handleSelectEscape(key.event, open, () => { open = false; }, () => { focused = 'trigger'; });
    // A native dialog's default cancel must be prevented as well as bubbling.
    if (!key.native.defaultPrevented) parentOpen = false;
    return key;
  };
  const first = pressEscape();
  assert.equal(open, false);
  assert.equal(parentOpen, true);
  assert.equal(focused, 'trigger');
  assert.equal(first.native.defaultPrevented, true);
  assert.equal(first.stopped, true);
  const second = pressEscape();
  assert.equal(parentOpen, false);
  assert.equal(second.native.defaultPrevented, false);
  assert.equal(second.stopped, false);
});

test('Escape from trigger, search input or option has the same menu-only behavior', () => {
  for (const source of ['trigger', 'search input', 'option']) {
    let focused = source;
    let closes = 0;
    const key = keyEvent('Escape');
    handleSelectEscape(key.event, true, () => { closes++; }, () => { focused = 'trigger'; });
    assert.equal(closes, 1);
    assert.equal(focused, 'trigger');
    assert.equal(key.native.defaultPrevented, true);
  }
});

test('closed menus and other keys do not intercept parent keyboard behavior', () => {
  for (const [open, code] of [[false, 'Escape'], [true, 'Enter'], [true, 'Tab']]) {
    const key = keyEvent(code);
    handleSelectEscape(key.event, open, () => assert.fail('must not close'), () => assert.fail('must not move focus'));
    assert.equal(key.native.defaultPrevented, false);
    assert.equal(key.stopped, false);
  }
});
