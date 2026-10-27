import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

interface AuthMe { id: string; }
interface AbsenceList {
  items: Array<{ id: string; userId: string; absenceType: string; comment: string | null }>;
  capabilities: { canViewAll: boolean; canManage: boolean; canManageAll: boolean; canViewPrivateReasons: boolean };
}

function isoDate(offsetDays: number): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return date.toISOString().slice(0, 10);
}

test('user calendar shares free/busy, keeps reasons private and enforces own writes or personal grants', async (t) => {
  const { app, baseUrl } = await createTestApp();
  const [founderCookie, managerCookie, kireevaCookie, otherHrCookie, deputyDirectorCookie, corporateDirectorCookie] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'kireeva', password: 'kireeva123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'lazutina', password: 'lazutina123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'gorbacheva', password: 'gorbacheva123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'nikitina', password: 'nikitina123' }),
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
    headers: { Cookie: kireevaCookie, 'Content-Type': 'application/json' },
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

  const kireevaOwnTargetListResponse = await fetch(
    `${baseUrl}/api/v1/user-absences?userId=${manager.id}&from=${startDate}&to=${endDate}`,
    { headers: { Cookie: kireevaCookie } },
  );
  assert.equal(kireevaOwnTargetListResponse.status, 200);
  const kireevaOwnTargetList = (await kireevaOwnTargetListResponse.json()) as AbsenceList;
  assert.equal(kireevaOwnTargetList.capabilities.canViewAll, true);
  assert.equal(kireevaOwnTargetList.capabilities.canManageAll, true);
  assert.ok(kireevaOwnTargetList.items.some((item) => item.id === created.id));

  const founderForeignRead = await fetch(`${baseUrl}/api/v1/user-absences?userId=${manager.id}`, {
    headers: { Cookie: founderCookie },
  });
  assert.equal(founderForeignRead.status, 200);
  const founderList = (await founderForeignRead.json()) as AbsenceList;
  assert.equal(founderList.items.find((item) => item.id === created.id)?.comment, null);

  const ownListResponse = await fetch(
    `${baseUrl}/api/v1/user-absences?from=${startDate}&to=${endDate}`,
    { headers: { Cookie: managerCookie } },
  );
  assert.equal(ownListResponse.status, 200);
  const ownList = (await ownListResponse.json()) as AbsenceList;
  assert.equal(ownList.capabilities.canViewAll, true);
  assert.equal(ownList.capabilities.canManage, true);
  assert.equal(ownList.capabilities.canManageAll, false);
  assert.ok(ownList.items.some((item) => item.id === created.id));
  assert.equal(ownList.items.find((item) => item.id === created.id)?.comment, 'Integration fixture');

  const forbiddenRead = await fetch(
    `${baseUrl}/api/v1/user-absences?userId=${founder.id}`,
    { headers: { Cookie: managerCookie } },
  );
  assert.equal(forbiddenRead.status, 200);

  const forbiddenCreate = await fetch(`${baseUrl}/api/v1/user-absences`, {
    method: 'POST',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: founder.id, absenceType: 'day_off', startDate: isoDate(30), endDate: isoDate(30) }),
  });
  assert.equal(forbiddenCreate.status, 403);

  const otherHrList = await fetch(`${baseUrl}/api/v1/user-absences?userId=${manager.id}`, {
    headers: { Cookie: otherHrCookie },
  });
  assert.equal(otherHrList.status, 200);
  assert.equal(((await otherHrList.json()) as AbsenceList).items.find((item) => item.id === created.id)?.comment, null);
  const otherHrOwn = await fetch(`${baseUrl}/api/v1/user-absences`, {
    headers: { Cookie: otherHrCookie },
  });
  assert.equal(otherHrOwn.status, 200);
  assert.equal(((await otherHrOwn.json()) as AbsenceList).capabilities.canViewAll, true);

  const kireevaList = await fetch(`${baseUrl}/api/v1/user-absences?userId=${manager.id}&from=${startDate}&to=${endDate}`, {
    headers: { Cookie: kireevaCookie },
  });
  assert.equal(kireevaList.status, 200);
  const kireevaBody = (await kireevaList.json()) as AbsenceList;
  assert.equal(kireevaBody.capabilities.canViewPrivateReasons, true);
  assert.equal(kireevaBody.items.find((item) => item.id === created.id)?.comment, 'Integration fixture');

  const kireevaEditResponse = await fetch(`${baseUrl}/api/v1/user-absences/${created.id}`, {
    method: 'PATCH',
    headers: { Cookie: kireevaCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment: 'Updated by calendar owner' }),
  });
  assert.equal(kireevaEditResponse.status, 200);
  assert.equal(
    ((await kireevaEditResponse.json()) as { comment: string | null }).comment,
    'Updated by calendar owner',
  );

  for (const cookie of [deputyDirectorCookie, corporateDirectorCookie]) {
    const directorListResponse = await fetch(`${baseUrl}/api/v1/user-absences?userId=${manager.id}&from=${startDate}&to=${endDate}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(directorListResponse.status, 200);
    assert.equal(((await directorListResponse.json()) as AbsenceList).items.find((item) => item.id === created.id)?.comment, null);
    const update = await fetch(`${baseUrl}/api/v1/user-absences/${created.id}`, {
      method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: isoDate(21) }),
    });
    assert.equal(update.status, 404);
    const remove = await fetch(`${baseUrl}/api/v1/user-absences/${created.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
    assert.equal(remove.status, 404);
  }

  const directory = await fetch(`${baseUrl}/api/v1/user-absences/users`, { headers: { Cookie: managerCookie } });
  assert.equal(directory.status, 200);
  const directoryUsers = (await directory.json()) as Array<{ id: string; login: string; fullName: string }>;
  assert.ok(directoryUsers.some((entry) => entry.id === founder.id));
  assert.ok(directoryUsers.some((entry) => entry.id === manager.id));

  const selfCreateResponse = await fetch(`${baseUrl}/api/v1/user-absences`, {
    method: 'POST',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: manager.id, absenceType: 'day_off', startDate: isoDate(35), endDate: isoDate(35), comment: 'Self note' }),
  });
  assert.equal(selfCreateResponse.status, 201);
  const selfCreated = (await selfCreateResponse.json()) as { id: string };

  const directorCommentEdit = await fetch(`${baseUrl}/api/v1/user-absences/${created.id}`, {
    method: 'PATCH',
    headers: { Cookie: deputyDirectorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment: 'Should not overwrite private reason' }),
  });
  assert.equal(directorCommentEdit.status, 404);

  const managerOwnListResponse = await fetch(`${baseUrl}/api/v1/user-absences`, {
    method: 'GET',
    headers: { Cookie: managerCookie },
  });
  assert.equal(managerOwnListResponse.status, 200);

  const deleteResponse = await fetch(`${baseUrl}/api/v1/user-absences/${created.id}`, {
    method: 'DELETE',
    headers: { Cookie: kireevaCookie },
  });
  assert.equal(deleteResponse.status, 200);

  const prisma = new PrismaClient();
  try {
    const deletedRow = await prisma.$queryRaw<Array<{ deletedAt: Date | null; deletedByUserId: string | null }>>`
      SELECT "deletedAt", "deletedByUserId" FROM "user_absences" WHERE "id" = ${created.id}
    `;
    assert.ok(deletedRow[0]?.deletedAt);
    assert.ok(deletedRow[0]?.deletedByUserId);
    const auditRows = await prisma.auditEvent.findMany({
      where: { entityType: 'user_absence', entityId: { in: [created.id, selfCreated.id] } },
      select: { action: true },
    });
    assert.ok(auditRows.some((event) => event.action === 'user_absence.created'));
    assert.ok(auditRows.some((event) => event.action === 'user_absence.updated'));
    assert.ok(auditRows.some((event) => event.action === 'user_absence.deleted'));
  } finally {
    await prisma.$disconnect();
  }
});
