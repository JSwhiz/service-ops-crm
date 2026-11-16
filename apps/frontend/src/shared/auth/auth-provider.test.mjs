import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { setImmediate as settleRequests } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(new URL('./auth-provider.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;

class TestApiError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

// Executes the real provider with controlled requests and hook storage. This is
// a lifecycle regression test, not a browser or React renderer acceptance test.
function provider({ getProfile, loginRequest, confirmProfile } = {}) {
  const slots = [];
  const effects = [];
  const redirects = [];
  let index = 0;
  let profileReads = 0;
  let loginCalls = 0;
  let issuedUser;
  let logoutCalls = 0;
  let finishLogout;
  const logoutWait = new Promise((resolve) => { finishLogout = resolve; });
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    createElement: (_type, props) => props.value,
    useState(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], (value) => { slots[slot] = value; }];
    },
    useRef(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = { current: initial };
      return slots[slot];
    },
    useCallback: (callback) => callback,
    useMemo: (factory) => factory(),
    useEffect: (effect) => { effects.push(effect); },
  };
  const exports = {};
  runInNewContext(compiled, {
    exports, window: {},
    require(name) {
      if (name === 'react') return { ...react, default: react };
      if (name === 'next/navigation') return {
        usePathname: () => '/dashboard',
        useRouter: () => ({ replace: (path) => redirects.push(path) }),
      };
      if (name === './auth-client') return {
        getMe: async (options) => {
          if (options?.confirmLogin) return confirmProfile ? confirmProfile(issuedUser) : issuedUser;
          profileReads++;
          return getProfile ? getProfile(profileReads) : { id: 'old', accessVersion: 1 };
        },
        login: async () => {
          loginCalls++;
          const response = loginRequest ? await loginRequest() : { user: { id: 'new', accessVersion: 1 } };
          issuedUser = response.user;
          return response;
        },
        logout: () => { logoutCalls++; return logoutWait; },
      };
      if (name === './auth-session') return {
        subscribeToAuthCleared: () => () => {},
        subscribeToAccessChange: () => () => {},
        notifyOtherTabsOfAccessChange: () => {},
        suspendSessionRefresh: () => () => {},
        waitForPendingSessionRefresh: () => null,
        withAuthCookieLock: (write) => write(),
        notifyOtherTabsOfLogout: () => {},
      };
      if (name === '@/shared/api/fetcher') return { ApiError: TestApiError };
      if (name === './access-generation') return { updateAccessIdentity: () => {} };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const render = () => { index = 0; return exports.AuthProvider({ children: null }); };
  const initial = render();
  effects[0]();
  return { initial, render, finishLogout, redirects, reads: () => profileReads, logins: () => loginCalls, logouts: () => logoutCalls };
}

test('profile refresh during pending logout cannot restore the previous account', async () => {
  const app = provider();
  await app.initial.refreshUser();
  const current = app.render();
  assert.equal(current.user.id, 'old');
  const exiting = current.logout();
  const readsBeforeFocus = app.reads();
  await current.refreshUser();
  assert.equal(app.reads(), readsBeforeFocus, 'no profile read while logout is pending');
  assert.equal(app.render().user, null);
  app.finishLogout();
  await exiting;
  assert.equal(app.render().user, null);
});

test('a new login waits for pending logout, then retains the new identity', async () => {
  const app = provider();
  await app.initial.refreshUser();
  const current = app.render();
  const exiting = current.logout();
  const entering = current.login({ login: 'new', password: 'test' });
  await Promise.resolve();
  assert.equal(app.logins(), 0, 'late logout must not erase a new login cookie');
  app.finishLogout();
  await Promise.all([exiting, entering]);
  assert.equal(app.render().user.id, 'new');
});

test('logout waits for an existing profile refresh before clearing cookies and deduplicates repeated clicks', async () => {
  let finishProfile;
  const profileWait = new Promise((resolve) => { finishProfile = resolve; });
  const app = provider({ getProfile: (read) => read === 1 ? { id: 'old' } : profileWait });
  await app.initial.refreshUser();
  const current = app.render();
  const refreshing = current.refreshUser();
  const exiting = current.logout();
  const duplicate = current.logout();
  await Promise.resolve();
  assert.equal(app.logouts(), 0);
  finishProfile({ id: 'old' });
  await refreshing;
  await settleRequests();
  assert.equal(app.logouts(), 1);
  assert.equal(app.render().user, null, 'late old profile never becomes visible');
  app.finishLogout();
  await Promise.all([exiting, duplicate]);
  assert.equal(app.logouts(), 1);
  assert.equal(app.redirects.length, 1);
});

test('superseded login rejects instead of telling its caller to navigate successfully', async () => {
  const app = provider();
  await app.initial.refreshUser();
  const current = app.render();
  const entering = current.login({ login: 'new', password: 'test' });
  const exiting = current.logout();
  await assert.rejects(entering, /Вход отменён/);
  app.finishLogout();
  await exiting;
  assert.equal(app.render().user, null);
});

test('logout drains every forced profile request, not just the most recent one', async () => {
  const releases = [];
  const app = provider({ getProfile: (read) => read === 1 ? { id: 'old' } : new Promise((resolve) => releases.push(resolve)) });
  await app.initial.refreshUser();
  const current = app.render();
  const earlier = current.refreshUser({ force: true });
  const latest = current.refreshUser({ force: true });
  const exiting = current.logout();
  releases[1]({ id: 'old' });
  await latest;
  await Promise.resolve();
  assert.equal(app.logouts(), 0);
  releases[0]({ id: 'old' });
  await earlier;
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(app.logouts(), 1);
  app.finishLogout();
  await exiting;
  assert.equal(app.render().user, null);
});

test('already sent login settles before logout clears its cookie', async () => {
  let finishLogin;
  const loginWait = new Promise((resolve) => { finishLogin = resolve; });
  const app = provider({ loginRequest: () => loginWait });
  await app.initial.refreshUser();
  const current = app.render();
  const entering = current.login({ login: 'new', password: 'test' });
  await Promise.resolve();
  assert.equal(app.logins(), 1);
  const exiting = current.logout();
  await Promise.resolve();
  assert.equal(app.logouts(), 0);
  finishLogin({ user: { id: 'new' } });
  await assert.rejects(entering, /Вход отменён/);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(app.logouts(), 1);
  app.finishLogout();
  await exiting;
  assert.equal(app.render().user, null);
});

test('failed login queued behind logout does not leave loading stuck', async () => {
  const app = provider({ loginRequest: async () => { throw new Error('Invalid credentials'); } });
  await app.initial.refreshUser();
  const current = app.render();
  const exiting = current.logout();
  const entering = current.login({ login: 'new', password: 'wrong' });
  app.finishLogout();
  await exiting;
  await assert.rejects(entering, /Invalid credentials/);
  assert.equal(app.render().isLoading, false);
  assert.equal(app.render().user, null);
});

test('a rejected login confirmation retires the issued cookies before the form can retry', async () => {
  const app = provider({ confirmProfile: async () => { throw new TestApiError('Access denied', 401); } });
  await app.initial.refreshUser();
  const entering = app.render().login({ login: 'new', password: 'test' });
  const rejected = assert.rejects(entering, /Access denied/);
  await settleRequests();
  assert.equal(app.logouts(), 1);
  assert.equal(app.render().user.id, 'old');
  app.finishLogout();
  await rejected;
  assert.equal(app.render().user.id, 'old');
});
