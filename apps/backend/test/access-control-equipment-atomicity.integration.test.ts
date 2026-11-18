import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { AuditService } from '../src/modules/audit/audit.service';
import type { EquipmentUnitResponseDto } from '../src/modules/equipment/dto/equipment-response.dto';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type AuditInput = Parameters<AuditService['writeAuditEvent']>[0];

test('equipment transactions roll back audit failures and selected read denies defeat mutation grants', async (t) => {
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
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id, actionCode: { startsWith: 'equipment.' } } }), 0);
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const marker = `acl-equipment-atomicity-${randomUUID()}`;
  const catalog = await prisma.equipmentCatalogItem.create({ data: {
    category: 'Atomicity fixture', name: marker, createdByUserId: founder.id,
  } });
  const unit = (label: string) => prisma.equipmentUnit.create({ data: {
    catalogItemId: catalog.id, inventoryNumber: `${marker}-${label}`, createdByUserId: founder.id,
  } });
  const ruleIds = new Set<string>();
  const rule = async (actionCode: string, effect: 'allow' | 'deny', selectedIds?: string[]) => {
    const saved = await prisma.userAccessRule.create({ data: {
      userId: actor.id, actionCode, effect, scope: selectedIds ? 'selected' : 'all', selectedIds: selectedIds ?? [],
    } });
    ruleIds.add(saved.id);
    return saved;
  };
  const removeRule = async (id: string) => {
    await prisma.userAccessRule.delete({ where: { id } });
    ruleIds.delete(id);
  };
  const resetRules = async () => { for (const id of [...ruleIds]) await removeRule(id); };
  const request = (path: string, method = 'GET', body?: unknown) => fetch(`${baseUrl}/api/v1/equipment${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const status = async (response: Response, expected: number) => {
    assert.equal(response.status, expected, await response.clone().text());
  };
  const read = async (id: string) => {
    const response = await request(`/units/${id}`);
    await status(response, 200);
    return await response.json() as EquipmentUnitResponseDto;
  };
  const capture = async () => {
    // Small isolated schema only. Whole equipment/audit snapshots also detect
    // leaked audit IDs and orphaned approvals after business rows roll back.
    const [catalogs, units, movements, approvals, audit, attachments] = await Promise.all([
      prisma.equipmentCatalogItem.findMany({ orderBy: { id: 'asc' } }),
      prisma.equipmentUnit.findMany({ orderBy: { id: 'asc' } }),
      prisma.equipmentMovement.findMany({ orderBy: { id: 'asc' } }),
      prisma.approvalRequest.findMany({ where: { sourceEntityType: 'equipment_movement' }, orderBy: { id: 'asc' } }),
      prisma.auditEvent.findMany({ where: { entityType: { in: ['equipment_catalog_item', 'equipment_unit', 'equipment_movement', 'approval_request'] } }, orderBy: { id: 'asc' } }),
      prisma.fileAttachment.findMany({ where: { entityType: 'equipment_movement' }, orderBy: { id: 'asc' } }),
    ]);
    return { catalogs, units, movements, approvals, audit, attachments };
  };
  const rejected = async (path: string, method: string, body?: unknown, expected = 403) => {
    const before = await capture();
    await status(await request(path, method, body), expected);
    assert.deepEqual(await capture(), before, 'Rejected requests leave equipment, approvals and audit unchanged');
  };
  const auditService = app.get(AuditService);
  const failAudit = async (
    related: (input: AuditInput, seen: AuditInput[]) => boolean,
    failingAction: string,
    expectedActions: string[],
    send: () => Promise<Response>,
  ) => {
    const before = await capture();
    const original = auditService.writeAuditEvent;
    const seen: AuditInput[] = [];
    let injected = 0;
    // Only this app instance is wrapped, only for this request. The real audit
    // insert executes first; no Prisma/transaction behavior is mocked.
    auditService.writeAuditEvent = async (...args: Parameters<AuditService['writeAuditEvent']>) => {
      const [input, database] = args;
      await original.apply(auditService, args);
      if (input.actorUserId !== actor.id || !related(input, seen)) return;
      assert.ok(database, 'Equipment must pass the transaction to its audit writer');
      assert.ok(await database.auditEvent.findFirst({ where: {
        entityType: input.entityType, entityId: input.entityId, action: input.action, actorUserId: actor.id,
      } }), 'Real audit row exists inside the transaction before the injected failure');
      seen.push(input);
      if (input.action === failingAction) {
        injected += 1;
        throw new Error('Controlled equipment audit failure after real insert');
      }
    };
    try {
      await status(await send(), 500);
      assert.equal(injected, 1, 'The intended audit failure, rather than an unrelated HTTP error, must be reached');
      assert.deepEqual(seen.map(({ action }) => action), expectedActions);
      assert.deepEqual(await capture(), before, 'Audit failure rolls back business rows, unit state, both audits and any approval');
    } finally {
      auditService.writeAuditEvent = original;
    }
  };
  const movementBody = (movementType: 'mark_broken' | 'writeoff') => ({ movementType, comment: marker });
  const movePath = (id: string) => `/units/${id}/movements`;
  const successfulMovement = async (id: string, kind: 'mark_broken' | 'writeoff') => {
    const before = await capture();
    const response = await request(movePath(id), 'POST', movementBody(kind));
    await status(response, 201);
    const result = await response.json() as { id: string; approvalRequest: { id: string } | null };
    const after = await capture();
    const movement = after.movements.find((row) => row.id === result.id)!;
    assert.ok(movement);
    assert.equal(movement.equipmentUnitId, id);
    assert.equal(movement.createdByUserId, actor.id);
    assert.equal(movement.movementType, kind);
    assert.equal(movement.fromStatus, 'in_storage');
    assert.equal(movement.toStatus, kind === 'writeoff' ? 'written_off' : 'broken');
    assert.equal(movement.status, kind === 'writeoff' ? 'pending_approval' : 'applied');
    assert.deepEqual(after.movements.filter((row) => row.id !== result.id), before.movements);
    const addedAudit = after.audit.filter((row) => !before.audit.some(({ id }) => id === row.id));
    assert.equal(addedAudit.length, kind === 'writeoff' ? 2 : 1);
    assert.ok(addedAudit.every((row) => row.actorUserId === actor.id));
    assert.equal(addedAudit.find((row) => row.entityType === 'equipment_movement')?.entityId, result.id);
    assert.equal(addedAudit.find((row) => row.entityType === 'equipment_movement')?.action, `equipment.${kind}`);
    assert.deepEqual(after.audit.filter((row) => !addedAudit.some(({ id }) => id === row.id)), before.audit);
    if (kind === 'writeoff') {
      assert.ok(result.approvalRequest);
      const approval = after.approvals.find((row) => row.id === result.approvalRequest!.id)!;
      assert.ok(approval);
      assert.equal(approval.sourceEntityId, result.id);
      assert.equal(approval.approvalType, 'equipment_writeoff_confirmation');
      assert.equal(approval.createdByUserId, actor.id);
      assert.equal(approval.status, 'pending');
      assert.equal(addedAudit.find((row) => row.entityType === 'approval_request')?.entityId, approval.id);
      assert.equal(addedAudit.find((row) => row.entityType === 'approval_request')?.action, 'approval.request.created');
      assert.deepEqual(after.approvals.filter((row) => row.id !== approval.id), before.approvals);
      assert.deepEqual(after.units, before.units, 'Pending writeoff does not apply to the unit');
    } else {
      assert.equal(result.approvalRequest, null);
      assert.deepEqual(after.approvals, before.approvals);
      const old = before.units.find((row) => row.id === id)!;
      const saved = after.units.find((row) => row.id === id)!;
      assert.deepEqual(saved, { ...old, status: 'broken', updatedAt: saved.updatedAt });
      assert.deepEqual(after.units.filter((row) => row.id !== id), before.units.filter((row) => row.id !== id));
    }
    assert.deepEqual(after.catalogs, before.catalogs);
    assert.deepEqual(after.attachments, before.attachments);
  };

  await t.test('catalog audit failure rolls back the model and audit; original HTTP request succeeds on retry', async (suite) => {
    suite.after(resetRules);
    await rule('equipment.catalog.create', 'allow');
    const body = { category: 'Atomicity fixture', name: `${marker}-created`, notes: marker };
    await failAudit((input) => input.action === 'equipment.catalog_item.created' &&
      (input.newValues as { name?: string })?.name === body.name,
    'equipment.catalog_item.created', ['equipment.catalog_item.created'], () => request('/catalog', 'POST', body));
    const before = await capture();
    const response = await request('/catalog', 'POST', body);
    await status(response, 201);
    const result = await response.json() as { id: string };
    const after = await capture();
    const saved = after.catalogs.find(({ id }) => id === result.id)!;
    assert.ok(saved);
    assert.equal(saved.name, body.name);
    assert.equal(saved.createdByUserId, actor.id);
    assert.deepEqual(after.catalogs.filter(({ id }) => id !== result.id), before.catalogs);
    const added = after.audit.filter((row) => !before.audit.some(({ id }) => id === row.id));
    assert.equal(added.length, 1);
    assert.equal(added[0].action, 'equipment.catalog_item.created');
    assert.equal(added[0].entityId, result.id);
    assert.equal(added[0].actorUserId, actor.id);
    assert.deepEqual(after.audit.filter(({ id }) => id !== added[0].id), before.audit);
    for (const key of ['units', 'movements', 'approvals', 'attachments'] as const) assert.deepEqual(after[key], before[key]);
  });

  await t.test('movement audit failure rolls back movement plus unit status and audit; retry applies once', async (suite) => {
    suite.after(resetRules);
    const a = await unit('movement-A');
    await unit('movement-control-B');
    await rule('equipment.broken', 'allow', [a.id]);
    await failAudit((input) => input.action === 'equipment.mark_broken' &&
      (input.newValues as { equipmentUnitId?: string })?.equipmentUnitId === a.id,
    'equipment.mark_broken', ['equipment.mark_broken'], () => request(movePath(a.id), 'POST', movementBody('mark_broken')));
    await successfulMovement(a.id, 'mark_broken');
  });

  await t.test('writeoff second audit failure rolls back movement, approval and both audit rows; retry creates one pending request', async (suite) => {
    suite.after(resetRules);
    const a = await unit('writeoff-A');
    await unit('writeoff-control-B');
    await rule('equipment.writeoff', 'allow', [a.id]);
    await failAudit((input, seen) => (input.action === 'equipment.writeoff' &&
      (input.newValues as { equipmentUnitId?: string })?.equipmentUnitId === a.id) ||
      (input.action === 'approval.request.created' && (input.newValues as { sourceEntityId?: string })?.sourceEntityId ===
        seen.find(({ action }) => action === 'equipment.writeoff')?.entityId),
    'approval.request.created', ['equipment.writeoff', 'approval.request.created'], () => request(movePath(a.id), 'POST', movementBody('writeoff')));
    await successfulMovement(a.id, 'writeoff');
    await rejected(movePath(a.id), 'POST', movementBody('writeoff'), 409);
  });

  await t.test('selected equipment.read deny defeats movement/writeoff/delete grants, preserves B and revokes live', async (suite) => {
    suite.after(resetRules);
    for (const operation of ['broken', 'writeoff', 'unit.delete'] as const) {
      const a = await unit(`read-deny-${operation}-A`);
      const b = await unit(`read-deny-${operation}-B`);
      const missingId = randomUUID();
      await rule(`equipment.${operation}`, 'allow', [a.id, b.id, missingId]);
      const deny = await rule('equipment.read', 'deny', [a.id, missingId]);
      const path = (id: string) => operation === 'unit.delete' ? `/units/${id}` : movePath(id);
      const body = operation === 'unit.delete' ? undefined : movementBody(operation === 'broken' ? 'mark_broken' : 'writeoff');
      const method = operation === 'unit.delete' ? 'DELETE' : 'POST';
      await rejected(`/units/${a.id}`, 'GET');
      await rejected(path(a.id), method, body);
      if (operation === 'unit.delete') await rejected(path(missingId), method); // Deny wins before lookup/404.
      const capability = operation === 'unit.delete' ? 'canDelete' : operation === 'broken' ? 'canMarkBroken' : 'canWriteoff';
      assert.equal((await read(b.id)).capabilities[capability], true);
      if (operation === 'unit.delete') {
        const before = await capture();
        const response = await request(path(b.id), method);
        await status(response, 200);
        assert.deepEqual(await response.json(), { id: b.id, mode: 'hard' });
        const after = await capture();
        assert.deepEqual(after.units, before.units.filter(({ id }) => id !== b.id));
        const added = after.audit.filter((row) => !before.audit.some(({ id }) => id === row.id));
        assert.equal(added.length, 1);
        assert.equal(added[0].entityId, b.id);
        assert.equal(added[0].action, 'equipment.unit.deleted_permanently');
        assert.equal(added[0].actorUserId, actor.id);
        assert.deepEqual(after.audit.filter(({ id }) => id !== added[0].id), before.audit);
        for (const key of ['catalogs', 'movements', 'approvals', 'attachments'] as const) assert.deepEqual(after[key], before[key]);
      } else await successfulMovement(b.id, operation === 'broken' ? 'mark_broken' : 'writeoff');
      await removeRule(deny.id);
      assert.equal((await read(a.id)).capabilities[capability], true, 'Original cookie sees removal of the read deny');
      assert.deepEqual(await prisma.equipmentUnit.findUniqueOrThrow({ where: { id: a.id } }), a);
      await resetRules();
    }
  });
  assert.deepEqual(await prisma.user.findUniqueOrThrow(actorQuery), actor, 'No role or legacy permission changes');
  // Main's runner executes and removes the isolated schema; no external DDL or
  // global audit triggers are needed for these controlled application failures.
});
