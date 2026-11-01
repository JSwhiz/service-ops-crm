import assert from 'node:assert/strict';
import test from 'node:test';

import { createAttachmentCorrectionDraft, reconcileRemovedAttachmentIds } from './attachment-correction-draft.ts';
import { shouldRenderCachedReportsForDate } from './report-link.ts';

test('drops stale local removals after refetch while preserving still-present selections', () => {
  assert.deepEqual(
    reconcileRemovedAttachmentIds(['still-attached', 'already-removed'], ['still-attached', 'unselected']),
    ['still-attached'],
  );
});

test('retains the correction reason and reuses successful stage IDs across partial staging failure', async () => {
  const draft = createAttachmentCorrectionDraft();
  const savedFile = new File(['saved'], 'saved.jpg', { type: 'image/jpeg' });
  const retryFile = new File(['retry'], 'retry.jpg', { type: 'image/jpeg' });
  draft.setReason('Исправление отчёта');
  const requests = new Map();

  assert.equal(await draft.stageFile(savedFile, async (requestId) => {
    requests.set('saved', requestId);
    return 'saved-file-id';
  }), 'saved-file-id');
  await assert.rejects(draft.stageFile(retryFile, async (requestId) => {
    requests.set('failed-attempt', requestId);
    throw new Error('temporary failure');
  }));
  assert.equal(draft.getReason(), 'Исправление отчёта');
  assert.equal(await draft.stageFile(savedFile, async () => { throw new Error('must reuse staged id'); }), 'saved-file-id');
  assert.equal(await draft.stageFile(retryFile, async (requestId) => {
    requests.set('retry', requestId);
    return 'retry-file-id';
  }), 'retry-file-id');
  assert.equal(requests.get('failed-attempt'), requests.get('retry'));
});

test('409 background refresh keeps the editor draft, reason, staged files and manual-review gate', async () => {
  const draft = createAttachmentCorrectionDraft();
  const pendingFile = new File(['pending'], 'pending.jpg', { type: 'image/jpeg' });
  const stagedId = await draft.stageFile(pendingFile, async () => 'staged-file');
  const payload = Object.freeze({
    expectedRevision: 7,
    requestId: 'r3-fixed-request-id',
    removeAttachmentIds: Object.freeze(['still-attached', 'stale-attachment']),
    addFileIds: Object.freeze([stagedId]),
    reason: 'Исправление отчёта',
  });
  draft.setReason(payload.reason);
  draft.setMutation(payload);

  // A transport uncertainty leaves this exact body available for retry.
  assert.strictEqual(draft.getMutation(), payload);
  assert.deepEqual(reconcileRemovedAttachmentIds(payload.removeAttachmentIds, ['still-attached']), ['still-attached']);

  // The same-date cache keeps the keyed editor mounted while its report list is reloaded.
  assert.equal(shouldRenderCachedReportsForDate('2026-10-31', '2026-10-31'), true);
  assert.equal(await draft.stageFile(pendingFile, async () => { throw new Error('must retain staged file'); }), stagedId);

  // A definitive stale-revision response requires a new reviewed mutation, not replay of the old body.
  draft.markConflict();
  assert.equal(draft.getMutation(), undefined);
  assert.equal(draft.getReason(), payload.reason);
  assert.equal(draft.needsReview(), true);
  draft.acknowledgeReview();
  assert.equal(draft.needsReview(), false);
  const reviewedPayload = Object.freeze({ ...payload, expectedRevision: 8, requestId: 'r3-reviewed-request-id', removeAttachmentIds: Object.freeze(['still-attached']) });
  draft.setMutation(reviewedPayload);
  assert.strictEqual(draft.getMutation(), reviewedPayload);
});
