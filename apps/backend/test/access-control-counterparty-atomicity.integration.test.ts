import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient, type Prisma } from '@prisma/client';

import { AuditService } from '../src/modules/audit/audit.service';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('counterparty HTTP mutations roll back business state and both audit stores on controlled failures', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  let restoreReadFixture = async (): Promise<void> => {};
  const ruleIds = new Set<string>();
  t.after(async () => {
    try {
      await restoreReadFixture();
      await prisma.userAccessRule.deleteMany({ where: { id: { in: [...ruleIds] } } });
    } finally {
      try { await closeApp?.(); } finally { await prisma.$disconnect(); }
    }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const actor = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const marker = `counterparty-atomic-${randomUUID()}`;
  let sequence = 0;
  const input = () => ({ name: `${marker}-${++sequence}`, legalName: 'Atomic legal name', notes: 'Atomic notes' });
  const request = (path: string, method: string, body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const rule = async (actionCode: string, effect: 'allow' | 'deny', selectedIds?: string[]) => {
    const row = await prisma.userAccessRule.create({ data: {
      userId: actor.id, actionCode, effect, scope: selectedIds ? 'selected' : 'all', selectedIds: selectedIds ?? [],
    } });
    ruleIds.add(row.id);
    return row;
  };
  const removeRule = async (id: string) => {
    await prisma.userAccessRule.delete({ where: { id } });
    ruleIds.delete(id);
  };
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id, actionCode: { startsWith: 'counterparties.' } } }), 0);
  for (const suffix of ['create', 'update', 'archive', 'objects.link']) await rule(`counterparties.${suffix}`, 'allow');

  // These fixtures retain the canonical manager role and its real object assignment.
  const fixture = async (linked: boolean) => {
    const counterparty = await prisma.counterparty.create({ data: { ...input(), createdByUserId: founder.id } });
    const object = await prisma.object.create({ data: {
      name: `${marker}-object-${++sequence}`, address: 'Isolated atomicity fixture', status: 'active',
      createdByUserId: founder.id, counterpartyId: linked ? counterparty.id : null,
      masterForCounterpartyId: linked ? counterparty.id : null,
      assignments: { create: { userId: actor.id, assignmentRoleCode: 'manager', isActive: true } },
    } });
    return { counterparty, object };
  };
  const capture = async () => ({
    counterparties: await prisma.counterparty.findMany({ where: { name: { startsWith: marker } }, orderBy: { id: 'asc' } }),
    objects: await prisma.object.findMany({ where: { name: { startsWith: marker } }, orderBy: { id: 'asc' } }),
    assignments: await prisma.objectAssignment.findMany({ where: { object: { name: { startsWith: marker } } }, orderBy: { id: 'asc' } }),
    // Include all counterparty events: a failed create has a previously unknown ID.
    events: await prisma.auditEvent.findMany({ where: { OR: [
      { entityType: 'counterparty' },
      { entityType: 'object', actorUserId: actor.id },
    ] }, orderBy: { id: 'asc' } }),
    objectLogs: await prisma.objectAuditLog.findMany({ where: { object: { name: { startsWith: marker } } }, orderBy: { id: 'asc' } }),
    movements: await prisma.inventoryMovement.findMany({ where: { relatedObject: { name: { startsWith: marker } } }, orderBy: { id: 'asc' } }),
  });
  const audit = app.get(AuditService);
  const originalEvent = audit.writeAuditEvent;
  const originalObjectLog = audit.writeObjectAuditLog;
  t.after(() => { audit.writeAuditEvent = originalEvent; audit.writeObjectAuditLog = originalObjectLog; });

  for (const operation of ['create', 'update', 'archive', 'link', 'unlink'] as const) {
    const boundaries = operation === 'link' || operation === 'unlink' ? ['event', 'objectLog'] as const : ['event'] as const;
    for (const boundary of boundaries) {
      await t.test(`${operation}: failure after real ${boundary} insert rolls back; explicit retry commits once`, async () => {
        const { counterparty, object } = await fixture(operation === 'unlink');
        const createPayload = input();
        const body = operation === 'create' ? createPayload : operation === 'update' ? { notes: `${marker}-updated-${++sequence}` } : undefined;
        const path = operation === 'create' ? '/counterparties'
          : operation === 'update' ? `/counterparties/${counterparty.id}`
          : operation === 'archive' ? `/counterparties/${counterparty.id}/archive`
          : `/counterparties/${counterparty.id}/objects/${object.id}`;
        const method = operation === 'update' ? 'PATCH' : operation === 'unlink' ? 'DELETE' : 'POST';
        const successStatus = operation === 'update' || operation === 'unlink' ? 200 : 201;
        const action = `counterparty.${operation === 'create' ? 'created' : operation === 'update' ? 'updated'
          : operation === 'archive' ? 'archived' : operation === 'link' ? 'object_linked' : 'object_unlinked'}`;
        const before = await capture();
        let injected = false;
        let insertedId: string | undefined;
        audit.writeAuditEvent = async (...args: Parameters<AuditService['writeAuditEvent']>) => {
          await originalEvent.apply(audit, args);
          const [params, tx] = args;
          if (boundary !== 'event' || params.actorUserId !== actor.id || params.entityType !== 'counterparty' || params.action !== action) return;
          assert.ok(tx, 'Counterparty audit must share the business transaction');
          assert.equal(await tx.auditEvent.count({ where: { entityId: params.entityId, action } }), 1,
            'Inject only after the real audit INSERT succeeds');
          insertedId = params.entityId;
          injected = true;
          throw new Error(`Controlled ${operation} audit failure`);
        };
        audit.writeObjectAuditLog = async (...args: Parameters<AuditService['writeObjectAuditLog']>) => {
          await originalObjectLog.apply(audit, args);
          const [params, tx] = args;
          if (boundary !== 'objectLog' || params.objectId !== object.id || params.actorUserId !== actor.id) return;
          assert.ok(tx, 'Object log and generic object audit must share the counterparty transaction');
          assert.equal(await tx.objectAuditLog.count({ where: { objectId: object.id, actionCode: 'object.counterparty_changed' } }), 1);
          assert.equal(await tx.auditEvent.count({ where: { entityType: 'object', entityId: object.id, action: 'object.counterparty_changed' } }), 1);
          assert.ok('object' in tx, 'Audit boundary receives the real transaction client');
          const transaction = tx as Prisma.TransactionClient;
          assert.equal((await transaction.object.findUniqueOrThrow({ where: { id: object.id } })).counterpartyId,
            operation === 'link' ? counterparty.id : null, 'The business write must have reached this same transaction');
          injected = true;
          throw new Error(`Controlled ${operation} object-log failure after both real INSERTs`);
        };
        let failed: Response;
        try { failed = await request(path, method, body); } finally {
          audit.writeAuditEvent = originalEvent;
          audit.writeObjectAuditLog = originalObjectLog;
        }
        const errorBody = await failed.text();
        assert.equal(failed.status, 500, errorBody);
        assert.equal(injected, true, 'An unrelated 500 or timeout cannot satisfy the rollback test');
        assert.deepEqual(await capture(), before, 'Rollback must restore fields, status, link/master, assignments, inventory and both audit stores');
        if (operation === 'create') {
          assert.ok(insertedId);
          assert.equal(await prisma.counterparty.count({ where: { id: insertedId } }), 0);
        }

        const response = await request(path, method, body);
        assert.equal(response.status, successStatus, await response.clone().text());
        const result = await response.json() as { id: string; status: string; notes: string | null };
        const after = await capture();
        const targetId = operation === 'create' ? result.id : counterparty.id;
        assert.equal(result.id, targetId);
        const stored = after.counterparties.find((row) => row.id === targetId)!;
        assert.ok(stored);
        assert.equal(result.status, stored.status);
        assert.equal(result.notes, stored.notes);
        if (operation === 'create') {
          assert.equal(after.counterparties.length, before.counterparties.length + 1);
          assert.equal(stored.name, createPayload.name);
          assert.equal(stored.createdByUserId, actor.id);
          assert.deepEqual(after.counterparties.filter((row) => row.id !== targetId), before.counterparties);
        } else if (operation === 'update' || operation === 'archive') {
          assert.deepEqual(stored, { ...counterparty, updatedAt: stored.updatedAt,
            ...(operation === 'update' ? { notes: body!.notes } : { status: 'archived' }) });
          assert.deepEqual(after.counterparties.filter((row) => row.id !== targetId), before.counterparties.filter((row) => row.id !== targetId));
        } else assert.deepEqual(after.counterparties, before.counterparties);
        const objectMutation = operation === 'link' || operation === 'unlink';
        if (objectMutation) {
          const changed = after.objects.find((row) => row.id === object.id)!;
          assert.deepEqual(changed, { ...object, updatedAt: changed.updatedAt,
            counterpartyId: operation === 'link' ? counterparty.id : null, masterForCounterpartyId: null });
          assert.deepEqual(after.objects.filter((row) => row.id !== object.id), before.objects.filter((row) => row.id !== object.id));
        } else assert.deepEqual(after.objects, before.objects);
        for (const key of ['assignments', 'movements'] as const) assert.deepEqual(after[key], before[key]);
        const added = after.events.filter((row) => !before.events.some((old) => old.id === row.id));
        const expected = [`counterparty:${targetId}:${action}`];
        if (objectMutation) expected.push(`object:${object.id}:object.counterparty_changed`);
        if (operation === 'unlink') expected.push(`counterparty:${counterparty.id}:counterparty.master_object_cleared`);
        assert.deepEqual(added.map((row) => `${row.entityType}:${row.entityId}:${row.action}`).sort(), expected.sort());
        assert.ok(added.every((row) => row.actorUserId === actor.id));
        const logs = after.objectLogs.filter((row) => !before.objectLogs.some((old) => old.id === row.id));
        assert.equal(logs.length, objectMutation ? 1 : 0);
        if (objectMutation) {
          assert.equal(logs[0].objectId, object.id);
          assert.equal(logs[0].actorUserId, actor.id);
          assert.equal(logs[0].actionCode, 'object.counterparty_changed');
          assert.deepEqual(logs[0].payload, { oldCounterpartyId: operation === 'unlink' ? counterparty.id : null,
            newCounterpartyId: operation === 'link' ? counterparty.id : null });
        }
      });
    }
  }

  await t.test('create all plus read deny all returns 403 with zero business/audit effects', async () => {
    const deny = await rule('counterparties.read', 'deny');
    try {
      const before = await capture();
      const response = await request('/counterparties', 'POST', input());
      assert.equal(response.status, 403, await response.text());
      assert.deepEqual(await capture(), before);
    } finally { await removeRule(deny.id); }
  });

  await t.test('selected read of existing A cannot read a new ID: create rolls back before audit, then all-read retry succeeds', async () => {
    // All seeded canonical roles inherit view. Remove only its actual permission
    // sources in this disposable schema; do not invent a role or treat an additive
    // selected allow as a restriction of an otherwise globally readable actor.
    const memberships = await prisma.userRole.findMany({ where: { userId: actor.id }, orderBy: { id: 'asc' } });
    const roles = await prisma.role.findMany({ where: { id: { in: memberships.map((row) => row.roleId) } } });
    assert.deepEqual(roles.map((row) => row.code), ['manager']);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'counterparties.view' } });
    const inherited = await prisma.rolePermission.findMany({ where: { roleId: { in: roles.map((row) => row.id) }, permissionId: permission.id }, orderBy: { id: 'asc' } });
    const direct = await prisma.userPermission.findMany({ where: { userId: actor.id, permissionId: permission.id }, orderBy: { id: 'asc' } });
    assert.ok(inherited.length > 0);
    restoreReadFixture = async () => {
      await prisma.$transaction([
        prisma.rolePermission.createMany({ data: inherited, skipDuplicates: true }),
        prisma.userPermission.createMany({ data: direct, skipDuplicates: true }),
      ]);
      assert.deepEqual(await prisma.rolePermission.findMany({ where: { roleId: { in: roles.map((row) => row.id) }, permissionId: permission.id }, orderBy: { id: 'asc' } }), inherited);
      assert.deepEqual(await prisma.userPermission.findMany({ where: { userId: actor.id, permissionId: permission.id }, orderBy: { id: 'asc' } }), direct);
      assert.deepEqual(await prisma.userRole.findMany({ where: { userId: actor.id }, orderBy: { id: 'asc' } }), memberships);
    };
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { id: { in: inherited.map((row) => row.id) } } }),
      prisma.userPermission.deleteMany({ where: { id: { in: direct.map((row) => row.id) } } }),
    ]);
    const { counterparty: a } = await fixture(false);
    const { counterparty: b } = await fixture(false);
    const selected = await rule('counterparties.read', 'allow', [a.id]);
    let auditCalls = 0;
    try {
      const readable = await request(`/counterparties/${a.id}`, 'GET');
      assert.equal(readable.status, 200, await readable.text());
      const hidden = await request(`/counterparties/${b.id}`, 'GET');
      assert.equal(hidden.status, 403, await hidden.text());
      const before = await capture();
      audit.writeAuditEvent = async (...args: Parameters<AuditService['writeAuditEvent']>) => {
        if (args[0].actorUserId === actor.id && args[0].action === 'counterparty.created') auditCalls++;
        await originalEvent.apply(audit, args);
      };
      const payload = input();
      const denied = await request('/counterparties', 'POST', payload);
      assert.equal(denied.status, 403, await denied.text());
      assert.equal(auditCalls, 0, 'Unreadable generated ID must be rejected before its audit, not after commit');
      assert.deepEqual(await capture(), before, 'No unreadable newly-created row may survive a 403');
      audit.writeAuditEvent = originalEvent;
      await removeRule(selected.id);
      const all = await rule('counterparties.read', 'allow');
      try {
        const retry = await request('/counterparties', 'POST', payload);
        assert.equal(retry.status, 201, await retry.clone().text());
        const result = await retry.json() as { id: string };
        assert.equal(await prisma.counterparty.count({ where: { name: payload.name } }), 1);
        assert.equal(await prisma.auditEvent.count({ where: { entityType: 'counterparty', entityId: result.id, action: 'counterparty.created', actorUserId: actor.id } }), 1);
      } finally { await removeRule(all.id); }
    } finally {
      audit.writeAuditEvent = originalEvent;
      if (ruleIds.has(selected.id)) await removeRule(selected.id);
      await restoreReadFixture();
      restoreReadFixture = async () => {};
    }
  });
  // Source-only addition: isolated runner owns fixture disposal. No shared or
  // production database, browser/admin-save coverage, or test execution is claimed.
});
