import assert from 'node:assert/strict';
import test from 'node:test';
import { isOrderCreateSection, prepareCreateSubmission } from './create-request.ts';

for (const copyFrom of [null, 'original-order']) {
  test(`unknown POST outcome → Back/unmount → restored ${copyFrom ? 'copy' : 'create'} reuses the request key`, () => {
    let generated = 0;
    const uuid = () => `request-${++generated}`;
    const payload = { title: 'Заказ', agreedSum: 100, managerUserIds: ['manager'], executionStartDate: '2026-11-01' };
    const first = prepareCreateSubmission({ copyFrom, form: payload }, payload, uuid);
    // This is the persisted snapshot taken before sending. A timeout gives no proven success.
    const restoredDraft = JSON.parse(JSON.stringify(first.draft));
    const retry = prepareCreateSubmission(restoredDraft, { ...payload }, uuid);
    assert.equal(retry.creationRequestId, first.creationRequestId);
    assert.equal(retry.draft.creationRequest.fingerprint, first.draft.creationRequest.fingerprint);
    assert.equal(retry.draft.copyFrom, copyFrom);
    assert.equal(generated, 1);
  });
}

test('material payload change rotates the key; a discarded/successfully cleared draft starts fresh', () => {
  let generated = 0;
  const uuid = () => `request-${++generated}`;
  const first = prepareCreateSubmission({}, { agreedSum: 100 }, uuid);
  const changed = prepareCreateSubmission(first.draft, { agreedSum: 200 }, uuid);
  assert.notEqual(changed.creationRequestId, first.creationRequestId);
  const fresh = prepareCreateSubmission({}, { agreedSum: 100 }, uuid);
  assert.notEqual(fresh.creationRequestId, first.creationRequestId);
  assert.equal(generated, 3);
});

test('navigation adapter accepts only the five order sections', () => {
  for (const id of ['basic', 'planning', 'conditions', 'specification', 'notes']) assert.equal(isOrderCreateSection(id), true);
  for (const id of ['', 'contract', 'articles', '__proto__']) assert.equal(isOrderCreateSection(id), false);
});
