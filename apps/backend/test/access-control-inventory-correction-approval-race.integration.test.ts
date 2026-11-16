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
const bounded = async <T,>(promise: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(label)), 6_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
};

// Observation/barriers only: no mocked SQL results, synthetic database errors,
// application retries, changes to deadlock settings, or hand-forged approvals.
// Pre-fix Batch13: both opposite-lock schedules formed a real cycle and returned
// HTTP 500 (approval victim P2010/40P01; correction victim had no exposed code).
// This regression now proves the repaired shared item-first serialization.
test('correction versus independent shared approval uses one item-first lock order and never leaks HTTP 500', { timeout: 180_000 }, async (t) => {
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
  const marker = `acl-correction-approval-race-${randomUUID()}`;
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'manager' } });
  const actor = await prisma.user.create({ data: {
    login: marker, fullName: marker, passwordHash: template.passwordHash, isActive: true,
    roles: { create: { roleId: role.id } },
  } });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const director = await prisma.user.findUniqueOrThrow({ where: { login: 'director' }, include: { roles: { include: { role: true } } } });
  assert.ok(director.roles.some(row => row.role.code === 'director'));
  assert.notEqual(founder.id, director.id);
  assert.notEqual(actor.id, director.id);
  const actorCookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' });
  const directorCookie = await loginAndGetCookieHeader({ baseUrl, login: director.login, password: 'director123' });
  const request = (cookie: string, path: string, body: unknown = {}, method = 'POST') => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(25_000),
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
  type TransactionHost = { $transaction: (work: unknown, options?: unknown) => Promise<unknown> };
  const host = app.get(PrismaService) as unknown as TransactionHost;
  const originalTransaction = host.$transaction;
  lifecycle.restore = () => { host.$transaction = originalTransaction; };

  for (const firstWaiter of ['approval', 'correction'] as const) await t.test(`${firstWaiter} owns the item first; its peer waits before movement/approval locks`, async (suite) => {
    const object = await prisma.object.create({ data: {
      name: `${marker}-${firstWaiter}`, address: 'Isolated approval race', status: 'active', createdByUserId: founder.id,
    } });
    const item = await json<{ id: string }>(await request(founderCookie, '/inventory/items', {
      name: `${marker}-${firstWaiter}`, category: marker, unit: 'шт',
    }), 201);
    await json(await request(founderCookie, '/inventory/movements', {
      inventoryItemId: item.id, movementType: 'receipt', quantity: 10, unitPrice: 17,
    }), 201);
    const issue = await json<{ id: string }>(await request(founderCookie, `/objects/${object.id}/inventory/issue`, {
      inventoryItemId: item.id, quantity: 2,
    }), 201);
    const original = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: issue.id } });
    const approval = await prisma.approvalRequest.findFirstOrThrow({ where: {
      sourceEntityType: 'inventory_movement', sourceEntityId: issue.id, status: 'pending',
    } });
    assert.equal(original.createdByUserId, founder.id);
    assert.equal(approval.createdByUserId, founder.id);
    assert.equal(original.status, 'applied', 'Missing-photo approval does not apply the same issue a second time');
    assert.equal(original.approvalBridgeResolvedAt, null);
    await grant('objects.read', object.id);
    await grant('inventory.read', item.id);
    await grant('inventory.movement.correct', item.id);
    assert.equal(await prisma.objectAssignment.count({ where: { userId: actor.id } }), 0);
    assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id, actionCode: { in: [
      'inventory.issue_to_object', 'objects.inventory.issue', 'inventory.resolve_missing_photo',
    ] } } }), 0);
    const capture = async () => ({
      item: await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } }),
      movements: await prisma.inventoryMovement.findMany({ where: { inventoryItemId: item.id }, orderBy: { id: 'asc' } }),
      approvals: await prisma.approvalRequest.findMany({ where: { sourceEntityType: 'inventory_movement', sourceEntityId: issue.id }, orderBy: { id: 'asc' } }),
      audits: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
      objectAudit: await prisma.objectAuditLog.findMany({ where: { objectId: object.id }, orderBy: { id: 'asc' } }),
      object: await prisma.object.findUniqueOrThrow({ where: { id: object.id }, include: { assignments: { orderBy: { id: 'asc' } } } }),
      budgets: await prisma.objectBudgetPeriod.findMany({ where: { objectId: object.id }, orderBy: { month: 'asc' } }),
      alerts: await prisma.objectBudgetAlert.findMany({ where: { objectId: object.id }, orderBy: { id: 'asc' } }),
      files: await prisma.fileAttachment.findMany({ where: { entityType: 'inventory_movement', entityId: issue.id }, orderBy: { id: 'asc' } }),
      notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
      outbox: await prisma.notificationOutbox.findMany({ orderBy: { id: 'asc' }, select: { id: true, notificationId: true, recipientUserId: true, createdAt: true } }),
      messages: await prisma.chatMessage.findMany({ orderBy: { id: 'asc' } }),
    });
    const before = await capture();
    assert.equal((await json<{ currentStock: number }>(await request(founderCookie, `/inventory/items/${item.id}`, undefined, 'GET'), 200)).currentStock, 8);
    // All shared resolution branches reach the same item -> movement -> approval
    // loader. Reject/cancel stay forbidden; even the author cannot self-approve.
    for (const [operation, cookie] of [['reject', directorCookie], ['cancel', founderCookie], ['approve', founderCookie]] as const) {
      const acquired: string[] = [];
      host.$transaction = (work, options) => {
        if (typeof work !== 'function') return originalTransaction.call(host, work, options);
        return originalTransaction.call(host, async (tx: Prisma.TransactionClient) => {
          const observed = new Proxy(tx, { get(target, property) {
            if (property === '$queryRaw') return async (...args: unknown[]) => {
              const query = args[0] as TemplateStringsArray | { sql?: string; values?: unknown[] };
              const sql = (Array.isArray(query) ? query.join('') : (query as { sql?: string }).sql ?? '').replaceAll('"', '');
              const values = Array.isArray(query) ? args.slice(1) : (query as { values?: unknown[] }).values ?? [];
              const result = await (target.$queryRaw.bind(target) as (...input: unknown[]) => Promise<unknown>)(...args);
              for (const [table, id] of [['inventory_items', item.id], ['inventory_movements', issue.id], ['approval_requests', approval.id]] as const) {
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
      try {
        const denied = await request(cookie, `/approvals/${approval.id}/${operation}`, { comment: marker });
        assert.equal(denied.status, 403, await denied.text());
        assert.deepEqual(acquired.slice(0, 3), ['inventory_items', 'inventory_movements', 'approval_requests']);
        assert.deepEqual(await capture(), before, `${operation} must retain its existing guard and have no effects`);
      } finally { host.$transaction = originalTransaction; }
    }
    const winnerHeld = barrier<number>();
    const waiterEntered = barrier<number>();
    const releaseWinner = barrier<void>();
    const failures: Array<{ owner: string; code?: string; databaseCode?: string; name?: string; message?: string }> = [];
    const locks: Record<string, string[]> = { correction: [], approval: [] };
    let winnerPaused = false;
    let waiterSeen = false;
    let correctionAttempts = 0;
    host.$transaction = (work, options) => {
      if (typeof work !== 'function') return originalTransaction.call(host, work, options);
      let owner = 'other';
      return originalTransaction.call(host, async (tx: Prisma.TransactionClient) => {
        const observed = new Proxy(tx, {
          get(target, property) {
            if (property === 'approvalRequest') return new Proxy(target.approvalRequest, {
              get(delegate, method) {
                if (method === 'findUnique') return (args: Prisma.ApprovalRequestFindUniqueArgs) => {
                  if (args.where.id === approval.id && owner === 'other') owner = 'approval';
                  return delegate.findUnique(args);
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
                const lock = (table: string, id: string) => new RegExp(`FROM\\s+${table}\\s+WHERE[\\s\\S]*FOR UPDATE`, 'i').test(sql) && values.includes(id);
                if (lock('inventory_items', item.id) && owner === 'other') { owner = 'correction'; correctionAttempts += 1; }
                if (lock('inventory_items', item.id) && owner !== firstWaiter && !waiterSeen) {
                  waiterSeen = true;
                  const [backend] = await target.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
                  assert.ok(backend); waiterEntered.resolve(backend.pid);
                }
                const result = await execute(...args);
                if (owner !== 'other') {
                  for (const [table, id] of [['inventory_items', item.id], ['inventory_movements', issue.id], ['approval_requests', approval.id]]) {
                    if (lock(table!, id!)) locks[owner]!.push(table!);
                  }
                }
                if (lock('inventory_items', item.id) && owner === firstWaiter && !winnerPaused) {
                  winnerPaused = true;
                  const [backend] = await target.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
                  assert.ok(backend); winnerHeld.resolve(backend.pid); await releaseWinner.promise;
                }
                return result;
              };
            }
            const value: unknown = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        return (work as (tx: Prisma.TransactionClient) => Promise<unknown>)(observed);
      }, options).catch((error: unknown) => {
        const detail = error as { code?: string; meta?: { code?: unknown }; name?: string; message?: string };
        if (owner !== 'other') failures.push({ owner, code: detail.code, databaseCode: detail.meta?.code === undefined ? undefined : String(detail.meta.code), name: detail.name, message: detail.message });
        throw error; // Only production inventoryTransaction may retry its own rolled-back callback.
      });
    };
    const correctBody = { reason: `${marker}-${firstWaiter}` };
    const sendCorrection = () => request(actorCookie, `/inventory/movements/${issue.id}/correct`, correctBody);
    const sendApproval = () => request(directorCookie, `/approvals/${approval.id}/approve`, { comment: marker });
    let correction: Promise<Response> | undefined;
    let approving: Promise<Response> | undefined;
    if (firstWaiter === 'correction') correction = sendCorrection();
    else approving = sendApproval();
    void correction?.catch(() => undefined); void approving?.catch(() => undefined);
    try {
      const winnerPid = await bounded(winnerHeld.promise, 'Winner did not acquire the common first item lock');
      if (firstWaiter === 'correction') approving = sendApproval();
      else correction = sendCorrection();
      void correction!.catch(() => undefined); void approving!.catch(() => undefined);
      const waiterPid = await bounded(waiterEntered.promise, 'Peer did not attempt the same item lock');
      const blocked = async (waiter: number, blocker: number) => {
        const [row] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`SELECT ${blocker}::integer = ANY(pg_blocking_pids(${waiter}::integer)) AS blocked`;
        return row?.blocked === true;
      };
      await bounded((async () => {
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
          if (await blocked(waiterPid, winnerPid)) return;
          await new Promise<void>(resolve => setImmediate(resolve));
        }
        throw new Error('Peer never blocked on the winner item lock');
      })(), 'Same-order PostgreSQL lock wait was not observed');
      assert.deepEqual(locks[firstWaiter === 'approval' ? 'correction' : 'approval'], [], 'Waiting peer must not hold movement/approval before the common item lock');
      releaseWinner.resolve();
      const [correctResponse, approveResponse] = await Promise.all([correction!, approving!]);
      const correctText = await correctResponse.text();
      const approveText = await approveResponse.text();
      const after = await capture();
      suite.diagnostic(JSON.stringify({ firstOwner: firstWaiter, correctionAttempts, locks, failures,
        correction: { status: correctResponse.status, body: correctText },
        approval: { status: approveResponse.status, body: approveText },
        movementStatus: after.movements.find(row => row.id === issue.id)?.status, approvalStatus: after.approvals[0]?.status,
      }));
      assert.equal(correctionAttempts, 1, 'Same-order serialization requires no correction transaction retry');
      assert.deepEqual(locks.correction!.slice(0, 2), ['inventory_items', 'inventory_movements']);
      assert.deepEqual(locks.approval!.slice(0, 3), ['inventory_items', 'inventory_movements', 'approval_requests']);
      // A deadlock victim is diagnostic evidence, not an acceptable HTTP result.
      assert.notEqual(correctResponse.status, 500, correctText);
      assert.notEqual(approveResponse.status, 500, approveText);
      assert.equal(correctResponse.status, 201, correctText);
      const result = JSON.parse(correctText) as { id: string; mode: string; compensatingMovementId?: string };
      assert.equal(result.mode, firstWaiter === 'correction' ? 'cancelled' : 'reversed', 'The actual first item owner determines the valid linearization');
      assert.equal(result.id, issue.id);
      assert.equal(after.approvals.length, 1, 'No duplicate or replacement independent approval');
      assert.equal(after.approvals[0]!.id, approval.id);
      assert.deepEqual(after.item, before.item, 'Correction/approval never rewrite item pricing');
      const saved = after.movements.find(row => row.id === issue.id);
      assert.ok(saved);
      const addedAudits = after.audits.filter(row => !before.audits.some(old => old.id === row.id));
      if (result.mode === 'cancelled') {
        assert.equal(approveResponse.status, 409, approveText);
        assert.equal(saved.status, 'cancelled');
        assert.deepEqual({ ...saved, status: original.status, updatedAt: original.updatedAt }, original);
        assert.equal(after.approvals[0]!.status, 'cancelled');
        assert.equal(after.approvals[0]!.cancelledByUserId, actor.id);
        assert.equal(after.approvals[0]!.resolvedByUserId, null);
        assert.equal(after.approvals[0]!.decisionComment, correctBody.reason);
        assert.deepEqual(after.movements.filter(row => row.id !== issue.id), before.movements.filter(row => row.id !== issue.id));
        assert.equal(addedAudits.length, 1);
        assert.equal(addedAudits[0]!.action, 'inventory.movement.cancelled');
        assert.equal(addedAudits[0]!.entityId, issue.id);
        assert.equal(addedAudits[0]!.actorUserId, actor.id);
        assert.deepEqual(addedAudits[0]!.newValues, { reason: correctBody.reason });
      } else {
        assert.equal(result.mode, 'reversed');
        assert.equal(approveResponse.status, 200, approveText);
        assert.equal(after.approvals[0]!.status, 'approved');
        assert.equal(after.approvals[0]!.resolvedByUserId, director.id);
        assert.equal(after.approvals[0]!.cancelledByUserId, null);
        assert.equal(after.approvals[0]!.decisionComment, marker);
        assert.ok(saved.approvalBridgeResolvedAt);
        assert.equal(saved.approvalBridgeResolvedByUserId, director.id);
        assert.deepEqual({ ...saved, approvalBridgeResolvedAt: original.approvalBridgeResolvedAt,
          approvalBridgeResolvedByUserId: original.approvalBridgeResolvedByUserId, updatedAt: original.updatedAt }, original);
        const returns = after.movements.filter(row => !before.movements.some(old => old.id === row.id));
        assert.equal(returns.length, 1);
        const reverse = returns[0]!;
        assert.equal(reverse.id, result.compensatingMovementId);
        assert.equal(reverse.movementType, 'return');
        assert.equal(reverse.status, 'applied');
        assert.equal(reverse.inventoryItemId, item.id);
        assert.equal(reverse.relatedObjectId, object.id);
        assert.equal(reverse.relatedOneTimeOrderId, null);
        assert.equal(reverse.createdByUserId, actor.id);
        assert.equal(reverse.comment, `Сторно выдачи: ${correctBody.reason}`);
        assert.equal(reverse.evidenceRequired, false);
        assert.equal(reverse.quantity.toString(), original.quantity.toString());
        assert.equal(reverse.unitPriceSnapshot.toString(), original.unitPriceSnapshot.toString());
        assert.equal(reverse.totalAmountSnapshot.toString(), original.totalAmountSnapshot.toString());
        assert.deepEqual(after.movements.filter(row => row.id !== issue.id && row.id !== reverse.id), before.movements.filter(row => row.id !== issue.id));
        assert.deepEqual(addedAudits.map(row => [row.action, row.entityId, row.actorUserId]).sort(), [
          ['inventory.missing_photo_approval.resolved', issue.id, director.id],
          ['approval.request.approved', approval.id, director.id],
          ['inventory.movement.reversed', issue.id, actor.id],
        ].sort());
        assert.deepEqual(addedAudits.find(row => row.action === 'inventory.movement.reversed')!.newValues,
          { reason: correctBody.reason, compensatingMovementId: reverse.id });
      }
      for (const key of ['object', 'objectAudit', 'budgets', 'alerts', 'files', 'notifications', 'outbox', 'messages'] as const) assert.deepEqual(after[key], before[key]);
      const stock = await json<{ currentStock: number }>(await request(founderCookie, `/inventory/items/${item.id}`, undefined, 'GET'), 200);
      assert.equal(stock.currentStock, 10, 'One cancellation OR one approval plus exact return restores stock exactly once');
      // Observe idempotent replay only after both original HTTP requests settle;
      // never hide an initial 500 with a fixture-supplied retry.
      host.$transaction = originalTransaction;
      assert.deepEqual(await json(await request(actorCookie, `/inventory/movements/${issue.id}/correct`, correctBody), 201), result);
      const repeatApproval = await request(directorCookie, `/approvals/${approval.id}/approve`, { comment: marker });
      assert.equal(repeatApproval.status, 409, await repeatApproval.text());
      assert.deepEqual(await capture(), after, 'Replay/second resolution must not duplicate money, return, audit or approval');
    } finally {
      releaseWinner.resolve();
      await Promise.allSettled([...(correction ? [correction] : []), ...(approving ? [approving] : [])]);
      host.$transaction = originalTransaction;
    }
  });
});
