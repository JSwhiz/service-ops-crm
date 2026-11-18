import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Prisma, PrismaClient, type InventoryMovement } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

const operations = ['mats.cost.edit', 'mats.quantity.edit', 'inventory.movement.correct', 'inventory.resolve_missing_photo', 'equipment.catalog.delete'] as const;

type Waiter = { pid: number; query: string; wait_event_type: string | null; wait_event: string | null };
type Gate = { pid: number; release: () => void; done: Promise<void> };

// The normal integration runner owns schema creation/migration/seed/disposal.
// No acceptance-output artifact or separately running acceptance server is used.
test('five domain writes reject access revoked behind their actual resource lock', { timeout: 180_000 }, async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  assert.ok(['postgres:', 'postgresql:'].includes(databaseUrl.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname));
  assert.equal(databaseUrl.port, '55432');
  assert.match(databaseUrl.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  databaseUrl.searchParams.set('connection_limit', '5');
  const db = new PrismaClient({ datasourceUrl: databaseUrl.toString() });
  const cleanup: { closeApp?: () => Promise<void> } = {};
  t.after(async () => {
    try { await cleanup.closeApp?.(); } finally { await db.$disconnect(); }
  });
  const [schema] = await db.$queryRaw<Array<{ name: string }>>`SELECT current_schema() AS name`;
  assert.equal(schema?.name, databaseUrl.searchParams.get('schema'));
  const { app, baseUrl } = await createTestApp();
  cleanup.closeApp = () => app.close();
  const adminCookie = await loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' });
  const founder = await db.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const template = await db.user.findUniqueOrThrow({ where: { login: 'manager1' } });

  async function post<T>(cookie: string, path: string, data: unknown, method = 'POST'): Promise<{ status: number; body: T }> {
    const response = await fetch(`${baseUrl}/api/v1/${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    return { status: response.status, body: await response.json() as T };
  }

  async function apply(actorId: string, actionCode: string, effect: 'allow' | 'deny', ids: string[], scope: 'all' | 'selected' = 'selected') {
    const before = await db.user.findUniqueOrThrow({ where: { id: actorId }, select: { accessVersion: true } });
    const data = {
      expectedVersion: before.accessVersion, reason: 'Isolated five-domain actor-revision regression',
      changes: [{ actionCode, effect, scope, selectedIds: ids }],
    };
    const preview = await post<{ previewToken: string; previewHash: string }>(adminCookie,
      `users-access/admin/users/${actorId}/preview`, data);
    assert.equal(preview.status, 201, JSON.stringify(preview.body));
    assert.equal(typeof preview.body.previewToken, 'string');
    assert.equal(typeof preview.body.previewHash, 'string');
    const saved = await post<unknown>(adminCookie, `users-access/admin/users/${actorId}/save`, {
      ...data, previewToken: preview.body.previewToken, previewHash: preview.body.previewHash,
    });
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    const after = await db.user.findUniqueOrThrow({ where: { id: actorId }, select: { accessVersion: true } });
    assert.equal(after.accessVersion, before.accessVersion + 1);
    return after.accessVersion;
  }

  async function gate(kind: 'size' | 'object' | 'item' | 'catalog' | 'actor', id: string): Promise<Gate> {
    let entered!: () => void;
    let release!: () => void;
    let pid = 0;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const done = db.$transaction(async (tx) => {
      pid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
      if (kind === 'size') await tx.$queryRaw`SELECT id FROM "RubberMatSize" WHERE id = ${id} FOR UPDATE`;
      else if (kind === 'object') await tx.$queryRaw`SELECT id FROM objects WHERE id = ${id} FOR UPDATE`;
      else if (kind === 'item') await tx.$queryRaw`SELECT id FROM inventory_items WHERE id = ${id} FOR UPDATE`;
      else if (kind === 'catalog') await tx.$queryRaw`SELECT id FROM equipment_catalog_items WHERE id = ${id} FOR UPDATE`;
      else await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
      entered();
      await hold;
    }, { timeout: 15_000, maxWait: 5_000 });
    void done.catch(() => undefined);
    await Promise.race([ready, done.then(() => { throw new Error('Gate ended before acquiring its row'); })]);
    return { pid, release, done };
  }

  async function waitForLock(blocker: Gate, settled: () => boolean, matches: (row: Waiter) => boolean): Promise<Waiter> {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const waiters = await db.$queryRaw<Waiter[]>`
        SELECT pid, query, wait_event_type, wait_event FROM pg_stat_activity
        WHERE ${blocker.pid} = ANY(pg_blocking_pids(pid))
          AND datname = current_database() AND pid <> pg_backend_pid()
      `;
      // Blocking PIDs and activity wait fields can be sampled at different instants.
      // Keep polling until this exact SQL is also observed in the required Lock wait.
      const waiter = waiters.find((row) => row.wait_event_type === 'Lock' && matches(row));
      if (waiter) return waiter;
      assert.equal(settled(), false, 'HTTP finished without reaching the required real PostgreSQL lock');
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Expected SQL/PID did not contend on the owned row lock');
  }

  for (const code of operations) {
    await t.test(`${code}: valid control, committed revoke, real actor fence and no graph changes`, async () => {
      const cost = code === 'mats.cost.edit';
      const quantity = code === 'mats.quantity.edit';
      const correction = code === 'inventory.movement.correct';
      const confirm = code === 'inventory.resolve_missing_photo';
      const roleCode = confirm ? 'director' : 'manager';
      const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
      const marker = `domain-revision-${randomUUID()}`;
      const actor = await db.user.create({ data: {
        login: marker, fullName: marker, passwordHash: template.passwordHash, isActive: true,
        roles: { create: { roleId: role.id } },
      }, include: { roles: { include: { role: true } } } });
      assert.deepEqual(actor.roles.map(({ role }) => role.code), [roleCode]);
      const objects = [];
      for (const suffix of ['A', 'B']) objects.push(await db.object.create({ data: {
        name: `${marker}-${suffix}`, address: 'Owned regression fixture', status: 'active', createdByUserId: founder.id,
        assignments: { create: { userId: actor.id, assignmentRoleCode: 'manager', isActive: true } },
      } }));
      const objectIds = objects.map(({ id }) => id);
      assert.ok(await db.rubberMatAggregateMigration.findUnique({ where: { id: 'legacy-v1' } }),
        'Use real migrations; never invent a readiness marker');
      const sizes = [];
      const length = 100_000 + Number.parseInt(randomUUID().replaceAll('-', '').slice(0, 6), 16);
      for (const width of [111, 112]) {
        const size = await db.rubberMatSize.create({ data: { lengthCm: length, widthCm: width, replacementCost: '1700.25' } });
        sizes.push(size);
        for (const objectId of objectIds) await db.objectRubberMatQuantity.create({ data: { objectId, sizeId: size.id, quantity: 3 } });
      }
      const sizeIds = sizes.map(({ id }) => id);
      const items = [];
      for (const suffix of ['A', 'B']) {
        const item = await db.inventoryItem.create({ data: {
          name: `${marker}-item-${suffix}`, category: 'Regression', unit: 'шт', currentUnitPrice: '17.25', createdByUserId: founder.id,
        } });
        items.push(item);
        await db.inventoryMovement.create({ data: {
          inventoryItemId: item.id, movementType: 'receipt', status: 'applied', quantity: 10,
          unitPriceSnapshot: '17.25', totalAmountSnapshot: '172.50', createdByUserId: founder.id,
        } });
      }
      const itemIds = items.map(({ id }) => id);
      const sources: InventoryMovement[] = [];
      if (correction || confirm) {
        for (let i = 0; i < 2; i++) {
          // Valid unresolved-photo source. The director is independent of its founder author.
          const source = await db.inventoryMovement.create({ data: {
            inventoryItemId: itemIds[i], movementType: 'issue_to_object', status: 'applied', quantity: 2,
            unitPriceSnapshot: '17.25', totalAmountSnapshot: '34.50', relatedObjectId: objectIds[i],
            createdByUserId: founder.id, evidenceRequired: true, requiresApprovalBridge: true,
            approvalBridgeType: 'inventory_without_photo_confirmation',
          } });
          sources.push(source);
          await db.approvalRequest.create({ data: {
            approvalType: 'inventory_exception_confirmation', sourceEntityType: 'inventory_movement', sourceEntityId: source.id,
            createdByUserId: founder.id, payloadSnapshot: { summaryTitle: marker, inventoryItemId: itemIds[i] },
          } });
        }
      }
      const catalogs = [];
      if (!cost && !quantity && !correction && !confirm) {
        for (const suffix of ['A', 'B']) catalogs.push(await db.equipmentCatalogItem.create({ data: {
          name: `${marker}-model-${suffix}`, category: 'Unused regression model', createdByUserId: founder.id,
        } }));
      }
      const catalogIds = catalogs.map(({ id }) => id);
      const scope = cost || catalogs.length ? 'all' : 'selected';
      const grantIds = quantity ? objectIds : correction || confirm ? itemIds : [];
      if (correction || confirm) {
        await apply(actor.id, 'inventory.read', 'allow', itemIds);
        await apply(actor.id, 'objects.read', 'allow', objectIds);
      }
      const version = await apply(actor.id, code, 'allow', grantIds, scope);
      const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
      const route = (i: number) => cost ? `rubber-mats/catalog/${sizeIds[i]}`
        : quantity ? `objects/${objectIds[i]}/rubber-mats/aggregate/${sizeIds[0]}`
          : correction ? `inventory/movements/${sources[i].id}/correct`
            : confirm ? `inventory/movements/${sources[i].id}/resolve-missing-photo-approval`
              : `equipment/catalog/${catalogIds[i]}`;
      const method = cost ? 'PATCH' : quantity ? 'PUT' : catalogs.length ? 'DELETE' : 'POST';
      const body = cost ? { version: 1, replacementCost: '1888.75' } : quantity ? { version: 1, quantity: 7 }
        : correction ? { reason: marker } : {};
      async function capture() {
        const movements = await db.inventoryMovement.findMany({ where: { inventoryItemId: { in: itemIds } }, orderBy: { id: 'asc' } });
        const movementIds = movements.map(({ id }) => id);
        const state = {
          sizes: await db.rubberMatSize.findMany({ where: { id: { in: sizeIds } }, orderBy: { id: 'asc' } }),
          quantities: await db.objectRubberMatQuantity.findMany({ where: { sizeId: { in: sizeIds } }, orderBy: [{ objectId: 'asc' }, { sizeId: 'asc' }] }),
          costHistory: await db.rubberMatSizeChange.findMany({ where: { sizeId: { in: sizeIds } }, orderBy: [{ sizeId: 'asc' }, { version: 'asc' }] }),
          quantityHistory: await db.objectRubberMatQuantityChange.findMany({ where: { sizeId: { in: sizeIds } }, orderBy: [{ objectId: 'asc' }, { sizeId: 'asc' }, { version: 'asc' }] }),
          items: await db.inventoryItem.findMany({ where: { id: { in: itemIds } }, orderBy: { id: 'asc' } }), movements,
          approvals: await db.approvalRequest.findMany({ where: { OR: [{ sourceEntityType: 'inventory_movement', sourceEntityId: { in: movementIds } }, { createdByUserId: actor.id }] }, orderBy: { id: 'asc' } }),
          audit: await db.auditEvent.findMany({ where: { actorUserId: actor.id }, orderBy: { id: 'asc' } }),
          objects: await db.object.findMany({ where: { id: { in: objectIds } }, include: { assignments: true }, orderBy: { id: 'asc' } }),
          budgets: await db.objectBudgetPeriod.findMany({ where: { objectId: { in: objectIds } }, orderBy: [{ objectId: 'asc' }, { month: 'asc' }] }),
          alerts: await db.objectBudgetAlert.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
          attachments: await db.fileAttachment.findMany({ where: { entityType: 'inventory_movement', entityId: { in: movementIds } }, include: { file: true }, orderBy: { id: 'asc' } }),
          notifications: await db.notification.findMany({ where: { entityId: { in: [...objectIds, ...itemIds, ...sizeIds, ...catalogIds, ...movementIds] } }, include: { realtimeOutbox: true }, orderBy: { id: 'asc' } }),
          catalogs: await db.equipmentCatalogItem.findMany({ where: { id: { in: catalogIds } }, orderBy: { id: 'asc' } }),
          units: await db.equipmentUnit.findMany({ where: { catalogItemId: { in: catalogIds } }, orderBy: { id: 'asc' } }),
          roles: await db.userRole.findMany({ where: { userId: actor.id }, orderBy: { roleId: 'asc' } }),
        };
        const stock = itemIds.map((id) => ({ id, quantity: state.movements.filter((m) => m.inventoryItemId === id && m.status === 'applied')
          .reduce((sum, m) => sum + (['receipt', 'return'].includes(m.movementType) ? Number(m.quantity) : -Number(m.quantity)), 0) }));
        const replacementGraph = objectIds.map((id) => ({ id, amount: state.quantities.filter((x) => x.objectId === id).reduce((sum, x) => {
          const price = state.sizes.find((s) => s.id === x.sizeId)?.replacementCost;
          assert.ok(price); return sum.plus(price.mul(x.quantity));
        }, new Prisma.Decimal(0)).toFixed(2) }));
        return { ...state, stock, replacementGraph };
      }
      // One same-shape legal control, not a repetition of the accepted role/scope grid.
      const beforeControl = await capture();
      const control = await post<Record<string, unknown>>(cookie, route(1), body, method);
      const afterControl = await capture();
      assert.equal(control.status, correction ? 201 : 200, JSON.stringify(control.body));
      if (cost) {
        const old = beforeControl.sizes.find((s) => s.id === sizeIds[1])!;
        const changed = afterControl.sizes.find((s) => s.id === sizeIds[1])!;
        assert.deepEqual(changed, { ...old, replacementCost: new Prisma.Decimal('1888.75'), version: 2, updatedAt: changed.updatedAt });
        assert.equal(control.body.id, sizeIds[1]);
        assert.equal(afterControl.costHistory.length, beforeControl.costHistory.length + 1);
        const history = afterControl.costHistory.find((x) => !beforeControl.costHistory.some((y) => y.id === x.id))!;
        assert.deepEqual([history.sizeId, history.version, history.beforeCost?.toString(), history.afterCost?.toString(), history.actorUserId], [sizeIds[1], 2, '1700.25', '1888.75', actor.id]);
        assert.deepEqual(afterControl.quantities, beforeControl.quantities);
        assert.deepEqual(afterControl.quantityHistory, beforeControl.quantityHistory);
      } else if (quantity) {
        const old = beforeControl.quantities.find((x) => x.objectId === objectIds[1] && x.sizeId === sizeIds[0])!;
        const changed = afterControl.quantities.find((x) => x.objectId === objectIds[1] && x.sizeId === sizeIds[0])!;
        assert.deepEqual(changed, { ...old, quantity: 7, version: 2, updatedAt: changed.updatedAt });
        assert.deepEqual(control.body, { quantity: 7, version: 2 });
        assert.equal(afterControl.quantityHistory.length, beforeControl.quantityHistory.length + 1);
        const history = afterControl.quantityHistory.find((x) => !beforeControl.quantityHistory.some((y) => y.id === x.id))!;
        assert.deepEqual([history.objectId, history.sizeId, history.beforeQuantity, history.afterQuantity, history.replacementCostSnapshot?.toString(), history.actorUserId], [objectIds[1], sizeIds[0], 3, 7, '1700.25', actor.id]);
        assert.deepEqual(afterControl.sizes, beforeControl.sizes);
        assert.deepEqual(afterControl.costHistory, beforeControl.costHistory);
      } else if (correction || confirm) {
        assert.equal(control.body.id, sources[1].id);
        assert.equal(afterControl.movements.length, beforeControl.movements.length);
        const source = afterControl.movements.find((x) => x.id === sources[1].id)!;
        const approval = afterControl.approvals.find((x) => x.sourceEntityId === sources[1].id)!;
        if (correction) {
          assert.equal(control.body.mode, 'cancelled'); assert.equal(source.status, 'cancelled'); assert.equal(approval.status, 'cancelled');
        } else {
          assert.equal(source.approvalBridgeResolvedByUserId, actor.id); assert.ok(source.approvalBridgeResolvedAt); assert.equal(approval.status, 'approved');
        }
        assert.ok(afterControl.audit.some((x) => x.actorUserId === actor.id));
      } else {
        assert.equal(control.body.id, catalogIds[1]);
        assert.deepEqual(afterControl.catalogs, beforeControl.catalogs.filter((x) => x.id !== catalogIds[1]));
        const audits = afterControl.audit.filter((x) => !beforeControl.audit.some((y) => y.id === x.id));
        assert.deepEqual(audits.map((x) => [x.entityId, x.actorUserId, x.action]), [[catalogIds[1], actor.id, 'equipment.catalog_item.deleted_permanently']]);
        assert.deepEqual(afterControl.units, beforeControl.units);
      }
      assert.deepEqual(afterControl.items, beforeControl.items, 'Controls do not rewrite unit prices');
      const before = await capture();
      const physicalKind = cost ? 'size' : quantity ? 'object' : catalogs.length ? 'catalog' : 'item';
      const physicalId = cost ? sizeIds[0] : quantity ? objectIds[0] : catalogs.length ? catalogIds[0] : itemIds[0];
      const table = cost ? 'RubberMatSize' : quantity ? 'objects' : catalogs.length ? 'equipment_catalog_items' : 'inventory_items';
      const deniedIds = scope === 'all' ? [] : quantity ? [objectIds[0]] : [itemIds[0]];
      let resourceGate: Gate | undefined;
      let actorGate: Gate | undefined;
      let pending: Promise<{ status: number; body: unknown }> | undefined;
      let response: { status: number; body: unknown } | undefined;
      let settled = false;
      let fence: Waiter | undefined;
      let error: unknown;
      try {
        resourceGate = await gate(physicalKind, physicalId);
        pending = post<unknown>(cookie, route(0), body, method);
        void pending.then(() => { settled = true; }, () => { settled = true; });
        const waiter = await waitForLock(resourceGate, () => settled, (x) => x.query.includes(table) && /FOR UPDATE/i.test(x.query));
        assert.equal(waiter.wait_event_type, 'Lock');
        assert.equal(await apply(actor.id, code, 'deny', deniedIds, scope), version + 1);
        assert.deepEqual(await db.userAccessRule.findMany({ where: { userId: actor.id, actionCode: code }, select: { effect: true, scope: true, selectedIds: true } }),
          [{ effect: 'deny', scope, selectedIds: deniedIds }]);
        actorGate = await gate('actor', actor.id);
        resourceGate.release(); await resourceGate.done;
        fence = await waitForLock(actorGate, () => settled, (x) => x.pid === waiter.pid && /accessVersion/.test(x.query) && /users/.test(x.query) && /FOR SHARE/i.test(x.query));
        assert.equal(fence.wait_event_type, 'Lock');
        actorGate.release(); await actorGate.done; response = await pending;
      } catch (caught) { error = caught; }
      finally {
        resourceGate?.release(); actorGate?.release();
        await Promise.allSettled([resourceGate?.done, actorGate?.done]);
        if (pending) try { response = await pending; } catch (caught) { error ??= caught; }
      }
      // Even if a missing fence produces an early response, compare all business rows.
      assert.deepEqual(await capture(), before, `${code}: no history/audit/stock/cost/approval graph effects after revoke`);
      if (error) throw error;
      assert.ok(fence, 'The same backend must reach actor revision FOR SHARE, not an FK INSERT wait');
      assert.equal(response?.status, 403, JSON.stringify(response?.body));
    });
  }
});
