import assert from 'node:assert/strict';
import test from 'node:test';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

interface LeadershipDashboardPayload {
  timeZone: string;
  attention: { total: number; items: unknown[] };
  today: {
    activeObjects: number;
    employeesOnObjects: number;
    objectsWithoutAttendanceMark: number;
    oneTimeOrders: number;
    decisionsRequired: number;
  };
  tasks: { totalRelevant: number; items: unknown[] };
  money: { available: boolean };
  objects: { active: number; problematic: number; items: unknown[] };
  orders: { totalAccessible: number; items: unknown[] };
  people: { available: boolean; userAbsencesAvailable: boolean };
}

test('leadership dashboard is access-safe and returns bounded operational previews', async (t) => {
  const { app, baseUrl } = await createTestApp();
  const [founderCookie, managerCookie] = await Promise.all([
    loginAndGetCookieHeader({
      baseUrl,
      login: 'founder',
      password: 'founder123',
    }),
    loginAndGetCookieHeader({
      baseUrl,
      login: 'manager1',
      password: 'manager123',
    }),
  ]);

  t.after(async () => {
    await app.close();
  });

  const response = await fetch(`${baseUrl}/api/v1/dashboard/leadership`, {
    headers: { Cookie: founderCookie },
  });
  assert.equal(response.status, 200);
  const payload = (await response.json()) as LeadershipDashboardPayload;

  assert.equal(payload.timeZone, 'Europe/Moscow');
  assert.ok(payload.attention.items.length <= 5);
  assert.ok(payload.tasks.items.length <= 5);
  assert.ok(payload.objects.items.length <= 4);
  assert.ok(payload.orders.items.length <= 3);
  assert.ok(payload.today.activeObjects >= 0);
  assert.ok(payload.today.employeesOnObjects >= 0);
  assert.ok(payload.objects.problematic <= payload.objects.active);
  assert.equal(typeof payload.money.available, 'boolean');
  assert.equal(typeof payload.people.available, 'boolean');
  assert.equal(payload.people.userAbsencesAvailable, false);

  const expandedResponse = await fetch(
    `${baseUrl}/api/v1/dashboard/leadership?expanded=true`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(expandedResponse.status, 200);
  const expanded = (await expandedResponse.json()) as LeadershipDashboardPayload;
  assert.ok(expanded.attention.items.length <= 14);
  assert.ok(expanded.tasks.items.length <= 14);
  assert.equal(expanded.attention.total, payload.attention.total);
  assert.equal(expanded.tasks.totalRelevant, payload.tasks.totalRelevant);

  const forbidden = await fetch(`${baseUrl}/api/v1/dashboard/leadership`, {
    headers: { Cookie: managerCookie },
  });
  assert.equal(forbidden.status, 403);
});
