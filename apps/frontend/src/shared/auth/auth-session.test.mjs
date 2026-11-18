import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(new URL('./auth-session.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

test('logout suspension drains existing refresh, blocks new ones and suppresses obsolete failure events', async () => {
  let rejectRefresh;
  let calls = 0;
  let events = 0;
  const pending = new Promise((_resolve, reject) => { rejectRefresh = reject; });
  const exports = {};
  runInNewContext(compiled, {
    exports, Event, AbortSignal,
    window: { dispatchEvent: () => { events++; } },
    require: () => ({ fetcher: () => { calls++; return pending; } }),
  });
  const refreshing = exports.refreshSession();
  const resume = exports.suspendSessionRefresh();
  const drain = exports.waitForPendingSessionRefresh();
  assert.ok(drain);
  assert.equal(await exports.refreshSession(), false);
  assert.equal(calls, 1);
  rejectRefresh(new Error('Old refresh failed'));
  assert.equal(await drain, false);
  assert.equal(await refreshing, false);
  assert.equal(events, 0);
  resume();
  resume();
  await exports.refreshSession();
  assert.equal(calls, 2);
  assert.equal(events, 1);
});
