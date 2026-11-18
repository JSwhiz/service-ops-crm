import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient, type Prisma } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

const barrier = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

async function bounded<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 6_000);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test('direct missing-photo resolution rechecks lifecycle after actual PostgreSQL wait and acknowledges committed write', { timeout: 120_000 }, async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);

  const prisma = new PrismaClient();
  const lifecycle: { close?: () => Promise<void>; restore?: () => void } = {};
  t.after(async () => {
    lifecycle.restore?.();
    try { await lifecycle.close?.(); } finally { await prisma.$disconnect(); }
  });
  const { app, baseUrl } = await createTestApp();
  lifecycle.close = () => app.close();
  const marker = `direct-photo-lifecycle-${randomUUID()}`;
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' }, include: { roles: { include: { role: true } } } });
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'director' } });
  const directorRole = await prisma.role.findUniqueOrThrow({ where: { code: 'director' } });
  const director = await prisma.user.create({ data: {
    login: marker, fullName: marker, passwordHash: template.passwordHash, isActive: true,
    roles: { create: { roleId: directorRole.id } },
  } });
  assert.ok(founder.roles.some(row => row.role.code === 'founder'));
  assert.notEqual(founder.id, director.id);
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' });
  const directorCookie = await loginAndGetCookieHeader({ baseUrl, login: director.login, password: 'director123' });
  const request = (cookie: string, path: string, body: unknown = {}, method = 'POST') => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000),
  });
  const json = async <T,>(response: Response, expected: number): Promise<T> => {
    const text = await response.text();
    assert.equal(response.status, expected, text);
    return JSON.parse(text) as T;
  };
  const fixture = async (name: string) => {
    const object = await prisma.object.create({ data: {
      name: `${marker}-${name}`, address: 'Isolated direct-photo fixture', status: 'active', createdByUserId: founder.id,
    } });
    await prisma.objectPlanningSettings.create({ data: { objectId: object.id, monthlyBudget: 1_000 } });
    const item = await json<{ id: string }>(await request(founderCookie, '/inventory/items', {
      name: `${marker}-${name}`, category: marker, unit: 'шт',
    }), 201);
    await json(await request(founderCookie, '/inventory/movements', {
      inventoryItemId: item.id, movementType: 'receipt', quantity: 10, unitPrice: 17,
    }), 201);
    const issue = await json<{ id: string }>(await request(founderCookie, `/objects/${object.id}/inventory/issue`, {
      inventoryItemId: item.id, quantity: 2,
    }), 201);
    const movement = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: issue.id } });
    const approval = await prisma.approvalRequest.findFirstOrThrow({ where: {
      sourceEntityType: 'inventory_movement', sourceEntityId: issue.id,
      approvalType: 'inventory_exception_confirmation', status: 'pending',
    } });
    assert.equal(movement.status, 'applied');
    assert.equal(movement.approvalBridgeResolvedAt, null);
    assert.equal(movement.createdByUserId, founder.id);
    assert.equal(approval.createdByUserId, founder.id);
    return { object, item, issue, approval };
  };
  const snapshot = async (f: Awaited<ReturnType<typeof fixture>>, client: Prisma.TransactionClient | PrismaClient = prisma) => ({
    item: await client.inventoryItem.findUniqueOrThrow({ where: { id: f.item.id } }),
    movements: await client.inventoryMovement.findMany({ where: { inventoryItemId: f.item.id }, orderBy: { id: 'asc' } }),
    approvals: await client.approvalRequest.findMany({ where: { sourceEntityType: 'inventory_movement', sourceEntityId: f.issue.id }, orderBy: { id: 'asc' } }),
    audits: await client.auditEvent.findMany({ where: { OR: [
      { entityType: 'inventory_movement', entityId: f.issue.id },
      { entityType: 'approval_request', entityId: f.approval.id },
    ] }, orderBy: { id: 'asc' } }),
    objectAudits: await client.objectAuditLog.findMany({ where: { objectId: f.object.id }, orderBy: { id: 'asc' } }),
    budgets: await client.objectBudgetPeriod.findMany({ where: { objectId: f.object.id }, orderBy: { month: 'asc' } }),
    alerts: await client.objectBudgetAlert.findMany({ where: { objectId: f.object.id }, orderBy: { id: 'asc' } }),
  });


  const proof: { scenarios: Record<string, unknown>[]; productionTouched: boolean } = { scenarios: [], productionTouched: false };
  const output = process.env.CLOSEOUT_PHOTO_OUTPUT ?? join(mkdtempSync(join(tmpdir(), 'crm-direct-photo-')), 'proof.json');
  assert.ok(output);
  const save = () => { mkdirSync(output.slice(0, output.lastIndexOf('/')), { recursive: true }); writeFileSync(output, JSON.stringify(proof, null, 2) + '\n'); };
  const plain = (x: unknown) => JSON.parse(JSON.stringify(x));
  for (const phase of ['movement-cancelled', 'approval-resolved', 'parent-assignment-deny']) {
    await t.test(`actual source row wait: ${phase}`, async () => {
      const f = await fixture(phase);
      if (phase === 'parent-assignment-deny') await prisma.userAccessRule.create({ data: {
        userId: director.id, actionCode: 'objects.read', effect: 'deny', scope: 'assigned', selectedIds: [],
      } });
      const locked = barrier<number>(); const release = barrier<void>();
      let expected: unknown; let resolving: Promise<Response> | undefined;
      const holding = prisma.$transaction(async tx => {
        const [pid] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        await tx.$queryRaw`SELECT id FROM inventory_items WHERE id=${f.item.id} FOR UPDATE`;
        locked.resolve(pid.pid);
        await release.promise;
        if (phase === 'movement-cancelled') {
          await tx.inventoryMovement.update({ where: { id: f.issue.id }, data: { status: 'cancelled' } });
          await tx.approvalRequest.update({ where: { id: f.approval.id }, data: { status: 'cancelled' } });
        } else if (phase === 'approval-resolved') {
          await tx.approvalRequest.update({ where: { id: f.approval.id }, data: {
            status: 'rejected', resolvedByUserId: founder.id, resolvedAt: new Date(), decisionComment: marker,
          } });
        } else {
          await tx.objectAssignment.create({ data: { objectId: f.object.id, userId: director.id, assignmentRoleCode: 'manager', isActive: true } });
        }
        expected = plain(await snapshot(f, tx));
      }, { timeout: 20_000 });
      void holding.catch(() => undefined);
      const row: Record<string, unknown> = { phase, sourceIds: { item: f.item.id, movement: f.issue.id, approval: f.approval.id, object: f.object.id }, actorId: director.id, status: 'running' };
      proof.scenarios.push(row); save();
      try {
        const pid = await bounded(locked.promise, 'blocker failed to lock own item');
        resolving = request(directorCookie, `/inventory/movements/${f.issue.id}/resolve-missing-photo-approval`);
        void resolving.catch(() => undefined);
        const until = Date.now() + 6_000; let waiters: unknown[] = [];
        while (Date.now() < until) {
          waiters = await prisma.$queryRaw`SELECT pid, wait_event_type, query FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock'`;
          if (waiters.length) break;
          await new Promise(done => setTimeout(done, 20));
        }
        assert.ok(waiters.length, 'Actual resolver must be waiting on the source item PostgreSQL lock');
        row.postgresWait = plain(waiters); save();
        release.resolve(); await holding;
        const response = await resolving; row.response = { status: response.status, body: await response.json() };
        assert.equal(response.status, phase === 'parent-assignment-deny' ? 403 : 409);
        row.before = expected; row.after = plain(await snapshot(f));
        assert.deepEqual(row.after, expected, 'After concurrent source transition there are no additional bridge, audit, budget or ledger effects');
        row.status = 'passed'; save();
      } catch (e) { row.status = 'failed'; row.error = String(e); save(); throw e; }
      finally { release.resolve(); await Promise.allSettled([holding, ...(resolving ? [resolving] : [])]); }
    });
  }
  await t.test('committed direct resolution survives parent revocation before projection response', async () => {
    const f = await fixture('postcommit'); const service = app.get(InventoryService) as unknown as { loadMovementViewById: (id: string) => Promise<unknown> };
    const original = service.loadMovementViewById; const ready = barrier<void>(); const release = barrier<void>();
    service.loadMovementViewById = async id => { if (id === f.issue.id) { ready.resolve(); await release.promise; } return original.call(service, id); };
    const row: Record<string, unknown> = { phase: 'committed-parent-revoke', actorId: director.id, movementId: f.issue.id, status: 'running' }; proof.scenarios.push(row); save();
    const resolving = request(directorCookie, `/inventory/movements/${f.issue.id}/resolve-missing-photo-approval`); void resolving.catch(() => undefined);
    try {
      await bounded(ready.promise, 'Committed projection was not reached');
      const before = plain(await snapshot(f));
      assert.equal(before.approvals.find((a: { id: string }) => a.id === f.approval.id).status, 'approved');
      assert.ok(before.movements.find((m: { id: string }) => m.id === f.issue.id).approvalBridgeResolvedAt);
      const version = (await prisma.user.findUniqueOrThrow({ where: { id: director.id } })).accessVersion;
      const input = { expectedVersion: version, reason: marker, changes: [{ actionCode: 'objects.read', effect: 'deny', scope: 'selected', selectedIds: [f.object.id] }] };
      const preview = await json<{ previewToken: string; previewHash: string }>(await request(founderCookie, `/users-access/admin/users/${director.id}/preview`, input), 201);
      await json(await request(founderCookie, `/users-access/admin/users/${director.id}/save`, { ...input, previewToken: preview.previewToken, previewHash: preview.previewHash }), 201);
      row.deniedSource = (await request(directorCookie, `/objects/${f.object.id}`, {}, 'GET')).status;
      assert.ok([403, 404].includes(row.deniedSource as number));
      release.resolve(); const response = await resolving; const body = await response.json(); row.response = { status: response.status, body };
      assert.equal(response.status, 200); assert.deepEqual(body, { outcome: 'saved_without_access' });
      row.before = before; row.after = plain(await snapshot(f)); assert.deepEqual(row.after, before);
      row.status = 'passed'; save();
    } catch(e) { row.status = 'failed'; row.error = String(e); save(); throw e; }
    finally { release.resolve(); await Promise.allSettled([resolving]); service.loadMovementViewById = original; }
  });
});
