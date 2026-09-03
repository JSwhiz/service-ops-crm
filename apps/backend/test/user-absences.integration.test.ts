import assert from 'node:assert/strict';
import test from 'node:test';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

interface AuthMe { id: string; }
interface AbsenceList { items: Array<{ id: string; userId: string; absenceType: string }>; capabilities: { canViewAll: boolean; canManage: boolean }; }

function isoDate(offsetDays: number): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return date.toISOString().slice(0, 10);
}

test('CRM user absence schedule separates self-read from leadership management', async (t) => {
  const { app, baseUrl } = await createTestApp();
  const [founderCookie, managerCookie] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' }),
  ]);
  t.after(async () => { await app.close(); });

  const [founderMeResponse, managerMeResponse] = await Promise.all([
    fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Cookie: founderCookie } }),
    fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Cookie: managerCookie } }),
  ]);
  assert.equal(founderMeResponse.status, 200);
  assert.equal(managerMeResponse.status, 200);
  const founder = (await founderMeResponse.json()) as AuthMe;
  const manager = (await managerMeResponse.json()) as AuthMe;

  const startDate = isoDate(20);
  const endDate = isoDate(22);
  const createResponse = await fetch(`${baseUrl}/api/v1/user-absences`, {
    method: 'POST',
    headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: manager.id,
      absenceType: 'vacation',
      startDate,
      endDate,
      comment: 'Integration fixture',
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()) as { id: string; userId: string };
  assert.equal(created.userId, manager.id);

  const founderListResponse = await fetch(
    `${baseUrl}/api/v1/user-absences?userId=${manager.id}&from=${startDate}&to=${endDate}`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(founderListResponse.status, 200);
  const founderList = (await founderListResponse.json()) as AbsenceList;
  assert.equal(founderList.capabilities.canViewAll, true);
  assert.equal(founderList.capabilities.canManage, true);
  assert.ok(founderList.items.some((item) => item.id === created.id));

  const ownListResponse = await fetch(
    `${baseUrl}/api/v1/user-absences?from=${startDate}&to=${endDate}`,
    { headers: { Cookie: managerCookie } },
  );
  assert.equal(ownListResponse.status, 200);
  const ownList = (await ownListResponse.json()) as AbsenceList;
  assert.equal(ownList.capabilities.canViewAll, false);
  assert.equal(ownList.capabilities.canManage, false);
  assert.ok(ownList.items.some((item) => item.id === created.id));
  assert.ok(ownList.items.every((item) => item.userId === manager.id));

  const forbiddenRead = await fetch(
    `${baseUrl}/api/v1/user-absences?userId=${founder.id}`,
    { headers: { Cookie: managerCookie } },
  );
  assert.equal(forbiddenRead.status, 403);

  const forbiddenCreate = await fetch(`${baseUrl}/api/v1/user-absences`, {
    method: 'POST',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: manager.id, absenceType: 'day_off', startDate: isoDate(30), endDate: isoDate(30) }),
  });
  assert.equal(forbiddenCreate.status, 403);

  const deleteResponse = await fetch(`${baseUrl}/api/v1/user-absences/${created.id}`, {
    method: 'DELETE',
    headers: { Cookie: founderCookie },
  });
  assert.equal(deleteResponse.status, 200);
});
