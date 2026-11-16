import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { EquipmentUnitResponseDto } from '../src/modules/equipment/dto/equipment-response.dto';
import { getAccessAction } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('equipment assignment/return/lost/writeoff personal grants preserve scope and approval boundaries', async (t) => {
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
  const permissions = [...actor.permissions.map(({ permission }) => permission.code),
    ...actor.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code))];
  assert.equal(permissions.includes('approval.resolve_object_change'), false);
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id, actionCode: { startsWith: 'equipment.' } } }), 0);
  // All ACL transitions below use this one seeded actor and original cookie.
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const marker = `acl-equipment-movements-${randomUUID()}`;
  const objects: Array<{ id: string }> = [];
  for (const label of ['source', 'destination']) objects.push(await prisma.object.create({ data: {
    name: `${marker}-${label}`, address: 'Isolated equipment fixture', status: 'active', createdByUserId: founder.id,
  } }));
  const [source, destination] = objects;
  const order = await prisma.oneTimeOrder.create({ data: {
    title: `${marker}-order`, executionAddress: 'Isolated order fixture', status: 'new', contactName: 'Fixture contact', createdByUserId: founder.id,
  } });
  const catalog = await prisma.equipmentCatalogItem.create({ data: {
    category: 'Acceptance fixture', name: marker, createdByUserId: founder.id,
  } });
  const unit = async (label: string, assigned = false) => {
    const saved = await prisma.equipmentUnit.create({ data: {
      catalogItemId: catalog.id, inventoryNumber: `${marker}-${label}`, createdByUserId: founder.id,
      status: assigned ? 'assigned_to_object' : 'in_storage', currentObjectId: assigned ? source.id : null,
    } });
    if (assigned) await prisma.equipmentMovement.create({ data: {
      equipmentUnitId: saved.id, movementType: 'issue_to_object', status: 'applied', fromStatus: 'in_storage',
      toStatus: 'assigned_to_object', toObjectId: source.id, createdByUserId: founder.id, createdAt: new Date('2025-01-01T00:00:00Z'),
    } });
    return saved;
  };
  const ruleIds = new Set<string>();
  const rule = async (actionCode: string, effect: 'allow' | 'deny', selectedIds: string[]) => {
    const saved = await prisma.userAccessRule.create({ data: { userId: actor.id, actionCode, effect, scope: 'selected', selectedIds } });
    ruleIds.add(saved.id);
    return saved;
  };
  const removeRule = async (id: string) => {
    await prisma.userAccessRule.delete({ where: { id } });
    ruleIds.delete(id);
  };
  const resetRules = async () => { for (const id of [...ruleIds]) await removeRule(id); };
  const request = (path: string, body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const status = async (response: Response, expected: number) => {
    assert.equal(response.status, expected, await response.clone().text());
  };
  const read = async (id: string) => {
    const response = await request(`/equipment/units/${id}`);
    await status(response, 200);
    return await response.json() as EquipmentUnitResponseDto;
  };
  const capture = async () => {
    // Only the local isolated schema: capture existing equipment/history too,
    // including approval audit so failed requests cannot leave hidden effects.
    const [units, movements, audit, approvals, attachments, objectRows, orderRow, objectAssignments, orderAssignments, inventory] = await Promise.all([
      prisma.equipmentUnit.findMany({ orderBy: { id: 'asc' } }),
      prisma.equipmentMovement.findMany({ orderBy: { id: 'asc' } }),
      prisma.auditEvent.findMany({ where: { entityType: { in: ['equipment_unit', 'equipment_movement', 'approval_request'] } }, orderBy: { id: 'asc' } }),
      prisma.approvalRequest.findMany({ where: { sourceEntityType: 'equipment_movement' }, orderBy: { id: 'asc' } }),
      prisma.fileAttachment.findMany({ where: { entityType: 'equipment_movement' }, orderBy: { id: 'asc' } }),
      prisma.object.findMany({ where: { id: { in: objects.map(({ id }) => id) } }, orderBy: { id: 'asc' } }),
      prisma.oneTimeOrder.findUniqueOrThrow({ where: { id: order.id } }),
      prisma.objectAssignment.findMany({ where: { objectId: { in: objects.map(({ id }) => id) } }, orderBy: { id: 'asc' } }),
      prisma.oneTimeOrderAssignment.findMany({ where: { oneTimeOrderId: order.id }, orderBy: { id: 'asc' } }),
      prisma.inventoryMovement.findMany({ orderBy: { id: 'asc' } }),
    ]);
    return { units, movements, audit, approvals, attachments, objectRows, orderRow, objectAssignments, orderAssignments, inventory };
  };
  const rejected = async (path: string, body: unknown, expected = 403) => {
    const before = await capture();
    await status(await request(path, body), expected);
    assert.deepEqual(await capture(), before, `${path}: no unauthorized state, history, audit or approval changes`);
  };
  const movePath = (id: string) => `/equipment/units/${id}/movements`;
  const applied = async (id: string, body: { movementType: string; toObjectId?: string; toOneTimeOrderId?: string; comment: string }, toStatus: string, pending = false) => {
    const before = await capture();
    const old = before.units.find((row) => row.id === id)!;
    const response = await request(movePath(id), body);
    await status(response, 201);
    const result = await response.json() as { id: string; status: string; approvalRequest: { id: string } | null };
    const after = await capture();
    const created = after.movements.filter((row) => !before.movements.some(({ id }) => id === row.id));
    assert.equal(created.length, 1);
    const movement = created[0];
    assert.equal(movement.id, result.id);
    assert.equal(movement.equipmentUnitId, id);
    assert.equal(movement.createdByUserId, actor.id);
    assert.equal(movement.movementType, body.movementType);
    assert.equal(movement.fromStatus, old.status);
    assert.equal(movement.fromObjectId, old.currentObjectId);
    assert.equal(movement.fromOneTimeOrderId, old.currentOneTimeOrderId);
    assert.equal(movement.toStatus, toStatus);
    assert.equal(movement.toObjectId, body.toObjectId ?? null);
    assert.equal(movement.toOneTimeOrderId, body.toOneTimeOrderId ?? null);
    assert.equal(movement.comment, body.comment);
    assert.equal(movement.status, pending ? 'pending_approval' : 'applied');
    assert.equal(result.status, movement.status);
    assert.deepEqual(after.movements.filter(({ id }) => id !== movement.id), before.movements);
    const saved = after.units.find((row) => row.id === id)!;
    if (pending) assert.deepEqual(after.units, before.units, 'A writeoff request must not apply the writeoff');
    else {
      assert.deepEqual(saved, { ...old, status: toStatus, currentObjectId: body.toObjectId ?? null,
        currentOneTimeOrderId: body.toOneTimeOrderId ?? null, updatedAt: saved.updatedAt });
      assert.deepEqual(after.units.filter((row) => row.id !== id), before.units.filter((row) => row.id !== id));
    }
    const newAudit = after.audit.filter((row) => !before.audit.some(({ id }) => id === row.id));
    assert.equal(newAudit.length, pending ? 2 : 1);
    const event = newAudit.find((row) => row.entityType === 'equipment_movement')!;
    assert.equal(event.entityId, movement.id);
    assert.equal(event.actorUserId, actor.id);
    assert.equal(event.action, `equipment.${body.movementType}`);
    const payload = event.newValues as { equipmentUnitId: string; toStatus: string };
    assert.equal(payload.equipmentUnitId, id);
    assert.equal(payload.toStatus, toStatus);
    assert.deepEqual(after.audit.filter((row) => !newAudit.some(({ id }) => id === row.id)), before.audit);
    if (pending) {
      assert.ok(result.approvalRequest);
      const added = after.approvals.filter((row) => !before.approvals.some(({ id }) => id === row.id));
      assert.equal(added.length, 1);
      const approval = added[0];
      assert.equal(approval.id, result.approvalRequest.id);
      assert.equal(approval.approvalType, 'equipment_writeoff_confirmation');
      assert.equal(approval.sourceEntityId, movement.id);
      assert.equal(approval.createdByUserId, actor.id);
      assert.equal(approval.status, 'pending');
      assert.equal(approval.resolvedByUserId, null);
      assert.deepEqual(after.approvals.filter(({ id }) => id !== approval.id), before.approvals);
      const approvalAudit = newAudit.find((row) => row.entityType === 'approval_request')!;
      assert.equal(approvalAudit.entityId, approval.id);
      assert.equal(approvalAudit.actorUserId, actor.id);
      assert.equal(approvalAudit.action, 'approval.request.created');
    } else {
      assert.equal(result.approvalRequest, null);
      assert.deepEqual(after.approvals, before.approvals);
    }
    for (const key of ['attachments', 'objectRows', 'orderRow', 'objectAssignments', 'orderAssignments', 'inventory'] as const)
      assert.deepEqual(after[key], before[key], 'Equipment actions do not mutate work scope, assignments, inventory or money');
    return result;
  };

  const cases = [
    { leaf: 'assign_object', movementType: 'issue_to_object', toStatus: 'assigned_to_object', capability: 'canAssignToObject', assigned: false },
    { leaf: 'assign_order', movementType: 'issue_to_one_time_order', toStatus: 'assigned_to_one_time_order', capability: 'canAssignToOneTimeOrder', assigned: false },
    { leaf: 'return', movementType: 'return_to_storage', toStatus: 'in_storage', capability: 'canReturn', assigned: true },
    { leaf: 'lost', movementType: 'mark_lost', toStatus: 'lost', capability: 'canMarkLost', assigned: true },
    { leaf: 'writeoff', movementType: 'writeoff', toStatus: 'written_off', capability: 'canWriteoff', assigned: true },
  ] as const;
  for (const operation of cases) {
    await t.test(`equipment.${operation.leaf}: selected A/control B, deny/default/revoke, parents and persisted effects`, async (suite) => {
      suite.after(resetRules);
      const a = await unit(`${operation.leaf}-A`, operation.assigned);
      const b = await unit(`${operation.leaf}-B`, operation.assigned);
      const body = { movementType: operation.movementType, comment: `${marker}-${operation.leaf}`,
        ...(operation.leaf === 'assign_object' ? { toObjectId: destination.id } : {}),
        ...(operation.leaf === 'assign_order' ? { toOneTimeOrderId: order.id } : {}) };
      for (const person of [a, b]) {
        assert.equal((await read(person.id)).capabilities[operation.capability], false);
        await rejected(movePath(person.id), body);
      }
      let allow = await rule(`equipment.${operation.leaf}`, 'allow', [a.id]);
      const view = await read(a.id);
      assert.equal(view.capabilities[operation.capability], true);
      assert.equal(view.capabilities.canCreateMovement, true);
      for (const other of cases) if (other.leaf !== operation.leaf) assert.equal(view.capabilities[other.capability], false);
      assert.equal(view.capabilities.canDelete, false);
      assert.equal((await read(b.id)).capabilities[operation.capability], false);
      await rejected(movePath(b.id), body);
      await prisma.userAccessRule.update({ where: { id: allow.id }, data: { effect: 'deny' } });
      assert.equal((await read(a.id)).capabilities[operation.capability], false);
      await rejected(movePath(a.id), body);
      await removeRule(allow.id);
      await rejected(movePath(a.id), body);
      allow = await rule(`equipment.${operation.leaf}`, 'allow', [a.id]);
      const parent = await rule('equipment.access', 'deny', [a.id]);
      await rejected(movePath(a.id), body);
      await read(b.id);
      await removeRule(parent.id);
      const deniedTarget = operation.leaf === 'assign_order' ? order.id : operation.assigned ? source.id : destination.id;
      const workDeny = await rule(operation.leaf === 'assign_order' ? 'one_time_orders.read' : 'objects.read', 'deny', [deniedTarget]);
      await rejected(movePath(a.id), body);
      await removeRule(workDeny.id);
      const result = await applied(a.id, body, operation.toStatus, operation.leaf === 'writeoff');
      if (operation.leaf === 'writeoff') {
        await rejected(movePath(a.id), body, 409); // One pending request per unit.
        assert.ok(result.approvalRequest);
        await rejected(`/approvals/${result.approvalRequest.id}/approve`, {});
        await rejected(`/approvals/${result.approvalRequest.id}/reject`, { comment: 'No approval authority from a writeoff leaf' });
      }
      await removeRule(allow.id);
      assert.equal((await read(a.id)).capabilities[operation.capability], false);
      await rejected(movePath(a.id), body); // Revoke must win before replay/domain checks.
      await rejected(movePath(b.id), body);
      await resetRules();
    });
  }

  await t.test('equipment.move is unsupported; relocation requires actual issue/return grants and both object deny gates', async (suite) => {
    suite.after(resetRules);
    const definition = getAccessAction('equipment.move');
    assert.equal(definition?.manageable, false);
    assert.equal(definition?.constraint, 'unsupported_standalone_operation');
    const a = await unit('relocate-A', true);
    const b = await unit('relocate-B', true);
    const issue = { movementType: 'issue_to_object', toObjectId: destination.id, comment: 'Relocation through the actual issue action' };
    const returned = { movementType: 'return_to_storage', comment: 'Return after relocation through the actual return action' };
    const moveOnly = await rule('equipment.move', 'allow', [a.id]);
    const view = await read(a.id);
    assert.equal(view.capabilities.canMove, false);
    assert.equal(view.capabilities.canAssignToObject, false);
    assert.equal(view.capabilities.canReturn, false);
    await rejected(movePath(a.id), issue);
    await rejected(movePath(a.id), returned);
    await rejected(movePath(a.id), { movementType: 'move', comment: 'No invented movement endpoint or type' }, 400);
    await removeRule(moveOnly.id);
    const issueGrant = await rule('equipment.assign_object', 'allow', [a.id]);
    for (const object of objects) {
      const deny = await rule('objects.read', 'deny', [object.id]);
      await rejected(movePath(a.id), issue);
      await removeRule(deny.id);
    }
    await rejected(movePath(b.id), issue);
    await applied(a.id, issue, 'assigned_to_object');
    await removeRule(issueGrant.id);
    await rejected(movePath(a.id), issue);
    await rejected(movePath(a.id), returned);
    const returnGrant = await rule('equipment.return', 'allow', [a.id]);
    await rejected(movePath(b.id), returned);
    await applied(a.id, returned, 'in_storage');
    await removeRule(returnGrant.id);
    await rejected(movePath(a.id), returned);
    const control = await prisma.equipmentUnit.findUniqueOrThrow({ where: { id: b.id } });
    assert.deepEqual(control, b);
    await resetRules();
  });
  assert.deepEqual(await prisma.user.findUniqueOrThrow(actorQuery), actor, 'No role or legacy permission changes');
  assert.equal(await prisma.objectAssignment.count({ where: { objectId: { in: objects.map(({ id }) => id) }, userId: actor.id } }), 0);
  assert.equal(await prisma.oneTimeOrderAssignment.count({ where: { oneTimeOrderId: order.id, userId: actor.id } }), 0);
  // Only main's sequential runner executes and drops these isolated fixtures.
});
