import assert from 'node:assert/strict';
import test from 'node:test';

import { getChatSystemTarget, getSafeLocalTarget } from './safe-local-target.ts';

const objectId = '8a9c3a42-5f6b-4a72-9f5e-3c6f2d3a1b70';
const orderId = '6b3e6a10-1b24-4e7f-8d31-2c4a9b6e5f80';
const reportId = 'a41f6b20-9d3c-4e75-8a12-5f6b3d9e2c40';
const seedObjectId = '11111111-1111-1111-1111-111111111111';

test('accepts supported entity targets and existing notification deep links', () => {
  assert.equal(getSafeLocalTarget(`/objects/${objectId}`), `/objects/${objectId}`);
  assert.equal(getSafeLocalTarget(`/objects/${seedObjectId}`), `/objects/${seedObjectId}`);
  assert.deepEqual(getChatSystemTarget({ objectId: seedObjectId, status: 'active' }), { href: `/objects/${seedObjectId}`, label: 'Открыть объект' });
  assert.equal(getSafeLocalTarget(`/objects/${objectId}#today`), `/objects/${objectId}#today`);
  assert.equal(getSafeLocalTarget(`/objects/${objectId}#planning`), `/objects/${objectId}#planning`);
  assert.equal(getSafeLocalTarget(`/objects/${objectId}#reports`), `/objects/${objectId}#reports`);
  assert.equal(getSafeLocalTarget(`/one-time-orders/${orderId}`), `/one-time-orders/${orderId}`);
  assert.equal(getSafeLocalTarget(`/one-time-orders/${orderId}?section=execution`), `/one-time-orders/${orderId}?section=execution`);
  assert.equal(getSafeLocalTarget(`/candidates/${objectId}`), `/candidates/${objectId}`);
  assert.equal(getSafeLocalTarget(`/employees/${objectId}`), `/employees/${objectId}`);
  assert.equal(getSafeLocalTarget(`/tasks/${objectId}`), `/tasks/${objectId}`);
  assert.equal(getSafeLocalTarget(`/chats?roomId=${objectId}`), `/chats?roomId=${objectId}`);
  assert.equal(getSafeLocalTarget(`/visit-plans?date=2026-10-31&managerUserId=${objectId}`), `/visit-plans?date=2026-10-31&managerUserId=${objectId}`);
});

test('normalizes legacy task notification links to the canonical detail route', () => {
  const legacy = `/tasks?taskId=${objectId}`;
  const canonical = `/tasks/${objectId}`;
  assert.equal(getSafeLocalTarget(legacy), canonical);
  assert.deepEqual(getChatSystemTarget({ targetUrl: legacy }), { href: canonical, label: 'Открыть' });
});

test('accepts the exact daily report target and legacy report section target', () => {
  const exact = `/objects/${objectId}?reportDate=2026-10-31&reportId=${reportId}#reports`;
  assert.equal(getSafeLocalTarget(exact), exact);
  // New publication shape: targetUrl carries the report date and id explicitly.
  assert.deepEqual(getChatSystemTarget({ objectId, reportId, reportDate: '2026-10-31', targetUrl: exact }), { href: exact, label: 'Открыть отчёт' });
  assert.equal(getChatSystemTarget({ objectId, reportId, reportDate: '2026-10-30', targetUrl: exact }), null);
  const legacy = `/objects/${objectId}#reports`;
  // Legacy publication shape has an object and report id, but no date in targetUrl.
  assert.deepEqual(getChatSystemTarget({ objectId, reportId, targetUrl: legacy }), { href: legacy, label: 'Открыть отчёты объекта' });
  assert.equal(getChatSystemTarget({ objectId, reportId, targetUrl: `/objects/${objectId}?reportDate=2026-10-31#reports` }), null);
  assert.equal(getChatSystemTarget({ objectId, reportId, targetUrl: `/objects/${orderId}?reportDate=2026-10-31&reportId=${reportId}#reports` }), null);
});

test('builds chat links only from explicit, valid entity metadata', () => {
  assert.deepEqual(getChatSystemTarget({ entityType: 'object', entityId: objectId }), { href: `/objects/${objectId}`, label: 'Открыть объект' });
  assert.deepEqual(getChatSystemTarget({ entityType: 'one_time_order', entityId: orderId }), { href: `/one-time-orders/${orderId}`, label: 'Открыть разовый заказ' });
  assert.deepEqual(getChatSystemTarget({ objectId, status: 'active' }), { href: `/objects/${objectId}`, label: 'Открыть объект' });
  assert.deepEqual(getChatSystemTarget({ oneTimeOrderId: orderId, status: 'open' }), { href: `/one-time-orders/${orderId}`, label: 'Открыть разовый заказ' });
  assert.equal(getChatSystemTarget({ entityType: 'object', entityId: 'not-an-id' }), null);
  assert.equal(getChatSystemTarget({ entityType: 'unknown', entityId: objectId }), null);
  assert.deepEqual(getChatSystemTarget({ budgetAlertId: objectId, objectId, targetUrl: `/objects/${objectId}#planning` }), { href: `/objects/${objectId}#planning`, label: 'Открыть бюджет объекта' });
  assert.equal(getChatSystemTarget({ budgetAlertId: objectId, objectId, targetUrl: `/objects/${orderId}#planning` }), null);
  // The real system-message creation shapes use objectId and oneTimeOrderId directly.
  assert.deepEqual(getChatSystemTarget({ objectId, status: 'active', targetUrl: `/objects/${objectId}` }), { href: `/objects/${objectId}`, label: 'Открыть объект' });
  assert.deepEqual(getChatSystemTarget({ oneTimeOrderId: orderId, status: 'open', targetUrl: `/one-time-orders/${orderId}?section=execution` }), { href: `/one-time-orders/${orderId}?section=execution`, label: 'Открыть разовый заказ' });
});

test('rejects untrusted, malformed, and unrecognized targets', () => {
  for (const value of [
    'https://example.com', '//example.com/path', 'javascript:alert(1)', '/\\evil.example',
    ' /objects/' + objectId, `/objects/${objectId}/extra`, `/objects/${objectId}?next=https://example.com`,
    `/objects/${objectId}?reportDate=2026-02-30&reportId=${reportId}#reports`,
    `/objects/${objectId}?reportDate=2026-10-31&reportId=bad#reports`,
    `/objects/${objectId}?reportDate=2026-10-31&reportDate=2026-10-30&reportId=${reportId}#reports`,
    `/objects/%2e%2e/${objectId}`, `/objects/%2F%2Fevil.example`, '/unknown/path',
    `/tasks?taskId=${objectId}&extra=1`, `/one-time-orders/${orderId}?section=unknown`,
    `/tasks?taskId=bad`, `/tasks?taskId=${objectId}&taskId=${objectId}`, `/tasks?taskId=${objectId}#details`,
    `/one-time-orders/${orderId}?section=execution&section=elsewhere`,
  ]) assert.equal(getSafeLocalTarget(value), null, value);
  assert.equal(getChatSystemTarget({ targetUrl: 'javascript:alert(1)', entityType: 'object', entityId: objectId }), null);
  assert.equal(getChatSystemTarget({ objectId, reportId, targetUrl: `/objects/${objectId}?reportDate=2026-10-31&reportId=${orderId}#reports` }), null);
  assert.equal(getChatSystemTarget({ oneTimeOrderId: 'not-an-id' }), null);
  assert.equal(getSafeLocalTarget(`/tasks/${objectId}?next=https://evil.example`), null);
});
