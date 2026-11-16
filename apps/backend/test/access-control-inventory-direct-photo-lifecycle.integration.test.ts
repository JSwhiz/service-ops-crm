import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient, type Prisma } from '@prisma/client';

import { PrismaService } from '../src/modules/prisma/prisma.service';
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

test('direct missing-photo resolution checks cancelled lifecycle and fresh assigned denial', { timeout: 120_000 }, async (t) => {
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
  const snapshot = async (f: Awaited<ReturnType<typeof fixture>>) => ({
    item: await prisma.inventoryItem.findUniqueOrThrow({ where: { id: f.item.id } }),
    movements: await prisma.inventoryMovement.findMany({ where: { inventoryItemId: f.item.id }, orderBy: { id: 'asc' } }),
    approvals: await prisma.approvalRequest.findMany({ where: { sourceEntityType: 'inventory_movement', sourceEntityId: f.issue.id }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditEvent.findMany({ where: { OR: [
      { entityType: 'inventory_movement', entityId: f.issue.id },
      { entityType: 'approval_request', entityId: f.approval.id },
    ] }, orderBy: { id: 'asc' } }),
    objectAudits: await prisma.objectAuditLog.findMany({ where: { objectId: f.object.id }, orderBy: { id: 'asc' } }),
    budgets: await prisma.objectBudgetPeriod.findMany({ where: { objectId: f.object.id }, orderBy: { month: 'asc' } }),
    alerts: await prisma.objectBudgetAlert.findMany({ where: { objectId: f.object.id }, orderBy: { id: 'asc' } }),
  });

  await t.test('cancelled movement cannot be resolved when its approval is no longer pending', async () => {
    const f = await fixture('cancelled');
    const result = await json<{ mode: string }>(await request(founderCookie, `/inventory/movements/${f.issue.id}/correct`, { reason: marker }), 201);
    assert.equal(result.mode, 'cancelled');
    const before = await snapshot(f);
    assert.equal(before.movements.find(row => row.id === f.issue.id)?.status, 'cancelled');
    assert.equal(before.approvals.find(row => row.id === f.approval.id)?.status, 'cancelled');
    assert.equal(before.movements.find(row => row.id === f.issue.id)?.approvalBridgeResolvedAt, null);
    const response = await request(directorCookie, `/inventory/movements/${f.issue.id}/resolve-missing-photo-approval`);
    assert.equal(response.status, 409, await response.text());
    assert.deepEqual(await snapshot(f), before, 'No bridge, approval, ledger, audit, or budget effects after cancellation');
  });

  await t.test('assignment committed before direct transaction is included in the locked source policy check', async () => {
    await prisma.userAccessRule.create({ data: {
      userId: director.id, actionCode: 'objects.read', effect: 'deny', scope: 'assigned', selectedIds: [],
    } });
    // Control: this director can resolve a founder-authored issue while unassigned.
    const control = await fixture('unassigned-control');
    assert.equal(await prisma.objectAssignment.count({ where: { objectId: control.object.id, userId: director.id, isActive: true } }), 0);
    await json(await request(directorCookie, `/inventory/movements/${control.issue.id}/resolve-missing-photo-approval`), 200);
    assert.equal((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: control.approval.id } })).status, 'approved');

    const f = await fixture('assigned-deny');
    assert.equal(await prisma.objectAssignment.count({ where: { objectId: f.object.id, userId: director.id, isActive: true } }), 0);
    type TransactionHost = { $transaction: (work: unknown, options?: unknown) => Promise<unknown> };
    const host = app.get(PrismaService) as unknown as TransactionHost;
    const originalTransaction = host.$transaction;
    lifecycle.restore = () => { host.$transaction = originalTransaction; };
    const entered = barrier<void>();
    const release = barrier<void>();
    const acquired: string[] = [];
    let intercepted = false;
    host.$transaction = async (work, options) => {
      if (typeof work !== 'function' || intercepted) return originalTransaction.call(host, work, options);
      intercepted = true;
      entered.resolve();
      await release.promise; // Before opening the real transaction: no held transaction times out.
      return originalTransaction.call(host, async (tx: Prisma.TransactionClient) => {
        const observed = new Proxy(tx, { get(target, property) {
          if (property === '$queryRaw') return async (...args: unknown[]) => {
            const query = args[0] as TemplateStringsArray | { sql?: string; values?: unknown[] };
            const sql = (Array.isArray(query) ? query.join('') : (query as { sql?: string }).sql ?? '').replaceAll('"', '');
            const values = Array.isArray(query) ? args.slice(1) : (query as { values?: unknown[] }).values ?? [];
            const result = await (target.$queryRaw.bind(target) as (...input: unknown[]) => Promise<unknown>)(...args);
            for (const [table, id] of [['inventory_items', f.item.id], ['inventory_movements', f.issue.id]] as const) {
              if (new RegExp(`FROM\\s+${table}\\s+WHERE[\\s\\S]*FOR UPDATE`, 'i').test(sql) && values.includes(id)) acquired.push(table);
            }
            return result;
          };
          const value: unknown = Reflect.get(target, property);
          return typeof value === 'function' ? value.bind(target) : value;
        } });
        return (work as (tx: Prisma.TransactionClient) => Promise<unknown>)(observed);
      }, options);
    };
    const resolving = request(directorCookie, `/inventory/movements/${f.issue.id}/resolve-missing-photo-approval`);
    void resolving.catch(() => undefined);
    try {
      await bounded(entered.promise, 'Direct resolver did not reach its transaction after initial authorization');
      await prisma.objectAssignment.create({ data: {
        objectId: f.object.id, userId: director.id, assignmentRoleCode: 'manager', isActive: true,
      } });
      const before = await snapshot(f);
      release.resolve();
      const response = await resolving;
      assert.equal(response.status, 403, await response.text());
      assert.deepEqual(acquired.slice(0, 2), ['inventory_items', 'inventory_movements']);
      assert.deepEqual(await snapshot(f), before, 'Fresh assigned deny must precede all bridge and ledger effects');
    } finally {
      release.resolve();
      await Promise.allSettled([resolving]);
      host.$transaction = originalTransaction;
    }
  });
});
