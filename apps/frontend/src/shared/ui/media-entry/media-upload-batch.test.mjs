import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { mergeMediaUploadFailures, runMediaUploadBatch } from './media-upload-batch.ts';

test('a denied snapshot retains every selected file without starting a callback', async () => {
  const files = ['A', 'B'];
  const called = [];
  assert.deepEqual(await runMediaUploadBatch(files, () => false, async file => { called.push(file); }),
    files.map(file => ({ file, stopped: true })));
  assert.deepEqual(called, []);
});

test('revoke after the first response stops the rest and never retries the successful file', async () => {
  let allowed = true;
  const called = [];
  const pending = await runMediaUploadBatch(['A', 'B', 'C'], () => allowed, async file => {
    called.push(file); allowed = false;
  });
  assert.deepEqual(called, ['A']);
  assert.deepEqual(pending, [{ file: 'B', stopped: true }, { file: 'C', stopped: true }]);
  allowed = true;
  assert.deepEqual(await runMediaUploadBatch(pending.map(row => row.file), () => allowed, async file => { called.push(file); }), []);
  assert.deepEqual(called, ['A', 'B', 'C']);
});

test('one ordinary failure retains its cause and does not repeat successful peers', async () => {
  const cause = new Error('controlled failure');
  const called = [];
  const failed = await runMediaUploadBatch(['A', 'B'], () => true, async file => {
    called.push(file); if (file === 'A') throw cause;
  });
  assert.deepEqual(failed, [{ file: 'A', stopped: false, cause }]);
  assert.deepEqual(called, ['A', 'B']);
});

test('the picker gates native inputs, menus, callbacks and retries by current upload/snapshot authority', () => {
  const source = readFileSync(new URL('./media-action-picker.tsx', import.meta.url), 'utf8');
  assert.match(source, /canUploadFile === true/);
  assert.match(source, /isAccessGenerationCurrent\(generation\)/);
  assert.match(source, /runMediaUploadBatch\(files,/);
  assert.match(source, /menuOpen && !isDisabled/);
  assert.match(source, /if \(!isDisabled\) input.current\?\.click\(\)/);
  assert.ok((source.match(/disabled=\{isDisabled\}/g) ?? []).length >= 4);
  assert.match(source, /setPendingFailures\(previous => mergeMediaUploadFailures\(previous, files, failures\)\)/);
  assert.match(source, /if \(!mounted\.current \|\| batchInFlight\.current\) return/);
  assert.match(source, /\(\) => isCurrentPicker\(\) && availableAtStart && uploadAvailable\.current && isAccessGenerationCurrent\(generation\), onPick/);
  assert.match(source, /<AttachmentTrigger\s+ref=\{triggerRef\}\s+disabled=\{isDisabled\}\s+aria-expanded=\{menuOpen\}\s+aria-haspopup="menu"/);
  const trigger = readFileSync(new URL('./attachment-trigger.tsx', import.meta.url), 'utf8');
  assert.match(trigger, /<IconButton\s+ref=\{ref\}\s+\{\.\.\.props\}/);
});

test('a later selection preserves earlier failures until an explicit retry or discard', async () => {
  const a = { name: 'same.txt' }, b = { name: 'same.txt' };
  const previous = [{ file: a, stopped: true }];
  const successfulNewBatch = await runMediaUploadBatch([b], () => true, async () => {});
  assert.deepEqual(mergeMediaUploadFailures(previous, [b], successfulNewBatch), previous);
  const cause = new Error('retry failure');
  const failedRetry = await runMediaUploadBatch([a], () => true, async () => { throw cause; });
  const retained = mergeMediaUploadFailures(previous, [a], failedRetry);
  assert.deepEqual(retained, [{ file: a, stopped: false, cause }]);
  assert.deepEqual(mergeMediaUploadFailures(retained, [a], []), []);
});
