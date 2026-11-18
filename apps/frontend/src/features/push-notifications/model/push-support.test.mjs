import assert from 'node:assert/strict';
import test from 'node:test';
import { pushSupport, pushErrorMessage, vapidApplicationKey, pushTestFeedback } from './push-support.ts';
const base = { secure: true, serviceWorker: true, pushManager: true, notification: true, userAgent: 'Chrome Android', platform: 'Linux', maxTouchPoints: 1, standalone: false };
test('secure context and actual feature detection gate connect; iOS install instructions precede unsupported', () => {
  assert.equal(pushSupport(base), 'supported');
  assert.equal(pushSupport({ ...base, secure: false }), 'insecure');
  assert.equal(pushSupport({ ...base, notification: false }), 'unsupported');
  assert.equal(pushSupport({ ...base, userAgent: 'iPhone', notification: false }), 'ios-install');
  assert.equal(pushSupport({ ...base, userAgent: 'iPhone', standalone: true }), 'supported');
  assert.equal(pushSupport({ ...base, platform: 'MacIntel', maxTouchPoints: 5 }), 'ios-install');
});
test('permission errors are actionable and raw provider diagnostics never enter fallback', () => {
  const denied = new Error('private endpoint'); denied.name = 'NotAllowedError';
  assert.match(pushErrorMessage(denied), /настройках браузера/);
  assert(!pushErrorMessage(new Error('private endpoint')).includes('private endpoint'));
});
test('application key base64url yields original bytes', () => {
  const bytes = Uint8Array.from([4, 255, 0, 222]);
  const key = Buffer.from(bytes).toString('base64url');
  assert.deepEqual(new Uint8Array(vapidApplicationKey(key)), bytes);
});

test('delivery status never equates provider acceptance to phone receipt and exposes actionable safe failures', () => {
  const sent = pushTestFeedback({ status: 'sent', errorCode: null, finishedAt: null });
  assert.match(sent.text, /не подтверждает получение/);
  assert.match(pushTestFeedback({ status: 'failed', errorCode: 'endpoint_expired', finishedAt: null }).text, /заново/);
  assert(!pushTestFeedback({ status: 'failed', errorCode: 'secret provider URL', finishedAt: null }).text.includes('secret'));
});
