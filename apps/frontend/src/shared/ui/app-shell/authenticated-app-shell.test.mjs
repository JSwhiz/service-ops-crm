import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

// Execute the real component's render/handlers with controlled hook storage.
// No React renderer, native overlays, cookies, network or browser claims.
function fixture() {
  const slots = [];
  let cursor = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useEffect: () => {},
  };
  React.default = React;
  const calls = [];
  const auth = { user: { id: 'synthetic-user' }, isAuthenticated: true, isLoading: false,
    capabilitiesRefreshError: null,
    refreshUser: async options => { calls.push({ refresh: options }); },
    logout: async () => { calls.push({ logout: true }); },
  };
  const modules = {
    react: React,
    'next/navigation': { useRouter: () => ({ replace: path => { calls.push({ redirect: path }); } }) },
    '@/shared/auth/use-auth': { useAuth: () => auth },
    '@/shared/create-navigation': { CreateNavigationProvider: 'CreateNavigationProvider' },
    '@/shared/drafts': { CreateDraftProvider: 'CreateDraftProvider' },
    '@/shared/auth/access-snapshot-boundary': { AccessSnapshotBoundary: 'AccessSnapshotBoundary' },
    '@/shared/ui/foundation': { Alert: 'Alert', Button: 'Button', Surface: 'Surface' },
    './app-shell': { AppShell: 'AppShell' },
  };
  const compiled = ts.transpileModule(readFileSync(new URL('./authenticated-app-shell.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', compiled)(name => {
    if (!(name in modules)) throw Error(`Unexpected dependency ${name}`);
    return modules[name];
  }, exports);
  const child = { privateDraft: 'same synthetic draft identity' };
  return { auth, calls, child, render() { cursor = 0; return exports.AuthenticatedAppShell({ children: child }); } };
}
function nodes(node, type, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (node.type === type) result.push(node);
  for (const child of node.props?.children?.flat(Infinity) ?? []) nodes(child, type, result);
  return result;
}
const boundary = tree => nodes(tree, 'AccessSnapshotBoundary')[0];
const button = (tree, label) => nodes(tree, 'Button').find(node => node.props.children.includes(label));

test('unknown access conceals shell/data immediately without replacing draft providers or private children', () => {
  const f = fixture();
  const before = f.render();
  assert.equal(boundary(before).props.blocked, false);
  f.auth.capabilitiesRefreshError = 'refresh unavailable';
  const blocked = f.render();
  assert.equal(boundary(blocked).props.blocked, true);
  assert.equal(nodes(blocked, 'AppShell')[0].props.children[0], f.child);
  assert.equal(nodes(blocked, 'CreateDraftProvider')[0].props.userId, 'synthetic-user');
  assert.equal(boundary(before).props.key, boundary(blocked).props.key);
  assert.equal(f.calls.length, 0, 'No automatic write, refresh loop or logout');
  assert.ok(button(blocked, 'Проверить доступ'));
  assert.ok(button(blocked, 'Выйти'));
});

test('manual recovery waits for the actual profile result and preserves the hidden subtree until success', async () => {
  const f = fixture();
  f.auth.capabilitiesRefreshError = 'refresh unavailable';
  const pending = deferred();
  f.auth.refreshUser = async options => {
    f.calls.push({ refresh: options });
    await pending.promise;
    f.auth.capabilitiesRefreshError = null;
  };
  button(f.render(), 'Проверить доступ').props.onClick();
  let tree = f.render();
  assert.equal(boundary(tree).props.blocked, true);
  assert.equal(button(tree, 'Проверить доступ').props.disabled, true);
  assert.equal(button(tree, 'Выйти').props.disabled, false, 'Recovery must not make logout unavailable');
  button(tree, 'Проверить доступ').props.onClick();
  assert.deepEqual(f.calls, [{ refresh: { force: true } }]);
  pending.resolve(); await flush();
  tree = f.render();
  assert.equal(boundary(tree).props.blocked, false);
  assert.equal(nodes(tree, 'AppShell')[0].props.children[0], f.child);
  assert.equal(f.calls.length, 1);
});

test('failed recovery stays concealed, enables explicit retry, and never echoes internal server details', async () => {
  const f = fixture();
  f.auth.capabilitiesRefreshError = 'refresh unavailable';
  f.auth.refreshUser = async () => { throw new Error('synthetic private server details'); };
  button(f.render(), 'Проверить доступ').props.onClick(); await flush();
  const tree = f.render();
  assert.equal(boundary(tree).props.blocked, true);
  assert.equal(button(tree, 'Проверить доступ').props.disabled, false);
  const alerts = JSON.stringify(nodes(tree, 'Alert'));
  assert.match(alerts, /Проверка доступа пока недоступна/);
  assert.doesNotMatch(alerts, /synthetic private server details/);
});

test('logout remains callable while recovery is pending and never submits a private page action', async () => {
  const f = fixture();
  f.auth.capabilitiesRefreshError = 'refresh unavailable';
  const pending = deferred();
  f.auth.refreshUser = async () => { f.calls.push({ refresh: true }); await pending.promise; };
  button(f.render(), 'Проверить доступ').props.onClick();
  button(f.render(), 'Выйти').props.onClick(); await flush();
  assert.deepEqual(f.calls, [{ refresh: true }, { logout: true }]);
  assert.equal(boundary(f.render()).props.blocked, true);
  pending.resolve(); await flush();
});

test('initial loading and signed-out sessions never render a protected shell', () => {
  const f = fixture();
  f.auth.isLoading = true;
  assert.equal(nodes(f.render(), 'AppShell').length, 0);
  f.auth.isLoading = false; f.auth.isAuthenticated = false; f.auth.user = null;
  assert.equal(f.render(), null);
});
