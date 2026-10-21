import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

interface Detail {
  substitutions: Array<{ id: string; status: string; endDate: string | null }>;
  availabilityWindows: Array<{ id: string; endDate: string | null }>;
}

test('substitutions reject double booking and can be completed; availability can be shortened and removed', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const marker = randomUUID();
  const hrCookie = await loginAndGetCookieHeader({ baseUrl, login: 'hr1', password: 'hr123' });
  const [first, second, substitute] = await Promise.all(
    ['А', 'Б', 'В'].map((suffix) => prisma.employee.create({
      data: { fullName: `Подмена ${suffix} ${marker}`, employmentStatus: 'active' },
    })),
  );
  const request = async (path: string, method = 'GET', body?: object) => fetch(`${baseUrl}/api/v1/employees${path}`, {
    method,
    headers: { Cookie: hrCookie, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const created = await request(`/${first!.id}/substitutions`, 'POST', {
    substituteEmployeeId: substitute!.id,
    startDate: '2026-11-02T08:00:00.000Z',
    endDate: '2026-11-06T20:00:00.000Z',
    reason: 'Отпуск',
  });
  assert.equal(created.status, 201, await created.clone().text());

  const busy = await request(`/${second!.id}/substitutions`, 'POST', {
    substituteEmployeeId: substitute!.id,
    startDate: '2026-11-05T08:00:00.000Z',
    reason: 'Больничный',
  });
  assert.equal(busy.status, 409);
  assert.equal(((await busy.json()) as { code?: string }).code, 'SUBSTITUTE_BUSY');

  const window = await request(`/${substitute!.id}/availability`, 'POST', {
    startDate: '2026-11-20',
    endDate: '2026-11-25',
    availabilityMode: 'full_day',
    availabilityStatus: 'unavailable',
  });
  assert.equal(window.status, 201);
  const unavailable = await request(`/${second!.id}/substitutions`, 'POST', {
    substituteEmployeeId: substitute!.id,
    startDate: '2026-11-21T08:00:00.000Z',
    endDate: '2026-11-21T20:00:00.000Z',
    reason: 'Больничный',
  });
  assert.equal(unavailable.status, 409);
  assert.equal(((await unavailable.json()) as { code?: string }).code, 'SUBSTITUTE_UNAVAILABLE');

  const detail = (await created.json()) as Detail;
  const substitutionId = detail.substitutions[0]!.id;
  const completed = await request(`/${first!.id}/substitutions/${substitutionId}`, 'PATCH', { status: 'completed' });
  assert.equal(completed.status, 200);
  assert.equal(((await completed.json()) as Detail).substitutions[0]!.status, 'completed');

  // A finished substitution no longer blocks the substitute.
  const nowFree = await request(`/${second!.id}/substitutions`, 'POST', {
    substituteEmployeeId: substitute!.id,
    startDate: '2026-11-05T08:00:00.000Z',
    endDate: '2026-11-05T20:00:00.000Z',
    reason: 'Больничный',
  });
  assert.equal(nowFree.status, 201);

  const windowId = ((await window.json()) as Detail).availabilityWindows[0]!.id;
  const shortened = await request(`/${substitute!.id}/availability/${windowId}`, 'PATCH', { endDate: '2026-11-22' });
  assert.equal(shortened.status, 200);
  const removed = await request(`/${substitute!.id}/availability/${windowId}`, 'DELETE');
  assert.equal(removed.status, 200);
  assert.equal(((await removed.json()) as Detail).availabilityWindows.length, 0);
  assert.ok(await prisma.auditEvent.findFirst({
    where: { entityId: substitute!.id, action: 'employee.availability.deleted' },
  }));
});
