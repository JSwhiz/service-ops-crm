import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Prisma, PrismaClient } from '@prisma/client';

import { PrismaService } from '../src/modules/prisma/prisma.service';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

const barrier = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const bounded = async <T,>(promise: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(label)), 5_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
};

test('correction serializes lifecycle authorization with real order completion and independently approved object freeze', { timeout: 180_000 }, async (t) => {
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
  const marker = `acl-correction-lifecycle-${randomUUID()}`;
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'manager' } });
  const actor = await prisma.user.create({ data: {
    login: marker, fullName: marker, passwordHash: template.passwordHash, isActive: true,
    roles: { create: { roleId: role.id } },
  } });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const director = await prisma.user.findUniqueOrThrow({ where: { login: 'director' } });
  const actorCookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' });
  const directorCookie = await loginAndGetCookieHeader({ baseUrl, login: director.login, password: 'director123' });
  const request = (cookie: string, path: string, method = 'POST', body: unknown = {}) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, status: number): Promise<T> => {
    const text = await response.text();
    assert.equal(response.status, status, text);
    return JSON.parse(text) as T;
  };
  const grant = (actionCode: string, id: string) => prisma.userAccessRule.upsert({
    where: { userId_actionCode: { userId: actor.id, actionCode } },
    create: { userId: actor.id, actionCode, effect: 'allow', scope: 'selected', selectedIds: [id] },
    update: { effect: 'allow', scope: 'selected', selectedIds: [id] },
  });
  const snapshot = async () => ({
    items: await prisma.inventoryItem.findMany({ orderBy: { id: 'asc' } }),
    movements: await prisma.inventoryMovement.findMany({ orderBy: { id: 'asc' } }),
    approvals: await prisma.approvalRequest.findMany({ orderBy: { id: 'asc' } }),
    audits: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    objectAudits: await prisma.objectAuditLog.findMany({ orderBy: { id: 'asc' } }),
    objects: await prisma.object.findMany({ orderBy: { id: 'asc' } }),
    orders: await prisma.oneTimeOrder.findMany({ orderBy: { id: 'asc' } }),
    completions: await prisma.oneTimeOrderCompletion.findMany({ orderBy: { id: 'asc' } }),
    payments: await prisma.oneTimeOrderCompletionPayment.findMany({ orderBy: { id: 'asc' } }),
    budgets: await prisma.objectBudgetPeriod.findMany({ orderBy: [{ objectId: 'asc' }, { month: 'asc' }] }),
    alerts: await prisma.objectBudgetAlert.findMany({ orderBy: { id: 'asc' } }),
    files: await prisma.fileAttachment.findMany({ orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    outbox: await prisma.notificationOutbox.findMany({ orderBy: { id: 'asc' }, select: {
      id: true, notificationId: true, recipientUserId: true, createdAt: true,
    } }),
    messages: await prisma.chatMessage.findMany({ orderBy: { id: 'asc' } }),
  });
  type TransactionHost = { $transaction: (work: unknown, options?: unknown) => Promise<unknown> };
  const host = app.get(PrismaService) as unknown as TransactionHost;
  const originalTransaction = host.$transaction;
  lifecycle.restore = () => { host.$transaction = originalTransaction; };

  for (const kind of ['object', 'order'] as const) {
    for (const ordering of ['transition-first', 'correction-first'] as const) {
      await t.test(`${kind}: ${ordering}`, async () => {
        await prisma.userAccessRule.deleteMany({ where: { userId: actor.id } });
        const source = kind === 'object'
          ? await prisma.object.create({ data: { name: `${marker}-${kind}-${ordering}`, address: 'Isolated lifecycle source', status: 'active', createdByUserId: founder.id } })
          : await prisma.oneTimeOrder.create({ data: { title: `${marker}-${kind}-${ordering}`, executionAddress: 'Isolated lifecycle source', contactName: 'Fixture', status: 'in_progress', createdByUserId: founder.id } });
        const item = await json<{ id: string }>(await request(founderCookie, '/inventory/items', 'POST', {
          name: `${marker}-${kind}-${ordering}`, category: marker, unit: 'шт',
        }), 201);
        await json(await request(founderCookie, '/inventory/movements', 'POST', {
          inventoryItemId: item.id, movementType: 'receipt', quantity: 10, unitPrice: 17,
        }), 201);
        const issue = await json<{ id: string }>(await request(founderCookie,
          kind === 'object' ? `/objects/${source.id}/inventory/issue` : `/one-time-orders/${source.id}/inventory/issue`,
          'POST', { inventoryItemId: item.id, quantity: 2, ...(kind === 'order' ? { requestId: randomUUID() } : {}) }), 201);
        const issueApproval = await prisma.approvalRequest.findFirst({ where: {
          sourceEntityType: 'inventory_movement', sourceEntityId: issue.id, status: 'pending',
        } });
        // Object missing-photo issuance has an independent approval request;
        // the order evidence bridge does not manufacture that approval kind.
        if (kind === 'object') assert.ok(issueApproval);
        else assert.equal(issueApproval, null);
        await grant(kind === 'object' ? 'objects.read' : 'one_time_orders.read', source.id);
        await grant('inventory.read', item.id);
        await grant('inventory.movement.correct', item.id);
        assert.equal(await prisma.objectAssignment.count({ where: { userId: actor.id } }), 0);
        assert.equal(await prisma.oneTimeOrderAssignment.count({ where: { userId: actor.id } }), 0);
        assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id, actionCode: { in: [
          'inventory.issue_to_object', 'objects.inventory.issue', 'inventory.issue_to_one_time_order',
        ] } } }), 0);
        const page = await json<{ items: Array<{ id: string; projection: { canCorrectMovement: boolean } }> }>(
          await request(actorCookie, `/inventory/movements?inventoryItemId=${item.id}`, 'GET'), 200);
        assert.equal(page.items.find(row => row.id === issue.id)?.projection.canCorrectMovement, true);

        let freezeApprovalId: string | undefined;
        if (kind === 'object') {
          const pending = await json<{ id: string }>(await request(founderCookie, `/objects/${source.id}/status`, 'PATCH', { status: 'frozen' }), 200);
          freezeApprovalId = pending.id;
          const approval = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: pending.id } });
          assert.equal(approval.createdByUserId, founder.id);
          assert.notEqual(approval.createdByUserId, director.id);
          assert.equal((await prisma.object.findUniqueOrThrow({ where: { id: source.id } })).status, 'active');
        }
        const transition = () => kind === 'object'
          ? request(directorCookie, `/approvals/${freezeApprovalId!}/approve`)
          : request(founderCookie, `/one-time-orders/${source.id}/complete`, 'POST', {
            workCycle: 1, clientRequestId: randomUUID(), payments: [{ amount: 0, zeroReason: 'payment_later' }],
          });
        const entered = barrier<void>();
        const release = barrier<void>();
        const held = barrier<number>();
        const waiter = barrier<number>();
        let paused = false;
        let waiting = false;
        host.$transaction = (work, options) => {
          if (typeof work !== 'function') return originalTransaction.call(host, work, options);
          return originalTransaction.call(host, async (tx: Prisma.TransactionClient) => {
            let correcting = false;
            const observed = new Proxy(tx, {
              get(target, property) {
                if (property === 'inventoryMovement') return new Proxy(target.inventoryMovement, {
                  get(delegate, method) {
                    if (method === 'findUniqueOrThrow') return async (args: Prisma.InventoryMovementFindUniqueOrThrowArgs) => {
                      const result = await delegate.findUniqueOrThrow(args);
                      if (args.where.id === issue.id && args.select?.relatedObjectId && args.select?.relatedOneTimeOrderId) {
                        correcting = true;
                        if (ordering === 'transition-first' && !paused) {
                          paused = true; entered.resolve(); await release.promise;
                        }
                      }
                      return result;
                    };
                    const value: unknown = Reflect.get(delegate, method);
                    return typeof value === 'function' ? value.bind(delegate) : value;
                  },
                });
                if (property === '$queryRaw') {
                  const execute = target.$queryRaw.bind(target) as (...args: unknown[]) => Promise<unknown>;
                  return async (...args: unknown[]) => {
                    const query = args[0] as { sql?: string; values?: unknown[] } | TemplateStringsArray;
                    const sql = (Array.isArray(query) ? query.join('') : (query as { sql?: string }).sql ?? '').replaceAll('"', '');
                    const values = Array.isArray(query) ? args.slice(1) : (query as { values?: unknown[] }).values ?? [];
                    const sourceLock = new RegExp(`FROM\\s+${kind === 'object' ? 'objects' : 'one_time_orders'}\\s+WHERE[\\s\\S]*FOR UPDATE`, 'i').test(sql) && values.includes(source.id);
                    if (sourceLock && ordering === 'correction-first' && !correcting && !waiting) {
                      waiting = true;
                      const [backend] = await target.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
                      assert.ok(backend); waiter.resolve(backend.pid);
                    }
                    const result = await execute(...args);
                    if (sourceLock && correcting && ordering === 'correction-first' && !paused) {
                      paused = true;
                      const [backend] = await target.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
                      assert.ok(backend); held.resolve(backend.pid); await release.promise;
                    }
                    return result;
                  };
                }
                const value: unknown = Reflect.get(target, property);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            });
            return (work as (tx: Prisma.TransactionClient) => Promise<unknown>)(observed);
          }, options);
        };
        const correction = request(actorCookie, `/inventory/movements/${issue.id}/correct`, 'POST', { reason: marker });
        void correction.catch(() => undefined);
        let changing: Promise<Response> | undefined;
        try {
          if (ordering === 'transition-first') {
            await bounded(entered.promise, 'Correction did not reach locked movement target preflight');
            await json(await transition(), kind === 'object' ? 200 : 201);
            const afterTransition = await snapshot();
            release.resolve();
            const response = await correction;
            assert.equal(response.status, 403, await response.text());
            assert.deepEqual(await snapshot(), afterTransition, 'Denied stale correction must not change money, ledger, approvals, audits or other captured effects');
            if (issueApproval) assert.equal((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: issueApproval.id } })).status, 'pending');
          } else {
            const correctionPid = await bounded(held.promise, 'Correction did not hold its actual source row lock');
            changing = transition();
            void changing.catch(() => undefined);
            const transitionPid = await bounded(waiter.promise, 'Independent transition did not reach its source row lock');
            await bounded((async () => {
              const deadline = Date.now() + 4_000;
              while (Date.now() < deadline) {
                const [row] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`SELECT ${correctionPid}::integer = ANY(pg_blocking_pids(${transitionPid}::integer)) AS blocked`;
                if (row?.blocked) return;
                // Yield only; success depends on observed PostgreSQL blocking,
                // never on a guessed sleep or elapsed-time ordering assertion.
                await new Promise<void>(resolve => setImmediate(resolve));
              }
              throw new Error('Transition was not blocked by the correction source lock');
            })(), 'Real source lock contention was not observed');
            release.resolve();
            assert.equal((await json<{ mode: string }>(await correction, 201)).mode, 'cancelled');
            await json(await changing, kind === 'object' ? 200 : 201);
            assert.equal((await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: issue.id } })).status, 'cancelled');
            if (issueApproval) assert.equal((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: issueApproval.id } })).status, 'cancelled');
            assert.equal(await prisma.auditEvent.count({ where: { entityId: issue.id, actorUserId: actor.id, action: 'inventory.movement.cancelled' } }), 1);
          }
          assert.equal(kind === 'object'
            ? (await prisma.object.findUniqueOrThrow({ where: { id: source.id } })).status
            : (await prisma.oneTimeOrder.findUniqueOrThrow({ where: { id: source.id } })).status,
          kind === 'object' ? 'frozen' : 'completed');
          if (ordering === 'transition-first') {
            // Source locking must not invent a universal closed-source ban:
            // director's frozen-object override and the global closed-order
            // operator baseline still authorize the original unconfirmed issue.
            const original = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: issue.id } });
            const result = await json<{ mode: string }>(await request(kind === 'object' ? directorCookie : founderCookie,
              `/inventory/movements/${issue.id}/correct`, 'POST', { reason: `${marker}-global-control` }), 201);
            assert.equal(result.mode, 'cancelled');
            const cancelled = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: issue.id } });
            assert.equal(cancelled.status, 'cancelled');
            assert.deepEqual({ ...cancelled, status: original.status, updatedAt: original.updatedAt }, original);
          }
        } finally {
          release.resolve();
          await Promise.allSettled([correction, ...(changing ? [changing] : [])]);
          host.$transaction = originalTransaction;
        }
      });
    }
  }
});
