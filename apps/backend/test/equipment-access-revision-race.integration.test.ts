import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { EquipmentMovementResponseDto } from '../src/modules/equipment/dto/equipment-response.dto';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

const operations = [
  { leaf: 'assign_object', movement: 'issue_to_object', from: 'in_storage', to: 'assigned_to_object' },
  { leaf: 'assign_order', movement: 'issue_to_one_time_order', from: 'in_storage', to: 'assigned_to_one_time_order' },
  { leaf: 'return', movement: 'return_to_storage', from: 'assigned_to_object', to: 'in_storage' },
  { leaf: 'broken', movement: 'mark_broken', from: 'in_storage', to: 'broken' },
  { leaf: 'repair', movement: 'send_to_repair', from: 'broken', to: 'under_repair' },
  { leaf: 'repair_return', movement: 'return_from_repair', from: 'under_repair', to: 'in_storage' },
  { leaf: 'lost', movement: 'mark_lost', from: 'assigned_to_object', to: 'lost' },
  { leaf: 'writeoff', movement: 'writeoff', from: 'assigned_to_object', to: 'written_off' },
] as const;

type Waiter = { pid: number; query: string; wait_event_type: string | null; wait_event: string | null };
type Gate = { pid: number; release: () => void; done: Promise<void> };

// The normal integration runner owns schema creation/migration/seed/disposal.
// No acceptance-output artifact or separately running acceptance server is used.
test('equipment movement leaves reject an actor revision revoked while waiting for the unit', { timeout: 180_000 }, async (t) => {
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
  const managerRole = await db.role.findUniqueOrThrow({ where: { code: 'manager' } });

  async function post<T>(cookie: string, path: string, data: unknown): Promise<{ status: number; body: T }> {
    const response = await fetch(`${baseUrl}/api/v1/${path}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    return { status: response.status, body: await response.json() as T };
  }

  async function apply(actorId: string, actionCode: string, effect: 'allow' | 'deny', ids: string[]) {
    const before = await db.user.findUniqueOrThrow({ where: { id: actorId }, select: { accessVersion: true } });
    const data = {
      expectedVersion: before.accessVersion, reason: 'Isolated equipment actor-revision regression',
      changes: [{ actionCode, effect, scope: 'selected', selectedIds: ids }],
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

  async function gate(kind: 'unit' | 'actor', id: string): Promise<Gate> {
    let entered!: () => void;
    let release!: () => void;
    let pid = 0;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const done = db.$transaction(async (tx) => {
      pid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
      if (kind === 'unit') await tx.$queryRaw`SELECT id FROM equipment_units WHERE id = ${id} FOR UPDATE`;
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
      const waiter = waiters.find(matches);
      if (waiter) return waiter;
      assert.equal(settled(), false, 'HTTP finished without reaching the required real PostgreSQL lock');
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Expected SQL/PID did not contend on the owned row lock');
  }

  for (const operation of operations) {
    await t.test(`equipment.${operation.leaf}: committed revoke precedes actor fence and leaves no effects`, async () => {
      const marker = `equipment-revision-${operation.leaf}-${randomUUID()}`;
      const actor = await db.user.create({ data: {
        login: marker, fullName: marker, passwordHash: template.passwordHash, isActive: true,
        roles: { create: { roleId: managerRole.id } },
      }, include: { roles: { include: { role: true } } } });
      assert.deepEqual(actor.roles.map(({ role }) => role.code), ['manager']);
      const code = `equipment.${operation.leaf}`;
      const object = await db.object.create({ data: {
        name: marker, address: 'Isolated regression fixture', status: 'active', createdByUserId: founder.id,
      } });
      const order = await db.oneTimeOrder.create({ data: {
        title: marker, executionAddress: 'Isolated regression fixture', contactName: 'Regression fixture', status: 'new', createdByUserId: founder.id,
      } });
      await db.objectAssignment.create({ data: { objectId: object.id, userId: actor.id, assignmentRoleCode: 'manager' } });
      await db.oneTimeOrderAssignment.create({ data: { oneTimeOrderId: order.id, userId: actor.id, assignmentRoleCode: 'one_time_manager' } });
      const catalog = await db.equipmentCatalogItem.create({ data: {
        category: 'Regression', name: marker, createdByUserId: founder.id,
      } });
      async function createUnit(label: string) {
        const unit = await db.equipmentUnit.create({ data: {
          catalogItemId: catalog.id, inventoryNumber: `${marker}-${label}`, createdByUserId: founder.id,
          status: operation.from, currentObjectId: operation.from === 'assigned_to_object' ? object.id : null,
        } });
        // Setup history is not HTTP evidence. Both A and B start in a legal state.
        const history = operation.from === 'assigned_to_object' ? ['issue_to_object']
          : operation.from === 'broken' ? ['mark_broken']
            : operation.from === 'under_repair' ? ['mark_broken', 'send_to_repair'] : [];
        let from = 'in_storage';
        for (const movement of history) {
          const to = movement === 'issue_to_object' ? 'assigned_to_object' : movement === 'mark_broken' ? 'broken' : 'under_repair';
          await db.equipmentMovement.create({ data: {
            equipmentUnitId: unit.id, movementType: movement, status: 'applied', fromStatus: from, toStatus: to,
            toObjectId: movement === 'issue_to_object' ? object.id : null, createdByUserId: founder.id,
            comment: 'Fixture setup',
          } });
          from = to;
        }
        return unit;
      }
      const a = await createUnit('A');
      const b = await createUnit('control-B');
      const version = await apply(actor.id, code, 'allow', [a.id, b.id]);
      const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
      const body = {
        movementType: operation.movement, comment: marker,
        ...(operation.leaf === 'assign_object' ? { toObjectId: object.id } : {}),
        ...(operation.leaf === 'assign_order' ? { toOneTimeOrderId: order.id } : {}),
      };
      const route = (id: string) => `equipment/units/${id}/movements`;
      async function capture() {
        const movements = await db.equipmentMovement.findMany({
          where: { equipmentUnitId: { in: [a.id, b.id] } }, orderBy: { id: 'asc' },
        });
        const [units, approvals, audit, attachments, catalogRow, objectRow, orderRow, inventory, notifications, roles] = await Promise.all([
          db.equipmentUnit.findMany({ where: { id: { in: [a.id, b.id] } }, orderBy: { id: 'asc' } }),
          db.approvalRequest.findMany({ where: { createdByUserId: actor.id }, orderBy: { id: 'asc' } }),
          db.auditEvent.findMany({ where: {
            actorUserId: actor.id, entityType: { in: ['equipment_unit', 'equipment_movement', 'approval_request'] },
          }, orderBy: { id: 'asc' } }),
          db.fileAttachment.findMany({ where: {
            entityType: 'equipment_movement', entityId: { in: movements.map(({ id }) => id) },
          }, orderBy: { id: 'asc' }, include: { file: true } }),
          db.equipmentCatalogItem.findUniqueOrThrow({ where: { id: catalog.id } }),
          db.object.findUniqueOrThrow({ where: { id: object.id }, include: { assignments: true } }),
          db.oneTimeOrder.findUniqueOrThrow({ where: { id: order.id }, include: { assignments: true } }),
          db.inventoryMovement.findMany({ where: {
            OR: [{ relatedObjectId: object.id }, { relatedOneTimeOrderId: order.id }],
          }, orderBy: { id: 'asc' } }),
          db.notification.findMany({ where: {
            entityId: { in: [a.id, b.id, object.id, order.id, ...movements.map(({ id }) => id)] },
          }, orderBy: { id: 'asc' }, include: { realtimeOutbox: true } }),
          db.userRole.findMany({ where: { userId: actor.id }, orderBy: { roleId: 'asc' } }),
        ]);
        return { units, movements, approvals, audit, attachments, catalogRow, objectRow, orderRow, inventory, notifications, roles };
      }

      // One positive lifecycle control, not another role/scope authorization grid.
      const beforeControl = await capture();
      const control = await post<EquipmentMovementResponseDto>(cookie, route(b.id), body);
      const afterControl = await capture();
      assert.equal(control.status, 201, JSON.stringify(control.body));
      const added = afterControl.movements.filter((row) => !beforeControl.movements.some(({ id }) => id === row.id));
      assert.equal(added.length, 1);
      const movement = added[0]!;
      assert.equal(control.body.id, movement.id);
      assert.deepEqual(movement, {
        id: movement.id, equipmentUnitId: b.id, movementType: operation.movement,
        status: operation.leaf === 'writeoff' ? 'pending_approval' : 'applied',
        fromStatus: operation.from, toStatus: operation.to, fromObjectId: b.currentObjectId, fromOneTimeOrderId: null,
        toObjectId: operation.leaf === 'assign_object' ? object.id : null,
        toOneTimeOrderId: operation.leaf === 'assign_order' ? order.id : null,
        comment: marker, createdByUserId: actor.id, createdAt: movement.createdAt,
      });
      assert.deepEqual(afterControl.movements.filter(({ id }) => id !== movement.id), beforeControl.movements);
      const oldB = beforeControl.units.find(({ id }) => id === b.id)!;
      const newB = afterControl.units.find(({ id }) => id === b.id)!;
      assert.deepEqual(newB, operation.leaf === 'writeoff' ? oldB : {
        ...oldB, status: operation.to, currentObjectId: movement.toObjectId,
        currentOneTimeOrderId: movement.toOneTimeOrderId, updatedAt: newB.updatedAt,
      });
      assert.deepEqual(afterControl.units.filter(({ id }) => id !== b.id), beforeControl.units.filter(({ id }) => id !== b.id));
      const newAudits = afterControl.audit.filter((row) => !beforeControl.audit.some(({ id }) => id === row.id));
      assert.equal(newAudits.length, operation.leaf === 'writeoff' ? 2 : 1);
      assert.deepEqual(newAudits.filter(({ entityType }) => entityType === 'equipment_movement')
        .map(({ entityId, actorUserId, action }) => [entityId, actorUserId, action]),
      [[movement.id, actor.id, `equipment.${operation.movement}`]]);
      assert.deepEqual(afterControl.audit.filter((row) => beforeControl.audit.some(({ id }) => id === row.id)), beforeControl.audit);
      if (operation.leaf === 'writeoff') {
        const approvals = afterControl.approvals.filter((row) => !beforeControl.approvals.some(({ id }) => id === row.id));
        assert.equal(approvals.length, 1);
        const approval = approvals[0]!;
        assert.deepEqual([approval.id, approval.sourceEntityType, approval.sourceEntityId, approval.createdByUserId, approval.status, approval.approvalType],
          [control.body.approvalRequest?.id, 'equipment_movement', movement.id, actor.id, 'pending', 'equipment_writeoff_confirmation']);
        assert.deepEqual(newAudits.filter(({ entityType }) => entityType === 'approval_request')
          .map(({ entityId, actorUserId, action }) => [entityId, actorUserId, action]),
        [[approval.id, actor.id, 'approval.request.created']]);
        assert.deepEqual(afterControl.approvals.filter(({ id }) => id !== approval.id), beforeControl.approvals);
      } else {
        assert.equal(control.body.approvalRequest, null);
        assert.deepEqual(afterControl.approvals, beforeControl.approvals);
      }
      for (const key of ['attachments', 'catalogRow', 'objectRow', 'orderRow', 'inventory', 'notifications', 'roles'] as const) {
        assert.deepEqual(afterControl[key], beforeControl[key]);
      }

      const before = await capture();
      let unitGate: Gate | undefined;
      let actorGate: Gate | undefined;
      let pending: Promise<{ status: number; body: unknown }> | undefined;
      let settled = false;
      let actorFence: Waiter | undefined;
      let response: { status: number; body: unknown } | undefined;
      let raceError: unknown;
      try {
        unitGate = await gate('unit', a.id);
        pending = post<unknown>(cookie, route(a.id), body);
        void pending.then(() => { settled = true; }, () => { settled = true; });
        const unitWaiter = await waitForLock(unitGate, () => settled,
          ({ query }) => /equipment_units/i.test(query) && /FOR UPDATE/i.test(query));
        assert.equal(unitWaiter.wait_event_type, 'Lock');
        const revokedVersion = await apply(actor.id, code, 'deny', [a.id]);
        assert.equal(revokedVersion, version + 1, 'Actual founder save commits while HTTP is blocked on unit A');
        assert.deepEqual(await db.userAccessRule.findMany({
          where: { userId: actor.id, actionCode: code }, select: { effect: true, scope: true, selectedIds: true },
        }), [{ effect: 'deny', scope: 'selected', selectedIds: [a.id] }]);
        actorGate = await gate('actor', actor.id);
        unitGate.release();
        await unitGate.done;
        actorFence = await waitForLock(actorGate, () => settled, ({ pid, query }) =>
          pid === unitWaiter.pid && /accessVersion/.test(query) && /users/.test(query) && /FOR SHARE/i.test(query));
        assert.equal(actorFence.wait_event_type, 'Lock');
        actorGate.release();
        await actorGate.done;
        response = await pending;
      } catch (error) {
        raceError = error;
      } finally {
        // Release gates even if the fence is missing or the HTTP request fails.
        unitGate?.release();
        actorGate?.release();
        await Promise.allSettled([unitGate?.done, actorGate?.done]);
        if (pending) {
          try { response = await pending; } catch (error) { raceError ??= error; }
        }
      }
      // Check business rows even when an unfenced writer returned/failed early.
      // Writeoff's existing B approval must remain, and no A approval/audit may leak.
      assert.deepEqual(await capture(), before, `${code}: revoke must preserve all captured rows, including approvals and audits`);
      if (raceError) throw raceError;
      assert.ok(actorFence, 'An INSERT blocked by an actor FK is not the access-revision fence');
      assert.equal(response?.status, 403, JSON.stringify(response?.body));
    });
  }
});
