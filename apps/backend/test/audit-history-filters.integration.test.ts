import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

interface HistoryItem {
  id: string;
  action: string;
  createdAt: string;
  actor: { id: string; login: string; fullName: string } | null;
}

interface HistoryPage {
  items: HistoryItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  facets: {
    actors: Array<{ id: string; login: string; fullName: string }>;
    eventTypes: string[];
    actorsHasMore: boolean;
    eventTypesHasMore: boolean;
  };
}

for (const entityType of ['counterparty', 'one_time_order'] as const) {
  test(`${entityType} history page filters the full scoped history and preserves legacy arrays`, async (t) => {
    assert.equal(usesIsolatedIntegrationDatabase(), true, 'Run through the isolated integration runner');
    const prisma = new PrismaClient();
    const { app, baseUrl } = await createTestApp();
    t.after(async () => {
      await app.close();
      await prisma.$disconnect();
    });
    const marker = `history-${entityType}-${Date.now()}`;
    const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
    const manager = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
    const foreignActor = await prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } });
    const deniedUser = await prisma.user.create({
      data: {
        login: marker,
        fullName: marker,
        passwordHash: manager.passwordHash,
        isActive: true,
      },
    });
    const createEntity = async (suffix: string, assigned: boolean) => {
      if (entityType === 'counterparty') {
        return prisma.counterparty.create({
          data: { name: `${marker}-${suffix}`, createdByUserId: founder.id },
        });
      }
      return prisma.oneTimeOrder.create({
        data: {
          title: `${marker}-${suffix}`,
          executionAddress: 'Москва',
          status: 'new',
          contactName: 'Контакт',
          createdByUserId: founder.id,
          ...(assigned ? { assignments: { create: {
            userId: manager.id,
            assignmentRoleCode: 'one_time_manager',
            isActive: true,
          } } } : {}),
        },
      });
    };
    const entity = await createEntity('visible', true);
    const foreignEntity = await createEntity('foreign', false);
    const updateAction = `${entityType}.updated`;
    const boundaryAction = `${entityType}.created`;
    const foreignAction = `${entityType}.foreign_only`;
    await prisma.auditEvent.createMany({
      data: Array.from({ length: 125 }, () => ({
        entityType,
        entityId: entity.id,
        actorUserId: founder.id,
        action: updateAction,
        createdAt: new Date('2026-11-01T12:00:00.000Z'),
        oldValues: { title: 'old' },
        newValues: { title: 'new' },
        metadata: { source: marker },
      })),
    });
    const boundaryTimes = [
      '2026-10-11T20:59:59.999Z',
      '2026-10-11T21:00:00.000Z',
      '2026-10-12T20:59:59.999Z',
      '2026-10-12T21:00:00.000Z',
    ];
    const boundaryEvents: Array<{ id: string }> = [];
    for (const createdAt of boundaryTimes) {
      boundaryEvents.push(await prisma.auditEvent.create({
        data: {
          entityType,
          entityId: entity.id,
          actorUserId: manager.id,
          action: boundaryAction,
          createdAt: new Date(createdAt),
        },
      }));
    }
    await prisma.auditEvent.createMany({ data: [
      { entityType, entityId: foreignEntity.id, actorUserId: foreignActor.id, action: foreignAction },
      // A matching ID in another audit entity type must never join this history.
      { entityType: 'accountability_funding', entityId: entity.id, actorUserId: foreignActor.id, action: foreignAction },
    ] });

    const cookie = await loginAndGetCookieHeader({ baseUrl, login: manager.login, password: 'manager123' });
    const deniedCookie = await loginAndGetCookieHeader({ baseUrl, login: deniedUser.login, password: 'manager123' });
    const route = entityType === 'counterparty' ? 'counterparties' : 'one-time-orders';
    const request = (query = '', targetId = entity.id, auth = cookie, suffix = 'history-page') =>
      fetch(`${baseUrl}/api/v1/${route}/${targetId}/${suffix}?${query}`, { headers: { Cookie: auth } });
    const page = async (query = ''): Promise<HistoryPage> => {
      const response = await request(query);
      assert.equal(response.status, 200, await response.clone().text());
      return response.json() as Promise<HistoryPage>;
    };

    const first = await page();
    assert.equal(first.total, 129);
    assert.equal(first.page, 1);
    assert.equal(first.limit, 25);
    assert.equal(first.totalPages, 6);
    assert.equal(first.items.length, 25);
    assert.deepEqual((await page()).items.map((event) => event.id), first.items.map((event) => event.id));
    const second = await page('page=2');
    assert.equal(second.items.length, 25);
    assert.ok(second.items.every((event) => !first.items.some((other) => other.id === event.id)));
    const oldest = await page('page=6');
    assert.equal(oldest.items.length, 4);
    assert.deepEqual(new Set(oldest.items.map((event) => event.id)), new Set(boundaryEvents.map((event) => event.id)));

    const legacyResponse = await request('', entity.id, cookie, 'history');
    assert.equal(legacyResponse.status, 200);
    const legacy = await legacyResponse.json() as HistoryItem[];
    assert.ok(Array.isArray(legacy));
    assert.equal(legacy.length, 100);
    assert.deepEqual(Object.keys(first.items[0]!).sort(), Object.keys(legacy[0]!).sort());

    const filtered = await page(`eventType=${boundaryAction}&actorUserId=${manager.id}&dateFrom=2026-10-12&dateTo=2026-10-12&limit=1`);
    assert.equal(filtered.total, 2);
    assert.equal(filtered.totalPages, 2);
    assert.equal(filtered.items[0]?.id, boundaryEvents[2]!.id);
    const filteredSecond = await page(`eventType=${boundaryAction}&actorUserId=${manager.id}&dateFrom=2026-10-12&dateTo=2026-10-12&limit=1&page=2`);
    assert.equal(filteredSecond.items[0]?.id, boundaryEvents[1]!.id);
    assert.equal((await page(`q=${manager.login}`)).total, 4);
    assert.equal((await page('q=CREATED')).total, 4);
    assert.equal((await page(`eventType=${foreignAction}`)).total, 0);
    assert.equal((await page(`actorUserId=${foreignActor.id}`)).total, 0);
    assert.equal((await page('q=no-such-history-event')).total, 0);

    // Options include an author/type older than the first 100 records, not foreign history or the user directory.
    assert.deepEqual(new Set(first.facets.actors.map((actor) => actor.id)), new Set([founder.id, manager.id]));
    assert.deepEqual(first.facets.eventTypes, [boundaryAction, updateAction]);
    assert.equal(first.facets.actorsHasMore, false);
    assert.equal(first.facets.eventTypesHasMore, false);
    const actorOptions = await page(`actorSearch=${manager.login}&eventType=${updateAction}`);
    assert.deepEqual(actorOptions.facets.actors.map((actor) => actor.id), [manager.id]);
    const foreignOptions = await page(`actorSearch=${foreignActor.login}`);
    assert.deepEqual(foreignOptions.facets.actors, []);

    const denied = await request('', entity.id, deniedCookie);
    assert.equal(denied.status, entityType === 'counterparty' ? 403 : 404);
    const deniedForeign = await request('', foreignEntity.id, deniedCookie);
    assert.equal(deniedForeign.status, entityType === 'counterparty' ? 403 : 404);
    if (entityType === 'one_time_order') {
      assert.equal((await request('', foreignEntity.id)).status, 404);
    }
    for (const query of ['limit=101', 'page=0', 'actorUserId=invalid', 'dateFrom=2026-02-30', 'dateFrom=2026-10-13&dateTo=2026-10-12']) {
      assert.equal((await request(query)).status, 400, query);
    }
  });
}
