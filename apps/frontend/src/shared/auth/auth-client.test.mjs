import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('auth HTTP requests have an actual abort signal, not just a promise race timeout', async () => {
  const source = readFileSync(new URL('./auth-client.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const requests = [];
  const controllers = [];
  const exports = {};
  runInNewContext(compiled, {
    exports,
    AbortSignal: { timeout(ms) {
      assert.equal(ms, 30_000);
      const controller = new AbortController();
      controllers.push(controller);
      return controller.signal;
    } },
    require: () => ({ fetcher: async (path, options) => { requests.push({ path, ...options }); return {}; } }),
  });
  await exports.login({ login: 'test', password: 'test' });
  await exports.getMe();
  await exports.refreshSessionRequest();
  await exports.logout();
  assert.equal(requests.length, 4);
  for (const [index, request] of requests.entries()) {
    assert.equal(request.signal, controllers[index].signal);
    controllers[index].abort();
    assert.equal(request.signal.aborted, true);
    if (request.path !== '/auth/me') assert.equal(request.skipAuthRetry, true);
  }
});
