import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { GlobalSearchItemDto, GlobalSearchResponseDto } from '../src/modules/search/dto/global-search-response.dto';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Ref = Pick<GlobalSearchItemDto, 'type' | 'id'>;
type Fixture = {
  label: 'A' | 'B';
  object: { id: string; name: string };
  order: { id: string; title: string };
  task: { id: string; title: string };
  objectTask: { id: string; title: string };
  orderTask: { id: string; title: string };
  candidate: { id: string; fullName: string; phone: string | null };
};

test('search query/recent grants never widen source visibility or leak denied ancestors in an existing session', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(databaseUrl.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname));
  assert.equal(databaseUrl.port, '55432');
  assert.match(databaseUrl.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => {
    try { await closeApp?.(); } finally { await prisma.$disconnect(); }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const actorQuery = { where: { login: 'manager1' }, include: {
    roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    permissions: { include: { permission: true } },
  } } as const;
  const actor = await prisma.user.findUniqueOrThrow(actorQuery);
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  assert.deepEqual(actor.roles.map(({ role }) => role.code), ['manager']);
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id } }), 0);
  const permissions = [...actor.permissions.map(({ permission }) => permission.code),
    ...actor.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code))];
  assert.equal(permissions.includes('candidates.view'), true);
  const marker = `acl-search-${randomUUID()}`;
  const privateField = `private-field-${randomUUID()}`;
  const reader = await prisma.user.create({ data: {
    login: marker, fullName: marker, passwordHash: actor.passwordHash, isActive: true,
  }, include: { roles: true, permissions: true } });
  // One login each: neither subject refreshes its cookie as rules change.
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const readerCookie = await loginAndGetCookieHeader({ baseUrl, login: reader.login, password: 'manager123' });
  const fixtures: Fixture[] = [];
  const rankedAt = { A: new Date(Date.now() + 60000), B: new Date(Date.now() - 60000) };
  // A's three tasks are newest. With limit=1, filtering AFTER the candidate
  // take would starve older allowed B tasks; source denies must run in SQL.
  for (const label of ['B', 'A'] as const) {
    const object = await prisma.object.create({ data: {
      name: `${marker}-object-${label}`, address: `${marker}-address-${label}`, status: 'active',
      notes: privateField, createdByUserId: founder.id,
      assignments: { create: { userId: actor.id, assignmentRoleCode: 'manager', isActive: true } },
    } });
    const order = await prisma.oneTimeOrder.create({ data: {
      title: `${marker}-order-${label}`, executionAddress: `${marker}-order-address-${label}`, status: 'planned',
      contactName: 'Search fixture', financialNotes: privateField, createdByUserId: founder.id,
      assignments: { create: { userId: actor.id, assignmentRoleCode: 'one_time_manager', isActive: true } },
    } });
    const tasks: Array<{ id: string; title: string }> = [];
    for (const kind of ['standalone', 'object', 'order'] as const) tasks.push(await prisma.task.create({ data: {
      title: `${marker}-${kind}-task-${label}`, description: privateField,
      updatedAt: rankedAt[label],
      priority: 'normal', status: 'open', visibilityType: 'private', createdByUserId: founder.id,
      scopeType: kind === 'standalone' ? 'personal' : kind === 'order' ? 'one_time_order' : 'object',
      objectId: kind === 'object' ? object.id : null, oneTimeOrderId: kind === 'order' ? order.id : null,
      assignees: { create: { userId: actor.id, isActive: true } },
    } }));
    const candidate = await prisma.candidate.create({ data: {
      fullName: `${marker}-candidate-${label}`, phone: label === 'A' ? '+79001112233' : '+79004445566',
      comment: privateField, createdByUserId: founder.id,
    } });
    fixtures.push({ label, object, order, task: tasks[0], objectTask: tasks[1], orderTask: tasks[2], candidate });
  }
  const a = fixtures.find(({ label }) => label === 'A')!;
  const b = fixtures.find(({ label }) => label === 'B')!;
  const refs = (fixture: Fixture): Ref[] => [
    { type: 'object', id: fixture.object.id }, { type: 'one_time_order', id: fixture.order.id },
    ...[fixture.task, fixture.objectTask, fixture.orderTask].map(({ id }): Ref => ({ type: 'task', id })),
    { type: 'candidate', id: fixture.candidate.id },
  ];
  const allRefs = [...refs(a), ...refs(b)];
  const coreRefs = [
    ...[a, b].map((row): Ref => ({ type: 'object', id: row.object.id })),
    ...[a, b].map((row): Ref => ({ type: 'one_time_order', id: row.order.id })),
    ...[a, b].map((row): Ref => ({ type: 'task', id: row.task.id })),
    ...[a, b].map((row): Ref => ({ type: 'candidate', id: row.candidate.id })),
  ];
  const linkedRefs: Ref[] = [
    { type: 'object', id: a.object.id }, { type: 'object', id: b.object.id },
    { type: 'task', id: a.objectTask.id }, { type: 'task', id: b.objectTask.id },
    { type: 'one_time_order', id: a.order.id }, { type: 'one_time_order', id: b.order.id },
    { type: 'task', id: a.orderTask.id }, { type: 'task', id: b.orderTask.id },
  ];
  const key = (ref: Ref) => `${ref.type}:${ref.id}`;
  const taskIds = allRefs.filter(({ type }) => type === 'task').map(({ id }) => id);
  const capture = async () => {
    const [objects, orders, tasks, candidates, history, audit] = await Promise.all([
      prisma.object.findMany({ where: { id: { in: fixtures.map(({ object }) => object.id) } }, include: { assignments: true }, orderBy: { id: 'asc' } }),
      prisma.oneTimeOrder.findMany({ where: { id: { in: fixtures.map(({ order }) => order.id) } }, include: { assignments: true }, orderBy: { id: 'asc' } }),
      prisma.task.findMany({ where: { id: { in: taskIds } }, include: { assignees: true, visibilityUsers: true }, orderBy: { id: 'asc' } }),
      prisma.candidate.findMany({ where: { id: { in: fixtures.map(({ candidate }) => candidate.id) } }, include: { assignments: true, responses: true }, orderBy: { id: 'asc' } }),
      prisma.taskHistoryEvent.findMany({ where: { taskId: { in: taskIds } }, orderBy: { id: 'asc' } }),
      prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    ]);
    return { objects, orders, tasks, candidates, history, audit };
  };
  const pristine = await capture();
  const noEffects = async () => assert.deepEqual(await capture(), pristine, 'Search/recent never change source records, assignments, counts, history or audit');
  const ruleIds = new Set<string>();
  const rule = async (userId: string, actionCode: string, effect: 'allow' | 'deny', selectedIds?: string[]) => {
    const saved = await prisma.userAccessRule.create({ data: {
      userId, actionCode, effect, scope: selectedIds ? 'selected' : 'all', selectedIds: selectedIds ?? [],
    } });
    ruleIds.add(saved.id);
    return saved;
  };
  const removeRule = async (id: string) => { await prisma.userAccessRule.delete({ where: { id } }); ruleIds.delete(id); };
  const resetRules = async () => { for (const id of [...ruleIds]) await removeRule(id); };
  const request = (auth: string, recent?: Ref[], limit = 8, term = marker) => fetch(
    `${baseUrl}/api/v1/search${recent ? '/recent' : `?${new URLSearchParams({ q: term, limit: String(limit) })}`}`, {
      method: recent ? 'POST' : 'GET', headers: { Cookie: auth, 'Content-Type': 'application/json' },
      ...(recent ? { body: JSON.stringify({ refs: recent }) } : {}),
    },
  );
  const status = async (response: Response, expected: number) => { assert.equal(response.status, expected, await response.clone().text()); };
  const safeShape = (items: GlobalSearchItemDto[]) => {
    for (const item of items) assert.deepEqual(Object.keys(item).sort(), ['description', 'href', 'id', 'label', 'type']);
    assert.equal(JSON.stringify(items).includes(privateField), false, 'Private notes/financial fields are never search DTO fields');
  };
  const visible = async (auth: string, allowed: Ref[]) => {
    const allowedKeys = new Set(allowed.map(key));
    const hidden = fixtures.flatMap((fixture) => [
      { type: 'object', id: fixture.object.id, label: fixture.object.name },
      { type: 'one_time_order', id: fixture.order.id, label: fixture.order.title },
      ...[fixture.task, fixture.objectTask, fixture.orderTask].map(({ id, title }) => ({ type: 'task', id, label: title })),
      { type: 'candidate', id: fixture.candidate.id, label: fixture.candidate.fullName },
    ]).filter((item) => !allowedKeys.has(`${item.type}:${item.id}`));
    const privateResponse = (items: GlobalSearchItemDto[]) => {
      safeShape(items);
      const json = JSON.stringify(items);
      for (const item of hidden) {
        assert.equal(json.includes(item.id), false, 'Hidden IDs/hrefs must not occur in any response field');
        assert.equal(json.includes(item.label), false, 'Hidden names must not leak through related descriptions');
      }
    };
    const response = await request(auth);
    await status(response, 200);
    const body = await response.json() as GlobalSearchResponseDto;
    assert.equal(body.query, marker); // Input echo is public; privacy concerns items.
    privateResponse(body.items);
    assert.equal(body.items.length, allowed.length);
    assert.deepEqual(new Set(body.items.map(key)), allowedKeys);
    for (const type of ['object', 'one_time_order', 'task', 'candidate'])
      assert.equal(body.items.filter((row) => row.type === type).length, allowed.filter((row) => row.type === type).length);
    for (const recentRefs of [coreRefs, linkedRefs]) {
      const recent = await request(auth, recentRefs);
      await status(recent, 200);
      const items = await recent.json() as GlobalSearchItemDto[];
      privateResponse(items);
      assert.deepEqual(items.map(key), recentRefs.filter((ref) => allowedKeys.has(key(ref))).map(key), 'Recent preserves client order while omitting every forbidden ref');
    }
    await noEffects();
    return body.items;
  };
  const forbidden = async (auth: string, recent?: Ref[]) => {
    await status(await request(auth, recent), 403);
    await noEffects();
  };

  await t.test('search.query/recent/access: independent deny, explicit allow, default/revoke and root gate use the original cookie', async (suite) => {
    suite.after(resetRules);
    await visible(cookie, allRefs);
    for (const actionCode of ['search.query', 'search.recent']) {
      const grant = await rule(actor.id, actionCode, 'allow');
      await visible(cookie, allRefs);
      await prisma.userAccessRule.update({ where: { id: grant.id }, data: { effect: 'deny' } });
      if (actionCode === 'search.query') {
        await forbidden(cookie);
        await status(await request(cookie, coreRefs), 200);
      } else {
        await forbidden(cookie, coreRefs);
        await forbidden(cookie, []); // Empty refs do not bypass the recent gate.
        await status(await request(cookie), 200);
      }
      await removeRule(grant.id); // Return to the existing default permission.
      await visible(cookie, allRefs);
    }
    await rule(actor.id, 'search.query', 'allow');
    await rule(actor.id, 'search.recent', 'allow');
    const parent = await rule(actor.id, 'search.access', 'deny');
    await forbidden(cookie);
    await forbidden(cookie, coreRefs);
    await removeRule(parent.id);
    await visible(cookie, allRefs);
  });

  await t.test('search grants alone reveal no sources; selected source grants add A only and revoke live without role expansion', async (suite) => {
    suite.after(resetRules);
    await rule(reader.id, 'search.query', 'allow');
    await rule(reader.id, 'search.recent', 'allow');
    await visible(readerCookie, []);
    const grants = await Promise.all([
      rule(reader.id, 'objects.read', 'allow', [a.object.id]),
      rule(reader.id, 'one_time_orders.read', 'allow', [a.order.id]),
      rule(reader.id, 'tasks.read', 'allow', [a.task.id, a.objectTask.id, a.orderTask.id]),
      rule(reader.id, 'candidates.view', 'allow', [a.candidate.id]),
    ]);
    await visible(readerCookie, refs(a));
    await removeRule(grants[2].id);
    await visible(readerCookie, refs(a).filter(({ type }) => type !== 'task'));
    const restoredTasks = await rule(reader.id, 'tasks.read', 'allow', [a.task.id, a.objectTask.id, a.orderTask.id]);
    await visible(readerCookie, refs(a));
    await removeRule(grants[1].id);
    // Order tasks require the source order's positive visibility as well.
    await visible(readerCookie, refs(a).filter(({ id }) => ![a.order.id, a.orderTask.id].includes(id)));
    const restoredOrder = await rule(reader.id, 'one_time_orders.read', 'allow', [a.order.id]);
    await visible(readerCookie, refs(a));
    for (const id of [grants[0].id, grants[3].id, restoredTasks.id, restoredOrder.id]) await removeRule(id);
    await visible(readerCookie, []);
  });

  const categories = [
    { leaf: 'objects.read', parent: 'objects.access', ids: [a.object.id], hidden: [a.object.id, a.objectTask.id] },
    { leaf: 'one_time_orders.read', parent: 'one_time_orders.access', ids: [a.order.id], hidden: [a.order.id, a.orderTask.id] },
    { leaf: 'tasks.read', parent: 'tasks.access', ids: [a.task.id, a.objectTask.id, a.orderTask.id], hidden: [a.task.id, a.objectTask.id, a.orderTask.id] },
    { leaf: 'candidates.view', parent: 'candidates.access', ids: [a.candidate.id], hidden: [a.candidate.id] },
  ];
  for (const category of categories) {
    await t.test(`${category.leaf} and ${category.parent}: explicit A denies remove results and linked descriptions while B stays visible`, async (suite) => {
      suite.after(resetRules);
      await rule(actor.id, 'search.query', 'allow');
      await rule(actor.id, 'search.recent', 'allow');
      await visible(cookie, allRefs);
      const allowed = allRefs.filter(({ id }) => !category.hidden.includes(id));
      for (const actionCode of [category.leaf, category.parent]) {
        const deny = await rule(actor.id, actionCode, 'deny', category.ids);
        // A direct source allow cannot override its explicit section deny.
        const childGrant = actionCode === category.parent ? await rule(actor.id, category.leaf, 'allow', category.ids) : undefined;
        const items = await visible(cookie, allowed);
        const json = JSON.stringify(items);
        for (const id of category.hidden) assert.equal(json.includes(id), false, 'No hidden IDs/hrefs survive in returned items');
        for (const fixture of [a]) {
          const labels = [fixture.object.name, fixture.order.title, fixture.task.title, fixture.objectTask.title, fixture.orderTask.title, fixture.candidate.fullName];
          const ids = refs(fixture).map(({ id }) => id);
          for (const [index, id] of ids.entries()) if (category.hidden.includes(id)) assert.equal(json.includes(labels[index]), false, 'No hidden label or parent name survives in another description');
        }
        await removeRule(deny.id);
        if (childGrant) await removeRule(childGrant.id);
        await visible(cookie, allRefs); // Default is restored in the same session.
      }
    });
  }

  await t.test('source filtering precedes per-type limits; stale/forged recent refs cannot recover denied A or affect counts', async (suite) => {
    suite.after(resetRules);
    for (const category of categories) await rule(actor.id, category.parent, 'deny', category.ids);
    await visible(cookie, refs(b));
    const response = await request(cookie, undefined, 1);
    await status(response, 200);
    const body = await response.json() as GlobalSearchResponseDto;
    safeShape(body.items);
    assert.equal(body.items.length, 4, 'limit is per type, not a global total');
    for (const type of ['object', 'one_time_order', 'task', 'candidate']) assert.equal(body.items.filter((row) => row.type === type).length, 1);
    const bKeys = new Set(refs(b).map(key));
    assert.ok(body.items.every((item) => bKeys.has(key(item))));
    const recent = await request(cookie, [
      { type: 'candidate', id: a.object.id }, { type: 'task', id: randomUUID() },
      { type: 'object', id: a.object.id }, { type: 'object', id: b.object.id },
    ]);
    await status(recent, 200);
    assert.deepEqual((await recent.json() as GlobalSearchItemDto[]).map(key), [key({ type: 'object', id: b.object.id })]);
    await noEffects();
  });
  assert.deepEqual(await prisma.user.findUniqueOrThrow(actorQuery), actor);
  assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: reader.id }, include: { roles: true, permissions: true } }), reader);
  // Main runs this file serially and drops the local isolated schema.
});
