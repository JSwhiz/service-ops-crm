import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Reuse the shell test's actual-TSX/controlled-hooks pattern. This is NOT a
// React renderer or DOM: refs, effect commits, clocks, listeners and body are
// explicit fakes. No browser layout, native focus, API, socket or DB evidence.
function fixture(kind) {
  const slots = [], effects = [], portals = [], timers = new Map(), frames = new Map();
  const cancelledTimers = [], cancelledFrames = [], added = [], removed = [], focused = [];
  let cursor = 0, nextId = 1, blocked = false, revision = 'synthetic-user:1', closed = 0;
  const body = { syntheticBody: true };
  const targets = new Map();
  const target = name => {
    const listeners = new Map();
    targets.set(name, listeners);
    return {
      addEventListener(type, callback, capture) {
        const key = `${type}:${capture === true}`;
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(callback); added.push({ name, type, callback, capture });
      },
      removeEventListener(type, callback, capture) {
        listeners.get(`${type}:${capture === true}`)?.delete(callback);
        removed.push({ name, type, callback, capture });
      },
    };
  };
  const link = { closest: () => ({ dataset: { sidebarExpanded: 'false' } }),
    getBoundingClientRect: () => ({ right: 100, top: 40, height: 24 }) };
  const anchor = { getBoundingClientRect: () => ({ right: 400, top: 100, height: 24 }) };
  const menu = { scrollHeight: 80, querySelector: () => ({ focus: options => focused.push(options) }) };
  const window = { ...target('window'), innerWidth: 1200, innerHeight: 800,
    visualViewport: { ...target('viewport'), width: 1200, height: 800, offsetTop: 0 },
    requestAnimationFrame(callback) { const id = nextId++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { cancelledFrames.push(id); frames.delete(id); },
  };
  const document = { body, querySelector: () => anchor };
  const setTimer = (callback, delay) => { const id = nextId++; timers.set(id, { callback, delay }); return id; };
  const clearTimer = id => { cancelledTimers.push(id); timers.delete(id); };
  const effect = (callback, deps) => {
    const index = cursor++, previous = slots[index];
    if (previous && deps?.length === previous.deps?.length && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
    const entry = { deps };
    slots[index] = entry;
    effects.push(() => { previous?.cleanup?.(); entry.cleanup = callback(); });
  };
  const React = {
    Fragment: 'Fragment',
    createElement(type, props, ...children) {
      if (props?.ref && typeof props.ref === 'object') props.ref.current = type === 'Link' ? link : menu;
      return { type, props: { ...props, children } };
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useId: () => 'synthetic-tooltip', useContext: () => blocked,
    useEffect: effect, useLayoutEffect: effect,
  };
  React.default = React;
  const modules = {
    react: React,
    'react-dom': { createPortal(child, destination) { portals.push({ child, destination }); return { type: 'Portal', props: { children: [child] } }; } },
    'next/link': { default: 'Link' }, 'next/navigation': { usePathname: () => '/objects' },
    '@/shared/lib/cn': { cn: (...values) => values.filter(Boolean).join(' ') },
    '@/shared/auth/access-snapshot-boundary': { AccessSnapshotBlockedContext: {} },
    '@/shared/auth/use-access-revision': { useAccessRevision: () => revision },
    './chat-ui.module.css': { default: { messageMenu: 'synthetic-menu' } },
  };
  const path = kind === 'nav' ? '../nav-link/nav-link.tsx' : '../../../app/(app)/chats/chat-message-menu.tsx';
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  });
  const exports = {};
  new Function('require', 'exports', 'document', 'window', 'CSS', 'setTimeout', 'clearTimeout', compiled.outputText)(name => {
    if (!(name in modules)) throw Error(`Unexpected dependency ${name}`);
    return modules[name];
  }, exports, document, window, { escape: value => value }, setTimer, clearTimer);
  const props = kind === 'nav' ? { href: '/objects', label: 'Synthetic objects' }
    : { messageId: 'synthetic-message-a', onClose: () => { closed += 1; }, children: 'Synthetic action' };
  return {
    portals, timers, frames, added, removed, focused, cancelledTimers, cancelledFrames, body,
    setBlocked(value) { blocked = value; }, setRevision(value) { revision = value; },
    get closed() { return closed; },
    render({ commit = true } = {}) {
      assert.equal(effects.length, 0, 'Commit the previous render before rendering again');
      cursor = 0; portals.length = 0;
      const tree = kind === 'nav' ? exports.NavLink(props) : exports.ChatMessageMenu(props);
      if (commit) this.commit();
      return tree;
    },
    commit() { const pending = effects.splice(0); pending.forEach(run => run()); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
    runTimers() { const pending = [...timers]; timers.clear(); pending.forEach(([, { callback }]) => callback()); },
    runFrames() { const pending = [...frames]; frames.clear(); pending.forEach(([, callback]) => callback()); },
    listenerCount() { return [...targets.values()].reduce((total, listeners) => total + [...listeners.values()].reduce((sum, entries) => sum + entries.size, 0), 0); },
  };
}
function nodes(node, type, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (node.type === type) result.push(node);
  for (const child of node.props?.children?.flat(Infinity) ?? []) nodes(child, type, result);
  return result;
}
const nav = tree => nodes(tree, 'Link')[0];
const assertNoPortal = f => assert.equal(f.portals.length, 0, 'No createPortal call, not merely a hidden portal child');

test('NavLink delays its actual body tooltip and clears it on leave/blur', () => {
  const f = fixture('nav');
  const tree = f.render(); assertNoPortal(f);
  nav(tree).props.onPointerEnter(); assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].delay, 320);
  f.runTimers(); nav(f.render());
  assert.equal(f.portals.length, 1); assert.equal(f.portals[0].destination, f.body);
  assert.equal(f.portals[0].child.props.role, 'tooltip');
  nav(f.render()).props.onPointerLeave(); f.render(); assertNoPortal(f);
  nav(f.render()).props.onFocus(); assert.equal(f.timers.size, 1);
  nav(f.render()).props.onBlur(); assert.equal(f.timers.size, 0);
  f.runTimers(); f.render(); assertNoPortal(f); f.unmount();
});

test('NavLink block cancels the timer; a retained callback cannot create a portal while blocked or auto-open on restore', () => {
  const f = fixture('nav');
  nav(f.render()).props.onPointerEnter();
  const [id, pending] = [...f.timers][0];
  f.setBlocked(true); const blocked = f.render({ commit: false }); assertNoPortal(f);
  f.commit(); assert.deepEqual(f.cancelledTimers, [id]); assert.equal(f.timers.size, 0);
  pending.callback(); // Adversarial retained work after cancellation, while blocked.
  nav(blocked).props.onFocus(); f.render(); assertNoPortal(f);
  f.runTimers(); f.setBlocked(false); f.render(); assertNoPortal(f);
  f.runTimers(); f.render(); assertNoPortal(f);
  nav(f.render()).props.onFocus(); f.runTimers(); f.render();
  assert.equal(f.portals.length, 1, 'Only a new explicit focus opens a new tooltip'); f.unmount();
});

test('NavLink conceals an already-open portal before effects and does not restore old intent', () => {
  const f = fixture('nav'); nav(f.render()).props.onFocus(); f.runTimers(); f.render();
  assert.equal(f.portals.length, 1);
  f.setBlocked(true); f.render({ commit: false }); assertNoPortal(f); f.commit();
  f.setBlocked(false); f.render(); assertNoPortal(f); f.unmount();
});

test('NavLink unmount cancels the exact pending tooltip timer', () => {
  const f = fixture('nav'); nav(f.render()).props.onPointerEnter();
  const id = [...f.timers.keys()][0]; f.unmount();
  assert.deepEqual(f.cancelledTimers, [id]); assert.equal(f.timers.size, 0);
  f.runTimers(); assertNoPortal(f);
});

test('ChatMessageMenu uses document.body and removes exact listeners and focus frame on unmount', () => {
  const f = fixture('chat'); f.render();
  assert.equal(f.portals.length, 1); assert.equal(f.portals[0].destination, f.body);
  assert.equal(f.portals[0].child.props.role, 'menu');
  assert.deepEqual(f.added.map(({ name, type, capture }) => [name, type, capture]), [
    ['window', 'resize', undefined], ['window', 'scroll', true], ['viewport', 'resize', undefined],
  ]);
  assert.equal(f.listenerCount(), 3); assert.equal(f.frames.size, 1);
  const frame = [...f.frames.keys()][0]; f.unmount();
  assert.deepEqual(f.removed, f.added); assert.deepEqual(f.cancelledFrames, [frame]);
  assert.equal(f.listenerCount(), 0); assert.equal(f.frames.size, 0);
  f.runFrames(); assert.deepEqual(f.focused, []);
});

test('ChatMessageMenu initially blocked creates no portal/listeners/frame and requests close', () => {
  const f = fixture('chat'); f.setBlocked(true); f.render();
  assertNoPortal(f); assert.equal(f.closed, 1);
  assert.equal(f.listenerCount(), 0); assert.equal(f.frames.size, 0); f.unmount();
});

test('ChatMessageMenu revision invalidation conceals synchronously, cancels resources and rejects stale positioning after restore', () => {
  const f = fixture('chat'); f.render();
  const stalePlace = f.added[0].callback, frame = [...f.frames.keys()][0];
  f.setRevision('synthetic-user:2'); f.render({ commit: false }); assertNoPortal(f);
  f.commit(); assert.equal(f.closed, 1); assert.equal(f.listenerCount(), 0);
  assert.deepEqual(f.removed, f.added); assert.deepEqual(f.cancelledFrames, [frame]);
  stalePlace(); f.runFrames(); f.render(); assertNoPortal(f);
  assert.deepEqual(f.focused, []);
  f.setBlocked(true); f.render(); assertNoPortal(f);
  f.setBlocked(false); f.setRevision('synthetic-user:3');
  stalePlace(); f.render(); assertNoPortal(f);
  assert.equal(f.listenerCount(), 0); assert.equal(f.frames.size, 0); f.unmount();
});

test('ChatMessageMenu block closes the mounted intent; parent-honoured close does not auto-mount on restore', () => {
  const f = fixture('chat'); f.render();
  f.setBlocked(true); f.render({ commit: false }); assertNoPortal(f); f.commit();
  assert.equal(f.closed, 1); assert.equal(f.listenerCount(), 0); assert.equal(f.frames.size, 0);
  // Actual caller contract: onClose removes this component. We do not pretend
  // that a mock renderer reconciles/unmounts the parent automatically.
  f.unmount(); f.setBlocked(false); f.runFrames(); f.runTimers(); assertNoPortal(f);
  const explicitNewIntent = fixture('chat'); explicitNewIntent.render();
  assert.equal(explicitNewIntent.portals.length, 1); explicitNewIntent.unmount();
});
