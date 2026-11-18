import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Prisma, PrismaClient } from '@prisma/client';

import { AuditService } from '../src/modules/audit/audit.service';
import type { ScopedEquipmentMovementReceiptDto } from '../src/modules/equipment/dto/scoped-equipment-action.dto';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('scoped equipment serializes concurrent actions, returns without global read, and denies before state disclosure', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  let cleanupRules = async (): Promise<void> => {};
  t.after(async () => {
    try { await cleanupRules(); } finally { try { await closeApp?.(); } finally { await prisma.$disconnect(); } }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const actorQuery = { include: {
    roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    permissions: { include: { permission: true } },
  } } as const;
  const manager = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' }, ...actorQuery });
  const scoped = await prisma.user.findUniqueOrThrow({ where: { login: 'hr1' }, ...actorQuery });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  assert.deepEqual(manager.roles.map(({ role }) => role.code), ['manager']);
  assert.deepEqual(scoped.roles.map(({ role }) => role.code), ['hr']);
  assert.equal(await prisma.userAccessRule.count({ where: { userId: { in: [manager.id, scoped.id] }, actionCode: { startsWith: 'equipment.' } } }), 0);
  const managerCookie = await loginAndGetCookieHeader({ baseUrl, login: manager.login, password: 'manager123' });
  const scopedCookie = await loginAndGetCookieHeader({ baseUrl, login: scoped.login, password: 'hr123' });
  const marker = `equipment-scoped-boundary-${randomUUID()}`;
  const object = await prisma.object.create({ data: { name: marker, address: 'Isolated boundary fixture', status: 'active', createdByUserId: founder.id } });
  const order = await prisma.oneTimeOrder.create({ data: { title: marker, executionAddress: 'Isolated order fixture', status: 'new', contactName: 'Fixture', createdByUserId: founder.id } });
  // Real canonical Users and assignment codes. No roles or broad permissions are added.
  for (const userId of [manager.id, scoped.id]) {
    await prisma.objectAssignment.create({ data: { objectId: object.id, userId, assignmentRoleCode: 'manager' } });
    await prisma.oneTimeOrderAssignment.create({ data: { oneTimeOrderId: order.id, userId, assignmentRoleCode: 'one_time_manager' } });
  }
  const catalog = await prisma.equipmentCatalogItem.create({ data: { category: 'Boundary fixture', name: marker, notes: `${marker}-private-catalog-note`, createdByUserId: founder.id } });
  const unit = async (label: string, source: 'storage' | 'object' | 'order' = 'storage') => {
    const saved = await prisma.equipmentUnit.create({ data: {
      inventoryNumber: `${marker}-${label}`, catalogItemId: catalog.id, createdByUserId: founder.id,
      serialNumber: `${marker}-${label}-private-serial`, notes: `${marker}-${label}-private-unit-note`,
      status: source === 'storage' ? 'in_storage' : source === 'object' ? 'assigned_to_object' : 'assigned_to_one_time_order',
      currentObjectId: source === 'object' ? object.id : null, currentOneTimeOrderId: source === 'order' ? order.id : null,
    } });
    if (source !== 'storage') await prisma.equipmentMovement.create({ data: {
      equipmentUnitId: saved.id, movementType: source === 'object' ? 'issue_to_object' : 'issue_to_one_time_order', status: 'applied',
      fromStatus: 'in_storage', toStatus: saved.status, toObjectId: saved.currentObjectId, toOneTimeOrderId: saved.currentOneTimeOrderId,
      createdByUserId: founder.id,
    } });
    return saved;
  };
  const request = (path: string, cookie = managerCookie, method = 'POST') => fetch(`${baseUrl}/api/v1/equipment${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify({ comment: marker }) } : {}), signal: AbortSignal.timeout(15_000),
  });
  const status = async (response: Response, expected: number) => assert.equal(response.status, expected, await response.clone().text());
  const capture = async () => {
    const [units, movements, audits, approvals, attachments, objectRow, orderRow, objectAssignments, orderAssignments] = await Promise.all([
      prisma.equipmentUnit.findMany({ orderBy: { id: 'asc' } }),
      prisma.equipmentMovement.findMany({ orderBy: { id: 'asc' } }),
      prisma.auditEvent.findMany({ where: { entityType: { in: ['equipment_unit', 'equipment_movement', 'approval_request'] } }, orderBy: { id: 'asc' } }),
      prisma.approvalRequest.findMany({ where: { sourceEntityType: 'equipment_movement' }, orderBy: { id: 'asc' } }),
      prisma.fileAttachment.findMany({ where: { entityType: 'equipment_movement' }, orderBy: { id: 'asc' } }),
      prisma.object.findUniqueOrThrow({ where: { id: object.id } }),
      prisma.oneTimeOrder.findUniqueOrThrow({ where: { id: order.id } }),
      prisma.objectAssignment.findMany({ where: { objectId: object.id }, orderBy: { id: 'asc' } }),
      prisma.oneTimeOrderAssignment.findMany({ where: { oneTimeOrderId: order.id }, orderBy: { id: 'asc' } }),
    ]);
    return { units, movements, audits, approvals, attachments, objectRow, orderRow, objectAssignments, orderAssignments };
  };
  const ruleIds = new Set<string>();
  const rule = async (userId: string, actionCode: string, effect: 'allow' | 'deny', selectedIds: string[]) => {
    const saved = await prisma.userAccessRule.create({ data: { userId, actionCode, effect, scope: 'selected', selectedIds } });
    ruleIds.add(saved.id);
    return saved;
  };
  const reset = async () => { await prisma.userAccessRule.deleteMany({ where: { id: { in: [...ruleIds] } } }); ruleIds.clear(); };
  cleanupRules = reset;
  const applied = async (before: Awaited<ReturnType<typeof capture>>, id: string, movementType: string, toStatus: string, actorId: string) => {
    const after = await capture();
    const added = after.movements.filter((row) => !before.movements.some(({ id }) => id === row.id));
    assert.equal(added.length, 1);
    const movement = added[0]!;
    const old = before.units.find((row) => row.id === id)!;
    const saved = after.units.find((row) => row.id === id)!;
    assert.equal(movement.equipmentUnitId, id);
    assert.equal(movement.movementType, movementType);
    assert.equal(movement.createdByUserId, actorId);
    assert.equal(movement.fromStatus, old.status);
    assert.equal(movement.toStatus, toStatus);
    assert.equal(movement.fromObjectId, old.currentObjectId);
    assert.equal(movement.fromOneTimeOrderId, old.currentOneTimeOrderId);
    assert.equal(movement.toObjectId, saved.currentObjectId);
    assert.equal(movement.toOneTimeOrderId, saved.currentOneTimeOrderId);
    assert.deepEqual(after.units.filter((row) => row.id !== id), before.units.filter((row) => row.id !== id));
    assert.deepEqual(saved, { ...old, status: toStatus, currentObjectId: movement.toObjectId, currentOneTimeOrderId: movement.toOneTimeOrderId, updatedAt: saved.updatedAt });
    assert.deepEqual(after.movements.filter((row) => row.id !== movement.id), before.movements);
    const events = after.audits.filter((row) => !before.audits.some(({ id }) => id === row.id));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.entityId, movement.id);
    assert.equal(events[0]!.actorUserId, actorId);
    assert.equal(events[0]!.action, `equipment.${movementType}.scoped_manager`);
    assert.deepEqual(events[0]!.newValues, { equipmentUnitId: id, toStatus, toObjectId: movement.toObjectId, toOneTimeOrderId: movement.toOneTimeOrderId });
    assert.deepEqual(after.audits.filter((row) => row.id !== events[0]!.id), before.audits);
    for (const key of ['approvals', 'attachments', 'objectRow', 'orderRow', 'objectAssignments', 'orderAssignments'] as const) assert.deepEqual(after[key], before[key]);
    return movement;
  };
  const bounded = async <T>(work: Promise<T>, label: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([work, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(label)), 1500); })]); }
    finally { if (timer) clearTimeout(timer); }
  };

  await t.test('controlled issue/issue race: loser waits for the real row lock and cannot apply a second movement', async () => {
    const saved = await unit('race');
    const before = await capture();
    const audit = app.get(AuditService);
    const originalAudit = audit.writeAuditEvent;
    type TransactionHost = { $transaction: (work: unknown, options?: unknown) => Promise<unknown> };
    const host = app.get(PrismaService) as unknown as TransactionHost;
    const originalTransaction = host.$transaction;
    let release!: () => void;
    let entered!: () => void;
    let secondEntered!: (pid: number) => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const firstAudit = new Promise<void>((resolve) => { entered = resolve; });
    const secondTransaction = new Promise<number>((resolve) => { secondEntered = resolve; });
    let held = false;
    let competingLockSeen = false;
    host.$transaction = (work, options) => {
      // Background array/callback transactions remain untouched. Only the
      // locking SQL for this fixture unit identifies the competing request.
      if (typeof work !== 'function') return originalTransaction.call(host, work, options);
      return originalTransaction.call(host, async (tx: Prisma.TransactionClient) => {
        const observed = new Proxy(tx, {
          get(target, property) {
            if (property === '$queryRaw') {
              const execute = target.$queryRaw.bind(target) as (...args: unknown[]) => Promise<unknown>;
              return async (...args: unknown[]) => {
                const query = args[0] as { sql?: string; values?: unknown[] } | null | undefined;
                if (held && !competingLockSeen && /SELECT\s+"id"\s+FROM\s+"equipment_units"[\s\S]*FOR UPDATE/i.test(query?.sql ?? '') && query?.values?.includes(saved.id)) {
                  competingLockSeen = true;
                  const [backend] = await target.$queryRaw<Array<{ pid: number }>>(Prisma.sql`SELECT pg_backend_pid() AS pid`);
                  secondEntered(backend!.pid);
                }
                return execute(...args);
              };
            }
            const value: unknown = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        return (work as (tx: Prisma.TransactionClient) => Promise<unknown>)(observed);
      }, options);
    };
    audit.writeAuditEvent = async (...args: Parameters<AuditService['writeAuditEvent']>) => {
      await originalAudit.apply(audit, args);
      const values = args[0].newValues as { equipmentUnitId?: unknown } | null | undefined;
      if (!held && args[0].action === 'equipment.issue_to_object.scoped_manager' && values?.equipmentUnitId === saved.id) {
        held = true; entered(); await gate;
      }
    };
    const first = request(`/scoped/units/${saved.id}/objects/${object.id}/assign`);
    void first.catch(() => undefined);
    let second: Promise<Response> | undefined;
    try {
      await bounded(firstAudit, 'Winner did not reach the controlled audit boundary');
      second = request(`/scoped/units/${saved.id}/one-time-orders/${order.id}/assign`);
      void second.catch(() => undefined);
      const pid = await bounded(secondTransaction, 'Competing HTTP request did not reach this unit locking statement');
      await bounded((async () => {
        const deadline = Date.now() + 1200;
        while (Date.now() < deadline) {
          const [activity] = await prisma.$queryRaw<Array<{ wait_event_type: string | null }>>(Prisma.sql`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}`);
          if (activity?.wait_event_type === 'Lock') return;
          await new Promise((resolve) => setTimeout(resolve, 15));
        }
        throw new Error('Competing transaction did not wait for the locked unit');
      })(), 'Loser did not contend on a real PostgreSQL lock');
      release();
      const [won, lost] = await Promise.all([first, second]);
      await status(won, 201); await status(lost, 409);
      const movement = await applied(before, saved.id, 'issue_to_object', 'assigned_to_object', manager.id);
      assert.deepEqual(await won.json(), { id: saved.id, movementId: movement.id, status: 'assigned_to_object' });
    } finally {
      release();
      await Promise.allSettled([first, ...(second ? [second] : [])]);
      audit.writeAuditEvent = originalAudit;
      host.$transaction = originalTransaction;
    }
  });

  for (const source of ['object', 'order'] as const) await t.test(`scoped ${source} return succeeds without global read and does not grant later storage access`, async (suite) => {
    suite.after(reset);
    const saved = await unit(`no-global-read-${source}`, source);
    const control = await unit(`no-global-read-control-${source}`);
    await rule(scoped.id, 'equipment.return', 'allow', [saved.id]);
    await status(await request(`/units/${control.id}`, scopedCookie, 'GET'), 403);
    await status(await request('/units', scopedCookie, 'GET'), 403);
    const before = await capture();
    const response = await request(`/scoped/units/${saved.id}/return`, scopedCookie);
    await status(response, 201);
    const receipt = await response.json() as ScopedEquipmentMovementReceiptDto;
    const movement = await applied(before, saved.id, 'return_to_storage', 'in_storage', scoped.id);
    assert.deepEqual(receipt, { id: saved.id, movementId: movement.id, status: 'in_storage' });
    const serialized = JSON.stringify(receipt);
    for (const privateValue of [saved.inventoryNumber, saved.serialNumber!, saved.notes!, catalog.notes!]) {
      assert.equal(serialized.includes(privateValue), false, 'Scoped write receipt must not disclose equipment-card fields');
    }
    await status(await request(`/units/${saved.id}`, scopedCookie, 'GET'), 403);
    await status(await request('/units', scopedCookie, 'GET'), 403);
    assert.equal(await prisma.userAccessRule.count({ where: { userId: scoped.id, actionCode: 'equipment.read', effect: 'allow' } }), 0);
  });

  await t.test('read/action/parent denies win over wrong state and do not disclose 409 or change data', async (suite) => {
    suite.after(reset);
    const storage = await unit('denied-unassigned-return');
    const assigned = await unit('denied-already-assigned', 'object');
    const rejected = async (path: string) => {
      const before = await capture();
      const response = await request(path);
      await status(response, 403);
      assert.doesNotMatch(await response.text(), /Only equipment currently|not assigned to a work scope|state changed|destination is read-only/);
      assert.deepEqual(await capture(), before);
    };
    await rule(manager.id, 'equipment.return', 'allow', [storage.id]);
    await rule(manager.id, 'equipment.assign_object', 'allow', [assigned.id]);
    await rule(manager.id, 'equipment.assign_order', 'allow', [assigned.id]);
    const readDeny = await rule(manager.id, 'equipment.read', 'deny', [storage.id, assigned.id]);
    await rejected(`/scoped/units/${storage.id}/return`);
    await rejected(`/scoped/units/${assigned.id}/objects/${object.id}/assign`);
    await rejected(`/scoped/units/${assigned.id}/one-time-orders/${order.id}/assign`);
    await prisma.userAccessRule.delete({ where: { id: readDeny.id } }); ruleIds.delete(readDeny.id);
    await rule(manager.id, 'objects.read', 'deny', [object.id]);
    await rejected(`/scoped/units/${assigned.id}/objects/${object.id}/assign`);
    await rejected(`/scoped/units/${assigned.id}/return`);
    await reset();
    await rule(manager.id, 'equipment.access', 'deny', [storage.id, assigned.id]);
    await rejected(`/scoped/units/${storage.id}/return`);
    await rejected(`/scoped/units/${assigned.id}/objects/${object.id}/assign`);
    await reset();
    await rule(manager.id, 'equipment.assign_object', 'deny', [assigned.id]);
    await rejected(`/scoped/units/${assigned.id}/objects/${object.id}/assign`);
  });
  assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: manager.id }, ...actorQuery }), manager);
  assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: scoped.id }, ...actorQuery }), scoped);
  // Main owns execution, typecheck and isolated schema disposal. No roles/read grants are fabricated.
});
