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

function controlledFetcher(respondToFetch) {
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
      if (respondToFetch) return respondToFetch();
      return requests.length === 1 ? new Response('', { status: 401 }) : new Response('{"saved":true}', { status: 200 });
    },
  });
  return { fetcher: exports.fetcher, postCommittedWrite: exports.postCommittedWrite, started, releaseRefresh, requests };
}

test('late 401 from an obsolete account cannot start cookie refresh', async () => {
  accessGeneration.updateAccessIdentity('late-old:1');
  let respond;
  let refreshCalls = 0;
  const exports = {};
  runInNewContext(compiled, {
    exports, FormData, TypeError, Error,
    require(name) {
      if (name === '@/shared/config/app-config') return { appConfig: { apiUrl: 'https://test.invalid' } };
      if (name === '@/shared/auth/access-generation') return accessGeneration;
      if (name === '@/shared/auth/auth-session') return { refreshSession: async () => { refreshCalls++; return true; } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    fetch: () => new Promise((resolve) => { respond = resolve; }),
  });
  const request = exports.fetcher('/orders/test');
  accessGeneration.updateAccessIdentity(null);
  respond(new Response('', { status: 401 }));
  await assert.rejects(request, (error) => error.code === 'ACCESS_VERSION_CHANGED');
  assert.equal(refreshCalls, 0);
});

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


test('a delayed successful financial write returns only confirmation after a same-account permission change', async () => {
  accessGeneration.updateAccessIdentity('finance:1');
  let respond;
  const controlled = controlledFetcher(() => new Promise((resolve) => { respond = resolve; }));
  const pending = controlled.postCommittedWrite('/timesheets/entries', { body: '{}' });
  accessGeneration.updateAccessIdentity('finance:2');
  respond(new Response('{"confidential":713}', { status: 201 }));
  assert.equal(JSON.stringify(await pending), '{"outcome":"saved_without_access"}');
  assert.equal(controlled.requests.length, 1);
});

test('a delayed write rejection stays an error after a same-account permission change', async () => {
  accessGeneration.updateAccessIdentity('finance:3');
  let respond;
  const controlled = controlledFetcher(() => new Promise((resolve) => { respond = resolve; }));
  const pending = controlled.postCommittedWrite('/timesheets/entries', { body: '{}' });
  accessGeneration.updateAccessIdentity('finance:4');
  respond(new Response('{"message":"Forbidden"}', { status: 403 }));
  await assert.rejects(pending, (error) => error.code === 'ACCESS_VERSION_CHANGED');
  assert.equal(controlled.requests.length, 1);
});

test('logout and re-entry as the same user discard an old financial write response', async () => {
  accessGeneration.updateAccessIdentity('finance:5');
  let respond;
  const controlled = controlledFetcher(() => new Promise((resolve) => { respond = resolve; }));
  const pending = controlled.postCommittedWrite('/timesheets/entries', { body: '{}' });
  accessGeneration.updateAccessIdentity(null);
  accessGeneration.updateAccessIdentity('finance:5');
  respond(new Response('{"confidential":713}', { status: 201 }));
  await assert.rejects(pending, (error) => error.code === 'ACCESS_VERSION_CHANGED');
  assert.equal(controlled.requests.length, 1);
});


test('a known successful stale write stays confirmed if its response body fails', async () => {
  accessGeneration.updateAccessIdentity('finance:6');
  let failBody;
  let notifyRead;
  const bodyStarted = new Promise((resolve) => { notifyRead = resolve; });
  const controlled = controlledFetcher(() => ({
    ok: true,
    status: 201,
    text: () => new Promise((_, reject) => { failBody = reject; notifyRead(); }),
  }));
  const pending = controlled.postCommittedWrite('/timesheets/entries', { body: '{}' });
  await bodyStarted;
  accessGeneration.updateAccessIdentity('finance:7');
  failBody(new TypeError('Connection closed after response headers'));
  assert.equal(JSON.stringify(await pending), '{"outcome":"saved_without_access"}');
  assert.equal(controlled.requests.length, 1);
});
