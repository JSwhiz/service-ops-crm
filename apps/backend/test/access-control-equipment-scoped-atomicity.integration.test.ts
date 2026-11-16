import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { AuditService } from '../src/modules/audit/audit.service';
import type { ScopedEquipmentMovementReceiptDto } from '../src/modules/equipment/dto/scoped-equipment-action.dto';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('scoped equipment HTTP actions atomically persist unit, movement and audit, and respect selected read denies', async (t) => {
  // Only main's sequential integration runner may execute this against its disposable schema.
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
  const auditService = app.get(AuditService);
  const originalWriteAuditEvent = auditService.writeAuditEvent;
  t.after(() => { auditService.writeAuditEvent = originalWriteAuditEvent; });

  const actorQuery = { where: { login: 'manager1' }, include: {
    roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    permissions: { include: { permission: true } },
  } } as const;
  const actor = await prisma.user.findUniqueOrThrow(actorQuery);
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  assert.deepEqual(actor.roles.map(({ role }) => role.code), ['manager']);
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id, actionCode: { startsWith: 'equipment.' } } }), 0);
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const marker = `scoped-equipment-atomicity-${randomUUID()}`;
  const object = await prisma.object.create({ data: {
    name: marker, address: 'Isolated scoped equipment fixture', status: 'active', createdByUserId: founder.id,
  } });
  const order = await prisma.oneTimeOrder.create({ data: {
    title: marker, executionAddress: 'Isolated order fixture', status: 'new', contactName: 'Fixture contact', createdByUserId: founder.id,
  } });
  await prisma.objectAssignment.create({ data: { objectId: object.id, userId: actor.id, assignmentRoleCode: 'manager' } });
  await prisma.oneTimeOrderAssignment.create({ data: { oneTimeOrderId: order.id, userId: actor.id, assignmentRoleCode: 'one_time_manager' } });
  const catalog = await prisma.equipmentCatalogItem.create({ data: {
    category: 'Atomicity acceptance', name: marker, createdByUserId: founder.id,
  } });

  const capture = async () => {
    const [units, movements, audit, approvals, attachments, objectRow, orderRow, objectAssignments, orderAssignments, inventory] = await Promise.all([
      prisma.equipmentUnit.findMany({ orderBy: { id: 'asc' } }),
      prisma.equipmentMovement.findMany({ orderBy: { id: 'asc' } }),
      prisma.auditEvent.findMany({ where: { entityType: { in: ['equipment_unit', 'equipment_movement', 'approval_request'] } }, orderBy: { id: 'asc' } }),
      prisma.approvalRequest.findMany({ where: { sourceEntityType: 'equipment_movement' }, orderBy: { id: 'asc' } }),
      prisma.fileAttachment.findMany({ where: { entityType: 'equipment_movement' }, orderBy: { id: 'asc' } }),
      prisma.object.findUniqueOrThrow({ where: { id: object.id } }),
      prisma.oneTimeOrder.findUniqueOrThrow({ where: { id: order.id } }),
      prisma.objectAssignment.findMany({ where: { objectId: object.id }, orderBy: { id: 'asc' } }),
      prisma.oneTimeOrderAssignment.findMany({ where: { oneTimeOrderId: order.id }, orderBy: { id: 'asc' } }),
      prisma.inventoryMovement.findMany({ orderBy: { id: 'asc' } }),
    ]);
    return { units, movements, audit, approvals, attachments, objectRow, orderRow, objectAssignments, orderAssignments, inventory };
  };
  const request = (path: string, comment: string) => fetch(`${baseUrl}/api/v1/equipment/scoped/units/${path}`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ comment }),
  });
  const expectStatus = async (response: Response, expected: number) => {
    assert.equal(response.status, expected, await response.clone().text());
  };
  const operations = [
    { label: 'assign-object', leaf: 'equipment.assign_object', movementType: 'issue_to_object', from: 'storage', toStatus: 'assigned_to_object', toObjectId: object.id, toOneTimeOrderId: null },
    { label: 'assign-order', leaf: 'equipment.assign_order', movementType: 'issue_to_one_time_order', from: 'storage', toStatus: 'assigned_to_one_time_order', toObjectId: null, toOneTimeOrderId: order.id },
    { label: 'return-object', leaf: 'equipment.return', movementType: 'return_to_storage', from: 'object', toStatus: 'in_storage', toObjectId: null, toOneTimeOrderId: null },
    { label: 'return-order', leaf: 'equipment.return', movementType: 'return_to_storage', from: 'order', toStatus: 'in_storage', toObjectId: null, toOneTimeOrderId: null },
  ] as const;

  for (const operation of operations) {
    await t.test(`${operation.label}: selected read deny, unaffected control, audit failure rollback and successful retry`, async (suite) => {
      const unit = async (label: string) => {
        const saved = await prisma.equipmentUnit.create({ data: {
          catalogItemId: catalog.id, inventoryNumber: `${marker}-${operation.label}-${label}`, createdByUserId: founder.id,
          status: operation.from === 'object' ? 'assigned_to_object' : operation.from === 'order' ? 'assigned_to_one_time_order' : 'in_storage',
          currentObjectId: operation.from === 'object' ? object.id : null,
          currentOneTimeOrderId: operation.from === 'order' ? order.id : null,
        } });
        if (operation.from !== 'storage') await prisma.equipmentMovement.create({ data: {
          equipmentUnitId: saved.id, movementType: operation.from === 'object' ? 'issue_to_object' : 'issue_to_one_time_order',
          status: 'applied', fromStatus: 'in_storage', toStatus: saved.status,
          toObjectId: saved.currentObjectId, toOneTimeOrderId: saved.currentOneTimeOrderId,
          createdByUserId: founder.id, createdAt: new Date('2025-01-01T00:00:00Z'),
        } });
        return saved;
      };
      const a = await unit('A');
      const b = await unit('B');
      const leaf = await prisma.userAccessRule.create({ data: {
        userId: actor.id, actionCode: operation.leaf, effect: 'allow', scope: 'selected', selectedIds: [a.id, b.id],
      } });
      suite.after(async () => { await prisma.userAccessRule.deleteMany({ where: { id: leaf.id } }); });
      // Deliberately do not add a positive equipment.read rule: leaf grants remain independent.
      assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id, actionCode: 'equipment.read', effect: 'allow' } }), 0);
      const path = (id: string) => operation.movementType === 'issue_to_object'
        ? `${id}/objects/${object.id}/assign`
        : operation.movementType === 'issue_to_one_time_order'
          ? `${id}/one-time-orders/${order.id}/assign` : `${id}/return`;
      const comment = `  ${marker}-${operation.label}  `;

      const applied = async (id: string) => {
        const before = await capture();
        const oldUnit = before.units.find((row) => row.id === id)!;
        const response = await request(path(id), comment);
        await expectStatus(response, 201);
        const result = await response.json() as ScopedEquipmentMovementReceiptDto;
        assert.equal(result.id, id);
        assert.equal(result.status, operation.toStatus);
        const after = await capture();
        const added = after.movements.filter((row) => !before.movements.some(({ id }) => id === row.id));
        assert.equal(added.length, 1, 'Exactly one applied movement per successful HTTP action');
        const movement = added[0]!;
        assert.deepEqual(result, { id, movementId: movement.id, status: operation.toStatus }, 'Scoped response contains only the persisted operation receipt');
        assert.deepEqual(movement, {
          id: movement.id, equipmentUnitId: id, movementType: operation.movementType, status: 'applied',
          fromStatus: oldUnit.status, toStatus: operation.toStatus,
          fromObjectId: oldUnit.currentObjectId, fromOneTimeOrderId: oldUnit.currentOneTimeOrderId,
          toObjectId: operation.toObjectId, toOneTimeOrderId: operation.toOneTimeOrderId,
          comment: comment.trim(), createdByUserId: actor.id, createdAt: movement.createdAt,
        });
        assert.deepEqual(after.movements.filter((row) => row.id !== movement.id), before.movements);
        const saved = after.units.find((row) => row.id === id)!;
        assert.deepEqual(saved, { ...oldUnit, status: operation.toStatus, currentObjectId: operation.toObjectId,
          currentOneTimeOrderId: operation.toOneTimeOrderId, updatedAt: saved.updatedAt });
        assert.deepEqual(after.units.filter((row) => row.id !== id), before.units.filter((row) => row.id !== id));
        const events = after.audit.filter((row) => !before.audit.some(({ id }) => id === row.id));
        assert.equal(events.length, 1, 'Exactly one audit, without a duplicate from the failed attempt');
        const event = events[0]!;
        assert.equal(event.entityType, 'equipment_movement');
        assert.equal(event.entityId, movement.id);
        assert.equal(event.actorUserId, actor.id);
        assert.equal(event.action, `equipment.${operation.movementType}.scoped_manager`);
        assert.deepEqual(event.newValues, {
          equipmentUnitId: id, toStatus: operation.toStatus,
          toObjectId: operation.toObjectId, toOneTimeOrderId: operation.toOneTimeOrderId,
        });
        assert.deepEqual(after.audit.filter((row) => row.id !== event.id), before.audit);
        for (const key of ['approvals', 'attachments', 'objectRow', 'orderRow', 'objectAssignments', 'orderAssignments', 'inventory'] as const) {
          assert.deepEqual(after[key], before[key], 'No unrelated scope, approval, attachment or inventory effects');
        }
      };

      const denied = await prisma.userAccessRule.create({ data: {
        userId: actor.id, actionCode: 'equipment.read', effect: 'deny', scope: 'selected', selectedIds: [a.id],
      } });
      suite.after(async () => { await prisma.userAccessRule.deleteMany({ where: { id: denied.id } }); });
      const beforeDenied = await capture();
      await expectStatus(await request(path(a.id), comment), 403);
      assert.deepEqual(await capture(), beforeDenied, 'Explicit selected read deny must precede every business write');
      await applied(b.id); // Same cookie and leaf grant, outside the selected deny.
      await prisma.userAccessRule.delete({ where: { id: denied.id } });

      const beforeFailure = await capture();
      let attempted = 0;
      auditService.writeAuditEvent = async (...args: Parameters<AuditService['writeAuditEvent']>) => {
        const values = args[0].newValues as { equipmentUnitId?: unknown } | null | undefined;
        if (args[0].action === `equipment.${operation.movementType}.scoped_manager` &&
            values?.equipmentUnitId === a.id) {
          attempted += 1;
          assert.ok(args[1], 'Scoped equipment must pass its transaction to AuditService');
          // Fail after the actual audit insert, proving that the audit itself rolls back too.
          await originalWriteAuditEvent.apply(auditService, args);
          throw new Error('Controlled scoped equipment audit failure in isolated acceptance');
        }
        return originalWriteAuditEvent.apply(auditService, args);
      };
      try {
        await expectStatus(await request(path(a.id), comment), 500);
        assert.equal(attempted, 1, 'The failure must reach the real scoped movement audit');
        assert.deepEqual(await capture(), beforeFailure, 'Unit, movement and inserted audit must all roll back');
      } finally {
        auditService.writeAuditEvent = originalWriteAuditEvent;
      }
      await applied(a.id);
    });
  }
  assert.deepEqual(await prisma.user.findUniqueOrThrow(actorQuery), actor, 'No actor, role or legacy permission changes');
  // The isolated integration runner owns fixture/schema disposal; no shared DB cleanup is performed here.
});
