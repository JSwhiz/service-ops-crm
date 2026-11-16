import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { SpecificationCatalogItemResponseDto, SpecificationTemplateResponseDto } from '../src/modules/one-time-orders/dto/specification-catalog.dto';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

// All five codes are global and policy_decision_required. Do not manufacture
// unsupported selected/allow rules in Prisma to bypass the real admin boundary.
test('specification catalog preserves its constrained policy and real item/template HTTP lifecycle', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const database = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname));
  assert.match(database.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const actions = ACCESS_ACTION_CATALOG.filter((entry) => entry.module === 'specification_catalog');
  assert.deepEqual(actions.map((entry) => entry.code).sort(), ['access', 'read', 'create', 'update', 'archive'].map((suffix) => `specification_catalog.${suffix}`).sort());
  for (const action of actions) {
    assert.equal(action.manageable, false);
    assert.equal(action.constraint, 'policy_decision_required');
    assert.deepEqual(action.allowedScopes, ['all']);
    assert.equal(action.parentAction, action.code === 'specification_catalog.access' ? undefined : 'specification_catalog.access');
  }

  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => { try { await closeApp?.(); } finally { await prisma.$disconnect(); } });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const users = new Map<string, string>();
  const cookies = new Map<string, string>();
  for (const [login, password] of [['founder', 'founder123'], ['manager1', 'manager123'], ['deputy1', 'deputy123']]) {
    users.set(login, (await prisma.user.findUniqueOrThrow({ where: { login } })).id);
    cookies.set(login, await loginAndGetCookieHeader({ baseUrl, login, password }));
  }
  const founderId = users.get('founder')!;
  const managerId = users.get('manager1')!;
  const userIds = [...users.values()];
  assert.equal(await prisma.userAccessRule.count({ where: { userId: { in: userIds } } }), 0);
  const marker = `acl-spec-catalog-${randomUUID()}`;
  const catalogPath = '/one-time-orders/specification-catalog';
  const templatesPath = '/one-time-orders/specification-templates';
  const adminPath = `/users-access/admin/users/${managerId}`;
  const request = (login: string, path: string, method = 'GET', body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: cookies.get(login)!, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, status: number): Promise<T> => {
    const text = await response.text();
    assert.equal(response.status, status, text);
    return JSON.parse(text) as T;
  };
  const domain = async () => {
    const [items, templates, audits, orders, snapshots, attachments] = await Promise.all([
      prisma.oneTimeOrderSpecificationCatalogItem.findMany({ orderBy: { id: 'asc' } }),
      prisma.oneTimeOrderSpecificationTemplate.findMany({ orderBy: { id: 'asc' }, include: { items: { orderBy: [{ sortOrder: 'asc' }, { catalogItemId: 'asc' }] } } }),
      prisma.auditEvent.findMany({ where: { entityType: { in: ['one_time_order_specification_catalog', 'one_time_order'] } }, orderBy: { id: 'asc' } }),
      prisma.oneTimeOrder.findMany({ where: { title: { startsWith: marker } }, orderBy: { id: 'asc' } }),
      prisma.oneTimeOrderSpecificationItem.findMany({ orderBy: { id: 'asc' } }),
      prisma.fileAttachment.findMany({ where: { entityType: { in: ['one_time_order', 'one_time_order_specification_item'] } }, orderBy: { id: 'asc' } }),
    ]);
    return { items, templates, audits, orders, snapshots, attachments };
  };
  const accessState = async () => {
    const [identities, roles, permissions, rules, audits, previews, objectAssignments, orderAssignments] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: userIds } }, orderBy: { id: 'asc' }, select: { id: true, accessVersion: true, isActive: true } }),
      prisma.userRole.findMany({ where: { userId: { in: userIds } }, orderBy: [{ userId: 'asc' }, { roleId: 'asc' }] }),
      prisma.userPermission.findMany({ where: { userId: { in: userIds } }, orderBy: [{ userId: 'asc' }, { permissionId: 'asc' }] }),
      prisma.userAccessRule.findMany({ where: { userId: { in: userIds } }, orderBy: [{ userId: 'asc' }, { actionCode: 'asc' }] }),
      prisma.userAccessAudit.findMany({ where: { userId: { in: userIds } }, orderBy: { id: 'asc' } }),
      prisma.userAccessPreview.findMany({ where: { userId: { in: userIds } }, orderBy: { id: 'asc' } }),
      prisma.objectAssignment.findMany({ where: { userId: { in: userIds } }, orderBy: { id: 'asc' } }),
      prisma.oneTimeOrderAssignment.findMany({ where: { userId: { in: userIds } }, orderBy: { id: 'asc' } }),
    ]);
    return { identities, roles, permissions, rules, audits, previews, objectAssignments, orderAssignments };
  };
  const denied = async (login: string, path: string, method = 'GET', body?: unknown, status = 403) => {
    const beforeDomain = await domain();
    const beforeAccess = await accessState();
    const response = await request(login, path, method, body);
    const text = await response.text();
    assert.deepEqual(await domain(), beforeDomain, `${method} ${path}: denied/invalid request cannot persist domain changes or audit`);
    assert.deepEqual(await accessState(), beforeAccess, 'Denied request cannot change rules, previews, versions, role sources or assignments');
    assert.equal(response.status, status, text);
  };
  const audit = async (id: string, suffix: string) => assert.equal(await prisma.auditEvent.count({ where: {
    entityType: 'one_time_order_specification_catalog', entityId: id,
    action: `one_time_order.${suffix}`, actorUserId: founderId,
  } }), 1);
  const createItem = (suffix: string) => request('founder', catalogPath, 'POST', {
    title: `${marker}-${suffix}`, description: `Original ${suffix}`, sortOrder: 10,
  }).then((response) => json<SpecificationCatalogItemResponseDto>(response, 201));
  const a = await createItem('A');
  const b = await createItem('B');
  const template = await json<SpecificationTemplateResponseDto>(await request('founder', templatesPath, 'POST', {
    name: `${marker}-template`, items: [{ catalogItemId: a.id, sortOrder: 0 }],
  }), 201);
  // This is an isolated, immutable historical order fixture, not a role/ACL change.
  const order = await prisma.oneTimeOrder.create({ data: {
    title: `${marker}-historical-order`, executionAddress: 'Isolated fixture', contactName: 'Fixture',
    status: 'in_progress', createdByUserId: founderId,
    specificationItems: { create: { title: a.title, description: a.description, sortOrder: 0, createdByUserId: founderId } },
  } });
  const originalSources = await accessState();

  await t.test('HTTP catalog truthfully declares exactly five constrained global actions; leadership reads do not mutate', async () => {
    const before = await domain();
    const definitions = await json<{ actions: typeof ACCESS_ACTION_CATALOG }>(await request('founder', '/users-access/admin/catalog'), 200);
    assert.deepEqual(definitions.actions.filter((entry) => entry.module === 'specification_catalog'), actions);
    const items = await json<SpecificationCatalogItemResponseDto[]>(await request('founder', catalogPath), 200);
    assert.ok(items.some((entry) => entry.id === a.id));
    assert.ok(items.some((entry) => entry.id === b.id));
    const templates = await json<SpecificationTemplateResponseDto[]>(await request('founder', templatesPath), 200);
    assert.equal(templates.find((entry) => entry.id === template.id)?.items[0]?.catalogItemId, a.id);
    assert.deepEqual(await domain(), before);
    assert.deepEqual(await accessState(), originalSources);
    await audit(a.id, 'specification_catalog_item_created');
    await audit(b.id, 'specification_catalog_item_created');
    await audit(template.id, 'specification_template_created');
  });

  for (const action of actions) {
    await t.test(`${action.code}: reject new allow/deny and unsupported selected scope atomically`, async () => {
      const expectedVersion = (await prisma.user.findUniqueOrThrow({ where: { id: managerId } })).accessVersion;
      for (const effect of ['allow', 'deny'] as const) {
        const input = { expectedVersion, reason: marker, changes: [{ actionCode: action.code, effect, scope: 'all' }] };
        // Preview and direct save both normalize and reject the constrained code;
        // valid-shaped dummy tokens are not authorization and create no preview.
        await denied('founder', `${adminPath}/preview`, 'POST', input, 400);
        await denied('founder', `${adminPath}/save`, 'POST', { ...input, previewToken: '0'.repeat(64), previewHash: '0'.repeat(64) }, 400);
      }
      await denied('founder', `${adminPath}/preview`, 'POST', {
        expectedVersion, reason: marker, changes: [{ actionCode: action.code, effect: 'default', scope: 'selected', selectedIds: [a.id] }],
      }, 400);
    });
  }

  await t.test('non-leadership parent boundary denies both lists and every item/template mutation without effects', async () => {
    for (const login of ['manager1', 'deputy1']) {
      await denied(login, catalogPath);
      await denied(login, templatesPath);
      await denied(login, catalogPath, 'POST', { title: `${marker}-forbidden` });
      await denied(login, `${catalogPath}/${a.id}`, 'PATCH', { description: 'Forbidden' });
      await denied(login, `${catalogPath}/${a.id}`, 'DELETE');
      await denied(login, templatesPath, 'POST', { name: `${marker}-forbidden`, items: [{ catalogItemId: a.id, sortOrder: 0 }] });
      await denied(login, `${templatesPath}/${template.id}`, 'PATCH', { expectedVersion: template.version, name: `${marker}-forbidden` });
      await denied(login, `${templatesPath}/${template.id}`, 'DELETE', { expectedVersion: template.version });
    }
  });

  await t.test('default reset for all five codes is auditable but cannot grant catalog access to the existing manager cookie', async () => {
    const beforeDomain = await domain();
    const before = await accessState();
    const expectedVersion = before.identities.find((entry) => entry.id === managerId)!.accessVersion;
    const reason = `${marker}-reset-constrained-defaults`;
    const input = { expectedVersion, reason, changes: actions.map((action) => ({ actionCode: action.code, effect: 'default', scope: 'all' })) };
    const preview = await json<{ previewToken: string; previewHash: string }>(await request('founder', `${adminPath}/preview`, 'POST', input), 201);
    assert.deepEqual((await accessState()).rules, before.rules);
    assert.deepEqual((await accessState()).identities, before.identities);
    assert.deepEqual(await domain(), beforeDomain);
    const saveInput = { ...input, previewToken: preview.previewToken, previewHash: preview.previewHash };
    const saved = await json<{ accessVersion: number; rules: unknown[] }>(await request('founder', `${adminPath}/save`, 'POST', saveInput), 201);
    assert.equal(saved.accessVersion, expectedVersion + 1);
    assert.deepEqual(saved.rules, []);
    const after = await accessState();
    assert.deepEqual(after.roles, before.roles);
    assert.deepEqual(after.permissions, before.permissions);
    assert.deepEqual(after.rules, before.rules);
    assert.deepEqual(after.objectAssignments, before.objectAssignments);
    assert.deepEqual(after.orderAssignments, before.orderAssignments);
    const recorded = after.audits.filter((entry) => !before.audits.some((old) => old.id === entry.id));
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].userId, managerId);
    assert.equal(recorded[0].actorUserId, founderId);
    assert.equal(recorded[0].reason, reason);
    assert.equal(recorded[0].versionBefore, expectedVersion);
    assert.equal(recorded[0].versionAfter, expectedVersion + 1);
    assert.deepEqual(recorded[0].before, []);
    assert.deepEqual(recorded[0].after, []);
    assert.deepEqual(await domain(), beforeDomain);
    await denied('manager1', catalogPath);
    await denied('manager1', templatesPath);
    await denied('manager1', catalogPath, 'POST', { title: `${marker}-still-denied` });
    await denied('founder', `${adminPath}/save`, 'POST', saveInput, 409);
  });

  await t.test('leadership update touches A only; template replacement is versioned and preserves stored order text', async () => {
    const before = await domain();
    const updated = await json<SpecificationCatalogItemResponseDto>(await request('founder', `${catalogPath}/${a.id}`, 'PATCH', {
      title: `${marker}-A-edited`, description: 'Catalog edit, not historical order rewrite', sortOrder: 20,
    }), 200);
    assert.equal(updated.title, `${marker}-A-edited`);
    const afterItem = await domain();
    const storedA = afterItem.items.find((entry) => entry.id === a.id)!;
    assert.equal(storedA.title, updated.title);
    assert.equal(storedA.createdByUserId, founderId);
    assert.equal(storedA.updatedByUserId, founderId);
    assert.deepEqual(afterItem.items.filter((entry) => entry.id !== a.id), before.items.filter((entry) => entry.id !== a.id));
    assert.deepEqual(afterItem.templates, before.templates);
    assert.deepEqual(afterItem.snapshots, before.snapshots);
    assert.deepEqual(afterItem.orders, before.orders);
    await audit(a.id, 'specification_catalog_item_updated');
    const changed = await json<SpecificationTemplateResponseDto>(await request('founder', `${templatesPath}/${template.id}`, 'PATCH', {
      expectedVersion: template.version, name: `${marker}-template-edited`, items: [{ catalogItemId: b.id, sortOrder: 1 }],
    }), 200);
    assert.equal(changed.version, template.version + 1);
    assert.equal(changed.name, `${marker}-template-edited`);
    assert.deepEqual(changed.items.map((entry) => entry.catalogItemId), [b.id]);
    const afterTemplate = await domain();
    assert.deepEqual(afterTemplate.items, afterItem.items);
    assert.deepEqual(afterTemplate.templates.filter((entry) => entry.id !== template.id), before.templates.filter((entry) => entry.id !== template.id));
    assert.deepEqual(afterTemplate.snapshots, before.snapshots);
    assert.deepEqual(afterTemplate.orders, before.orders);
    await audit(template.id, 'specification_template_updated');
    await denied('founder', `${templatesPath}/${template.id}`, 'PATCH', { expectedVersion: template.version, name: 'Stale overwrite' }, 409);
    await denied('founder', `${templatesPath}/${template.id}`, 'PATCH', { expectedVersion: changed.version, items: [{ catalogItemId: randomUUID(), sortOrder: 0 }] }, 404);
  });

  await t.test('leadership archive and restore never hard-delete items/template links or rewrite order snapshots', async () => {
    const before = await domain();
    const archivedItem = await json<SpecificationCatalogItemResponseDto>(await request('founder', `${catalogPath}/${a.id}`, 'DELETE'), 200);
    assert.equal(archivedItem.isArchived, true);
    assert.ok(await prisma.oneTimeOrderSpecificationCatalogItem.findUnique({ where: { id: a.id } }));
    const archivedList = await json<SpecificationCatalogItemResponseDto[]>(await request('founder', catalogPath), 200);
    assert.equal(archivedList.find((entry) => entry.id === a.id)?.isArchived, true);
    await audit(a.id, 'specification_catalog_item_archived');
    const restoredItem = await json<SpecificationCatalogItemResponseDto>(await request('founder', `${catalogPath}/${a.id}`, 'PATCH', { isArchived: false }), 200);
    assert.equal(restoredItem.isArchived, false);
    await audit(a.id, 'specification_catalog_item_restored');
    const current = await prisma.oneTimeOrderSpecificationTemplate.findUniqueOrThrow({ where: { id: template.id } });
    const archivedTemplate = await json<SpecificationTemplateResponseDto>(await request('founder', `${templatesPath}/${template.id}`, 'DELETE', { expectedVersion: current.version }), 200);
    assert.equal(archivedTemplate.isArchived, true);
    assert.equal(archivedTemplate.version, current.version + 1);
    await audit(template.id, 'specification_template_archived');
    await denied('founder', `${templatesPath}/${template.id}`, 'DELETE', { expectedVersion: current.version }, 409);
    const restoredTemplate = await json<SpecificationTemplateResponseDto>(await request('founder', `${templatesPath}/${template.id}`, 'PATCH', { expectedVersion: archivedTemplate.version, isArchived: false }), 200);
    assert.equal(restoredTemplate.isArchived, false);
    assert.equal(restoredTemplate.version, archivedTemplate.version + 1);
    await audit(template.id, 'specification_template_restored');
    const after = await domain();
    assert.deepEqual(after.items.filter((entry) => entry.id !== a.id), before.items.filter((entry) => entry.id !== a.id));
    assert.deepEqual(after.templates.find((entry) => entry.id === template.id)!.items, before.templates.find((entry) => entry.id === template.id)!.items);
    assert.deepEqual(after.snapshots, before.snapshots);
    assert.deepEqual(after.orders, before.orders);
    assert.deepEqual(after.attachments, before.attachments);
    assert.ok(after.orders.some((entry) => entry.id === order.id));
  });
});
