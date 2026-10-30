import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('object creation commits setup, contacts and positions together without exposing commercial terms', { timeout: 120_000 }, async (t) => {
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true');
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => { await app.close(); await prisma.$disconnect(); });
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' });
  const managerCookie = await loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const manager = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const name = `Создание целиком ${randomUUID()}`;
  const request = (cookie: string, path: string, method = 'GET', payload?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: cookie, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  const created = await request(founderCookie, '/objects', 'POST', {
    name, address: 'Локальная проверка, 10', status: 'active', paymentType: 'daily', dailyRate: 1500,
    managerUserIds: [manager.id],
    setup: { legalName: 'ООО Тестовое название договора', areaSqM: 4200, contractStartsOn: today, contractEndsOn: null, contractMonthlyAmount: 600000 },
    contacts: [{ name: 'Контакт клиента', emails: ['object-test@example.invalid'], phones: ['+79990000000'] }],
    payContours: [{ code: 'day', name: 'Дневной выход', dailyRate: 2500, summerDailyRate: 2600, winterDailyRate: null }],
    staffingPositions: [{
      clientKey: randomUUID(), name: 'Произвольное имя позиции', headcount: null, effectiveFrom: today,
      requiredPerShift: 1,
      template: { kind: 'cycle', anchorDate: today, sequence: [true, true, false, false] },
      groups: [0, 2].map((offsetDays, index) => ({
        key: `group-${index}`, name: `Группа ${index + 1}`, offsetDays,
        timeRanges: [{ key: 'day', start: '09:00', end: '17:00', endDayOffset: 0, contourId: 'draft:day' }], assignments: [],
      })),
    }],
  });
  const text = await created.text();
  assert.equal(created.status, 201, text);
  const object = JSON.parse(text) as { id: string; responsible: { id: string } };
  assert.equal(object.responsible.id, founder.id);
  const setupResponse = await request(founderCookie, `/objects/${object.id}/setup`);
  assert.equal(setupResponse.status, 200);
  const setup = await setupResponse.json() as { data: { contractMonthlyAmount: number; legalName: string; contractEndsOn: null }; version: number };
  assert.equal(setup.data.contractMonthlyAmount, 600000);
  assert.equal(setup.data.legalName, 'ООО Тестовое название договора');
  assert.equal(setup.data.contractEndsOn, null);
  assert.equal(setup.version, 1);
  const contacts = await (await request(founderCookie, `/objects/${object.id}/contacts`)).json() as Array<{ name: string }>;
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].name, 'Контакт клиента');
  const positions = await (await request(founderCookie, `/objects/${object.id}/scheduling/positions`)).json() as { positions: Array<{ revisions: Array<{ headcount: number | null; name: string }> }> };
  assert.equal(positions.positions.length, 1);
  assert.equal(positions.positions[0].revisions[0].headcount, null);
  assert.equal(positions.positions[0].revisions[0].name, 'Произвольное имя позиции');
  const contours = await (await request(founderCookie, `/objects/${object.id}/scheduling/contours`)).json() as { contours: Array<{ id: string; code: string }> };
  assert.equal(contours.contours.length, 1);
  assert.equal(contours.contours[0].code, 'day');
  const managerSetup = await request(managerCookie, `/objects/${object.id}/setup`);
  const managerText = await managerSetup.text();
  assert.equal(managerSetup.status, 200, managerText);
  assert.equal(JSON.parse(managerText).data.contractMonthlyAmount, null);
  assert.equal(managerText.includes('600000'), false);
  const historyResponse = await request(managerCookie, `/objects/${object.id}/audit`);
  const historyText = await historyResponse.text();
  assert.equal(historyResponse.status, 200, historyText);
  assert.equal(historyText.includes('600000'), false);
  const deniedPatch = await request(managerCookie, `/objects/${object.id}/setup`, 'PATCH', { expectedVersion: 1, contractMonthlyAmount: 1 });
  assert.equal(deniedPatch.status, 403, await deniedPatch.text());
  const edit = await request(founderCookie, `/objects/${object.id}/setup`, 'PATCH', { expectedVersion: 1, areaSqM: 4300 });
  assert.equal(edit.status, 200, await edit.clone().text());
  const afterEdit = await edit.json() as { version: number; data: { contractMonthlyAmount: number; areaSqM: number } };
  assert.equal(afterEdit.version, 2);
  assert.equal(afterEdit.data.contractMonthlyAmount, 600000);
  assert.equal(afterEdit.data.areaSqM, 4300);
  const stale = await request(founderCookie, `/objects/${object.id}/setup`, 'PATCH', { expectedVersion: 1, areaSqM: 1 });
  assert.equal(stale.status, 409, await stale.text());
  const updates = await Promise.all([4400, 4500].map((areaSqM) => request(founderCookie, `/objects/${object.id}/setup`, 'PATCH', { expectedVersion: 2, areaSqM })));
  assert.deepEqual(updates.map((response) => response.status).sort(), [200, 409]);
  const privateAudit = await prisma.auditEvent.findFirst({ where: { entityType: 'object_setup', entityId: object.id, action: 'object.setup.created' } });
  assert.equal((privateAudit?.newValues as { contractMonthlyAmount: number }).contractMonthlyAmount, 600000);
  const counterparty = await prisma.object.findUniqueOrThrow({ where: { id: object.id }, select: { counterpartyId: true } });
  assert.equal(counterparty.counterpartyId, null);

  const badName = `Rollback ${randomUUID()}`;
  const invalid = await request(founderCookie, '/objects', 'POST', {
    name: badName, address: 'Локальная проверка', status: 'active',
    setup: { salesResponsibleUserId: randomUUID() },
    contacts: [{ name: 'Этот контакт не должен сохраниться' }],
  });
  assert.equal(invalid.status, 400, await invalid.text());
  assert.equal(await prisma.object.count({ where: { name: badName } }), 0);

  await t.test('seasonality initializes atomically and selects the configured annual profile', async () => {
    const automatic = await request(founderCookie, '/objects', 'POST', {
      name: `Автосезон ${randomUUID()}`, address: 'Проверка сезонов, 1', status: 'active',
      dailyRate: 1000, summerDailyRate: 2000, winterDailyRate: 3000,
      planning: { automaticSeasons: true, summerStartsOn: '04-01', winterStartsOn: '10-01' },
    });
    assert.equal(automatic.status, 201, await automatic.clone().text());
    const { id } = await automatic.json() as { id: string };
    const stored = await prisma.object.findUniqueOrThrow({ where: { id } });
    const day = today.slice(5);
    const summer = day >= '04-01' && day < '10-01';
    assert.equal(stored.seasonMode, summer ? 'summer' : 'winter');
    assert.equal(stored.dailyRate, summer ? 2000 : 3000);
    assert.equal((await prisma.objectPlanningSettings.findUniqueOrThrow({ where: { objectId: id } })).automaticSeasons, true);
    const base = await request(founderCookie, '/objects', 'POST', {
      name: `Без сезонов ${randomUUID()}`, address: 'Проверка сезонов, 2', status: 'active',
      dailyRate: 1000, summerDailyRate: 2000, winterDailyRate: 3000,
      planning: { automaticSeasons: false },
    });
    assert.equal(base.status, 201, await base.clone().text());
    const baseObject = await base.json() as { id: string };
    const baseStored = await prisma.object.findUniqueOrThrow({ where: { id: baseObject.id } });
    assert.equal(baseStored.seasonMode, null);
    assert.equal(baseStored.dailyRate, 1000);
    const invalidName = `Без границ ${randomUUID()}`;
    const missingDates = await request(founderCookie, '/objects', 'POST', {
      name: invalidName, address: 'Проверка сезонов, 3', status: 'active', planning: { automaticSeasons: true },
    });
    assert.equal(missingDates.status, 400);
    assert.equal(await prisma.object.count({ where: { name: invalidName } }), 0);
  });
});
