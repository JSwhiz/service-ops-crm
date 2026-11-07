import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as accessGeneration from '../auth/access-generation.ts';

const source = readFileSync(new URL('./fetcher.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function controlledFetcher() {
  let releaseRefresh;
  let notifyRefreshStarted;
  const started = new Promise((resolve) => { notifyRefreshStarted = resolve; });
  const refreshed = new Promise((resolve) => { releaseRefresh = resolve; });
  const requests = [];
  const exports = {};
  runInNewContext(compiled, {
    exports, FormData, TypeError, Error,
    require(name) {
      if (name === '@/shared/config/app-config') return { appConfig: { apiUrl: 'https://test.invalid' } };
      if (name === '@/shared/auth/access-generation') return accessGeneration;
      if (name === '@/shared/auth/auth-session') return { refreshSession: () => { notifyRefreshStarted(); return refreshed; } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    fetch: async (_url, options) => {
      requests.push(options);
      return requests.length === 1 ? new Response('', { status: 401 }) : new Response('{"saved":true}', { status: 200 });
    },
  });
  return { fetcher: exports.fetcher, started, releaseRefresh, requests };
}

test('delayed session refresh never replays an old write after identity/access version changed', async () => {
  accessGeneration.updateAccessIdentity('old-user:1');
  const controlled = controlledFetcher();
  const pending = controlled.fetcher('/orders/test/review', { method: 'POST', body: '{"text":"draft"}' });
  await controlled.started;
  accessGeneration.updateAccessIdentity('new-user:2');
  controlled.releaseRefresh(true);
  await assert.rejects(pending, (error) => error.code === 'ACCESS_VERSION_CHANGED');
  assert.equal(controlled.requests.length, 1, 'no second write under the new identity');
});

test('same identity/version retains the existing single auth retry', async () => {
  accessGeneration.updateAccessIdentity('same-user:1');
  const controlled = controlledFetcher();
  const pending = controlled.fetcher('/orders/test/review', { method: 'POST', body: '{"text":"draft"}' });
  await controlled.started;
  accessGeneration.updateAccessIdentity('same-user:1');
  controlled.releaseRefresh(true);
  assert.equal((await pending).saved, true);
  assert.equal(controlled.requests.length, 2);
});
