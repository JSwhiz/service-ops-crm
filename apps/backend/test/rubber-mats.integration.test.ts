import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { cleanupCoreTestObject, createCoreTestObject } from './helpers/core-fixtures';
import { createTestApp } from './helpers/create-test-app';

test('rubber mats are object-scoped tracked assets with a retained movement and service history', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const [source, target, privateObject] = await Promise.all([
    createCoreTestObject(prisma, { includeManagerAssignment: true }),
    createCoreTestObject(prisma, { includeManagerAssignment: true }),
    createCoreTestObject(prisma),
  ]);
  const [founderCookie, managerCookie, outsiderCookie] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'manager2', password: 'manager123' }),
  ]);
  const matIds: string[] = [];
  const inventoryCode = `mat-${Date.now()}`;

  t.after(async () => {
    if (matIds.length) {
      await prisma.rubberMatEvent.deleteMany({ where: { rubberMatId: { in: matIds } } });
      await prisma.rubberMat.deleteMany({ where: { id: { in: matIds } } });
    }
    await Promise.all([
      cleanupCoreTestObject(prisma, source.objectId),
      cleanupCoreTestObject(prisma, target.objectId),
      cleanupCoreTestObject(prisma, privateObject.objectId),
    ]);
    await app.close();
    await prisma.$disconnect();
  });

  const request = (objectId: string, method: string, path = '', body?: Record<string, unknown>, cookie = managerCookie) =>
    fetch(`${baseUrl}/api/v1/objects/${objectId}/rubber-mats${path}`, {
      method,
      headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  const registryRequest = (cookie: string, query = '') => fetch(`${baseUrl}/api/v1/rubber-mats${query}`, {
    headers: { Cookie: cookie },
  });
  const availableRequest = (objectId: string, cookie = managerCookie) => fetch(`${baseUrl}/api/v1/rubber-mats/available/${objectId}`, { headers: { Cookie: cookie } });
  const registerResponse = await fetch(`${baseUrl}/api/v1/rubber-mats`, {
    method: 'POST',
    headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lengthCm: 120,
      widthCm: 80,
      thicknessMm: 8,
      inventoryCode,
      note: 'Первичная инвентаризация',
    }),
  });
  assert.equal(registerResponse.status, 201);
  const created = await registerResponse.json() as { id: string; condition: string; objectId: string | null };
  matIds.push(created.id);
  const matId = created.id;
  assert.equal(created.condition, 'good');
  assert.equal(created.objectId, null);
  const stockRegistry = await (await registryRequest(founderCookie, `?q=${encodeURIComponent(inventoryCode)}`)).json() as { items: Array<{ id: string; object: null }> };
  assert.equal(stockRegistry.items[0]?.object, null);
  assert.equal((await availableRequest(source.objectId)).status, 200);
  const available = await (await availableRequest(source.objectId)).json() as Array<{ id: string }>;
  assert.ok(available.some((item) => item.id === matId));
  assert.equal((await fetch(`${baseUrl}/api/v1/rubber-mats`, {
    method: 'POST', headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ lengthCm: 100, widthCm: 100, note: 'Не должно пройти' }),
  })).status, 403);
  assert.equal((await request(source.objectId, 'POST', `/${matId}/assign`, {
    zone: 'Вход', note: 'Назначен на объект',
  })).status, 201);

  const registryResponse = await registryRequest(managerCookie, `?q=${encodeURIComponent(inventoryCode)}&objectId=${source.objectId}`);
  assert.equal(registryResponse.status, 200);
  const registry = await registryResponse.json() as { items: Array<{ id: string; object: { id: string } | null }>; total: number };
  assert.equal(registry.total, 1);
  assert.equal(registry.items[0]?.id, matId);
  assert.equal(registry.items[0]?.object?.id, source.objectId);
  const privateRegistry = await (await registryRequest(outsiderCookie, `?q=${encodeURIComponent(inventoryCode)}`)).json() as { items: unknown[]; total: number };
  assert.equal(privateRegistry.total, 0);
  assert.equal(privateRegistry.items.length, 0);

  assert.equal((await request(privateObject.objectId, 'GET')).status, 403);
  assert.equal((await request(source.objectId, 'GET', '', undefined, outsiderCookie)).status, 403);
  assert.equal((await request(source.objectId, 'POST', `/${matId}/move`, {
    targetObjectId: privateObject.objectId,
    zone: 'Коридор',
    note: 'Несанкционированное перемещение',
  })).status, 403);

  const serviced = await request(source.objectId, 'POST', `/${matId}/service`, { note: 'Промыт и высушен' });
  assert.equal(serviced.status, 201);
  const changed = await request(source.objectId, 'PATCH', `/${matId}`, {
    condition: 'worn',
    note: 'Поверхность заметно истёрлась',
  });
  assert.equal(changed.status, 200);

  const moved = await request(source.objectId, 'POST', `/${matId}/move`, {
    targetObjectId: target.objectId,
    zone: 'Служебный вход',
    note: 'Перенесён при изменении распределения зон',
  });
  assert.equal(moved.status, 201);
  assert.equal((await request(source.objectId, 'GET')).status, 200);
  const sourceItems = await (await request(source.objectId, 'GET')).json() as Array<{ id: string }>;
  assert.equal(sourceItems.some((item) => item.id === matId), false);
  const targetItems = await (await request(target.objectId, 'GET')).json() as Array<{ id: string; condition: string; zone: string }>;
  assert.equal(targetItems.filter((item) => item.id === matId).length, 1);
  assert.equal(targetItems.find((item) => item.id === matId)?.condition, 'worn');
  assert.equal(targetItems.find((item) => item.id === matId)?.zone, 'Служебный вход');

  assert.equal((await request(target.objectId, 'POST', `/${matId}/return-to-stock`, { note: 'Замена ковра на объекте' })).status, 201);
  const stock = await (await registryRequest(founderCookie, `?q=${encodeURIComponent(inventoryCode)}`)).json() as { items: Array<{ id: string; object: null }> };
  assert.equal(stock.items[0]?.id, matId);
  assert.equal((await request(target.objectId, 'POST', `/${matId}/assign`, { zone: 'Новая входная группа', note: 'Повторно выдан на объект' })).status, 201);

  const history = await (await request(target.objectId, 'GET', `/${matId}/history`)).json() as Array<{ action: string; note: string }>;
  assert.deepEqual(history.map((event) => event.action).sort(), ['assigned', 'moved', 'registered', 'returned_to_stock'].sort());
  assert.ok(history.every((event) => !['Поверхность заметно истёрлась', 'Промыт и высушен'].includes(event.note)));
  const sourceHistoryResponse = await request(source.objectId, 'GET', `/${matId}/history`);
  assert.equal(sourceHistoryResponse.status, 200);
  const sourceHistory = await sourceHistoryResponse.json() as Array<{ action: string; note: string; fromObjectId: string | null; toObjectId: string | null }>;
  assert.ok(sourceHistory.some((event) => event.action === 'assigned'));
  assert.ok(sourceHistory.some((event) => event.action === 'condition_changed'));
  assert.ok(sourceHistory.some((event) => event.action === 'serviced'));
  assert.ok(sourceHistory.some((event) => event.note === 'Поверхность заметно истёрлась'));
  assert.ok(sourceHistory.every((event) => event.fromObjectId === null || event.fromObjectId === source.objectId));
  assert.ok(sourceHistory.every((event) => event.toObjectId === null || event.toObjectId === source.objectId));

  assert.equal((await request(target.objectId, 'PATCH', `/${matId}`, {
    condition: 'retired', note: 'Ковёр окончательно изношен',
  })).status, 200);
  assert.equal((await request(target.objectId, 'POST', `/${matId}/return-to-stock`, {
    note: 'Нельзя вернуть списанный актив',
  })).status, 400);
  assert.equal((await request(source.objectId, 'POST', `/${matId}/assign`, {
    zone: 'Вход', note: 'Нельзя повторно назначить списанный актив',
  })).status, 400);
});
