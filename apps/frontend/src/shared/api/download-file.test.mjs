import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as generation from '../auth/access-generation.ts';

const compiled = ts.transpileModule(readFileSync(new URL('./download-file.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function client(fetch, refreshSession = async () => true) {
  const exports = {};
  class ApiError extends Error {
    constructor(message, status, code) { super(message); this.statusCode = status; this.code = code; }
  }
  runInNewContext(compiled, {
    exports, fetch,
    require(name) {
      if (name.endsWith('/app-config')) return { appConfig: { apiUrl: 'https://test.invalid' } };
      if (name.endsWith('/auth-session')) return { refreshSession };
      if (name.endsWith('/access-generation')) return generation;
      if (name === './fetcher') return { ApiError };
      throw new Error(name);
    },
  });
  return () => exports.downloadFile('/test.xlsx', 'Не удалось скачать');
}

test('obsolete export response cannot refresh or replay under a different user', async () => {
  generation.updateAccessIdentity('download-old:1');
  let respond;
  let refreshes = 0;
  const download = client(() => new Promise((resolve) => { respond = resolve; }), async () => { refreshes++; return true; });
  const pending = download();
  generation.updateAccessIdentity('download-new:1');
  respond(new Response('', { status: 401 }));
  await assert.rejects(pending, (error) => error.code === 'ACCESS_VERSION_CHANGED');
  assert.equal(refreshes, 0);
});
test('export does not retry after access changes during refresh', async () => {
  generation.updateAccessIdentity('download-refresh:1');
  let calls = 0;
  const download = client(async () => { calls++; return new Response('', { status: 401 }); }, async () => {
    generation.updateAccessIdentity(null);
    return true;
  });
  await assert.rejects(download(), (error) => error.code === 'ACCESS_VERSION_CHANGED');
  assert.equal(calls, 1);
});
test('export blob resolved after revoke is not delivered', async () => {
  generation.updateAccessIdentity('download-blob:1');
  const download = client(async () => ({ ok: true, status: 200, blob: async () => {
    generation.updateAccessIdentity(null);
    return new Blob(['test']);
  } }));
  await assert.rejects(download(), (error) => error.code === 'ACCESS_VERSION_CHANGED');
});
test('unchanged identity can refresh once and receive its export', async () => {
  generation.updateAccessIdentity('download-same:1');
  let calls = 0;
  const download = client(async () => ++calls === 1 ? new Response('', { status: 401 }) : new Response('test'));
  assert.equal(await (await download()).text(), 'test');
  assert.equal(calls, 2);
});
