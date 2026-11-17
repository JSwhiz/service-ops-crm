import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const workerSource = readFileSync(new URL('../../../../public/push-worker.js', import.meta.url), 'utf8');
const id = 'ae6ae657-e1fd-40a7-83b1-551eb4cf09c4';
function worker() {
  const events = new Map(), notices = [], opened = [];
  const self = { addEventListener: (name, callback) => events.set(name, callback), registration: { showNotification: async (title, options) => { notices.push({ title, options }); } }, clients: { openWindow: async href => { opened.push(href); }, claim: async () => {} }, skipWaiting: async () => {}, location: { origin: 'https://crm.example.invalid' } };
  vm.runInNewContext(workerSource, { self, URL });
  async function dispatch(name, properties = {}) { let promise; events.get(name)({ ...properties, waitUntil: value => { promise = value; } }); await promise; }
  return { dispatch, notices, opened, events };
}
test('real worker code always shows generic visible notification and ignores sensitive/forged payload fields', async () => {
  const w = worker(); await w.dispatch('push', { data: { json: () => ({ deliveryId: id, title: 'Secret salary', body: 'Private reason', targetUrl: 'https://attacker.invalid' }) } });
  assert.equal(w.notices.length, 1);
  assert.equal(w.notices[0].title, 'Service Ops CRM');
  assert(!JSON.stringify(w.notices).includes('Secret salary')); assert(!JSON.stringify(w.notices).includes('Private reason')); assert(!JSON.stringify(w.notices).includes('attacker'));
  assert.equal(w.events.has('fetch'), false, 'No offline/private response cache or fetch interception');
});
test('malformed push still produces generic feedback, no silent push', async () => {
  const w = worker(); await w.dispatch('push', { data: { json: () => { throw Error('bad JSON'); } } }); assert.equal(w.notices.length, 1); assert.equal(w.notices[0].options.data.deliveryId, null);
});
test('click never trusts payload URL; opens only authenticated settings resolver at own origin', async () => {
  const w = worker(); let closed = false;
  await w.dispatch('notificationclick', { notification: { close: () => { closed = true; }, data: { deliveryId: id, url: 'https://attacker.invalid' } } });
  assert(closed); assert.deepEqual(w.opened, [`https://crm.example.invalid/settings/notifications?delivery=${id}`]);
  const x = worker(); await x.dispatch('notificationclick', { notification: { close() {}, data: { deliveryId: '//attacker.invalid' } } }); assert.deepEqual(x.opened, ['https://crm.example.invalid/settings/notifications']);
});
test('same delivery retry uses stable notification tag to replace duplicate visible notices', async () => {
  const w = worker(); for (let i = 0; i < 2; i++) await w.dispatch('push', { data: { json: () => ({ deliveryId: id }) } }); assert.equal(w.notices[0].options.tag, w.notices[1].options.tag);
});
