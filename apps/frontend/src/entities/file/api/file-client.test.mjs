import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Execute the actual client with controlled HTTP outcomes; not storage or a browser.
function client(committedResult = { outcome: 'saved_without_access' }) {
  const calls = [];
  let sequence = 0;
  let fail = false;
  const exports = {};
  const source = readFileSync(new URL('./file-client.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports, FormData, URL, Promise,
    crypto: { randomUUID: () => `synthetic-upload-${++sequence}` },
    require: name => {
      if (name === '@/shared/config/app-config') return { appConfig: { apiUrl: 'http://127.0.0.1:4017/api/v1' } };
      if (name === '@/shared/api/fetcher') return { postCommittedWrite: async (path, options) => {
        calls.push({ path, ...options, method: 'POST' });
        if (fail) { fail = false; throw new Error('Controlled acknowledgement loss'); }
        return committedResult;
      }, fetcher: async (path, options) => {
        calls.push({ path, ...options });
        if (fail) { fail = false; throw new Error('Controlled acknowledgement loss'); }
        return { id: options.body.get('uploadId') };
      } };
      throw Error(`Unexpected dependency: ${name}`);
    },
  });
  return { api: exports, calls, failNext: () => { fail = true; } };
}

test('an explicit retry of the same retained File/target reuses its upload ID after acknowledgement loss', async () => {
  const { api, calls, failNext } = client();
  const file = new File(['synthetic text'], 'acceptance.txt', { type: 'text/plain' });
  const input = { entityType: 'object', entityId: 'A', file };
  failNext();
  await assert.rejects(api.uploadFileToEntity(input), /acknowledgement loss/);
  await api.uploadFileToEntity(input);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.get('uploadId'), calls[1].body.get('uploadId'));
  assert.equal(calls[1].body.get('entityId'), 'A');
  assert.equal(calls[1].body.get('originalName'), 'acceptance.txt');
});

test('another target or field has a separate ID; returning to the original target keeps its identity', async () => {
  const { api, calls } = client();
  const file = new File(['synthetic text'], 'acceptance.txt');
  for (const [entityId, fieldCode] of [['A', undefined], ['B', undefined], ['A', 'report'], ['A', undefined]]) {
    await api.uploadFileToEntity({ entityType: 'object', entityId, fieldCode, file });
  }
  const ids = calls.map(call => call.body.get('uploadId'));
  assert.equal(new Set(ids.slice(0, 3)).size, 3);
  assert.equal(ids[0], ids[3]);
});

test('a distinct explicit selection with the same filename does not impersonate a retained File', async () => {
  const { api, calls } = client();
  for (const content of ['first selection', 'second selection']) {
    await api.uploadFileToEntity({ entityType: 'object', entityId: 'A', file: new File([content], 'same.txt') });
  }
  assert.notEqual(calls[0].body.get('uploadId'), calls[1].body.get('uploadId'));
});

for (const result of [{ outcome: 'saved_without_access' }, { id: 'old-file', capabilities: { canDownload: true } }]) {
  test(`preview retry is an intent ACK, never metadata (${result.outcome ?? 'record'})`, async () => {
    const { api, calls } = client(result);
    assert.equal(await api.retryFilePreview('current-file'), undefined);
    assert.deepEqual(calls, [{ path: '/files/current-file/preview/retry', method: 'POST' }]);
  });
}

test('a failed preview retry is reported once without an automatic second mutation', async () => {
  const { api, calls, failNext } = client();
  failNext();
  await assert.rejects(api.retryFilePreview('current-file'), /acknowledgement loss/);
  assert.equal(calls.length, 1);
  assert.equal(await api.retryFilePreview('current-file'), undefined);
  assert.equal(calls.length, 2);
});
