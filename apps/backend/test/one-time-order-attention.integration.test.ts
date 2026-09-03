import assert from 'node:assert/strict';
import test from 'node:test';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

interface AttentionPayload {
  items: Array<{ id: string; status: string; executionStartDate: string | null }>;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

test('one-time-order attention preset filters before pagination and keeps deterministic urgency order', async (t) => {
  const { app, baseUrl } = await createTestApp();
  const [founderCookie, managerCookie] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' }),
  ]);
  t.after(async () => { await app.close(); });

  for (const cookie of [founderCookie, managerCookie]) {
    const response = await fetch(`${baseUrl}/api/v1/one-time-orders/attention?page=1&limit=100`, {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as AttentionPayload;
    assert.equal(payload.page, 1);
    assert.equal(payload.limit, 100);
    assert.ok(payload.total >= payload.items.length);
    assert.equal(payload.totalPages, Math.ceil(payload.total / 100));
    assert.ok(payload.items.every((item) => !['completed', 'cancelled'].includes(item.status)));

    let previousDate: string | null = null;
    let sawNull = false;
    for (const item of payload.items) {
      if (item.executionStartDate === null) {
        sawNull = true;
        continue;
      }
      assert.equal(sawNull, false, 'dated orders must be before no-date orders');
      if (previousDate) {
        assert.ok(previousDate <= item.executionStartDate, 'attention orders must be ordered by execution date ascending');
      }
      previousDate = item.executionStartDate;
    }
  }
});
