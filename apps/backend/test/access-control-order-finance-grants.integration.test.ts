import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { OneTimeOrderCompletionResponseDto } from '../src/modules/one-time-orders/dto/one-time-order-completion-response.dto';
import type { OneTimeOrderResponseDto } from '../src/modules/one-time-orders/dto/one-time-order-response.dto';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

// Main sequential isolated runner only. Target the remaining named catalog
// actions, not the frozen core/workforce suites. OQ-144 remains OPEN: no Employee
// contract sums, cash remainder formula, payroll inference or historical rewrite.
// Lifecycle grant matrices use explicit zero-payment records. Only two paid
// fixtures create tiny local-schema receipts; corrections retain reversal chains.
const covered = ['finance.read', 'complete', 'reopen', 'copy', 'payments.create', 'payments.correct',
  'review.edit', 'review.delete', 'review.view_all', 'managers.manage'] as const;

test('order finance/review grants enforce live scope and immutable payment history over actual HTTP', { timeout: 180_000 }, async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.MINIO_ENDPOINT ?? ''));
  assert.equal(process.env.MINIO_USE_SSL, 'false');
  for (const suffix of covered) {
    const definition = ACCESS_ACTION_CATALOG.find((entry) => entry.code === `one_time_orders.${suffix}`);
    assert.ok(definition?.manageable, suffix);
    for (const scope of ['selected', 'all'] as const) assert.ok(definition.allowedScopes.includes(scope), suffix);
  }
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => { try { await closeApp?.(); } finally { await prisma.$disconnect(); } });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const marker = `acl-order-finance-${randomUUID()}`;
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const newUser = async (label: string, roleCode: string) => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    return prisma.user.create({ data: { login: `${marker}-${label}`, fullName: `${marker} ${label}`, passwordHash: template.passwordHash,
      isActive: true, roles: { create: { roleId: role.id } } } });
  };
  const actor = await newUser('operator', 'operation_manager');
  const payee = await newUser('payee', 'manager');
  const other = await newUser('other-payee', 'manager');
  const spare = await newUser('assignment-target', 'manager');
  const userIds = [actor.id, payee.id, other.id, spare.id];
  const identities = () => prisma.user.findMany({ where: { id: { in: userIds } }, include: { roles: true, permissions: true }, orderBy: { id: 'asc' } });
  const originalIdentities = await identities();
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' });
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const payeeCookie = await loginAndGetCookieHeader({ baseUrl, login: payee.login, password: 'manager123' });
  // These exact pre-grant cookies are retained throughout every rule change.
  const request = (path: string, method = 'GET', body?: unknown, session = cookie) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: session, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, status = 200): Promise<T> => {
    const text = await response.text();
    assert.equal(response.status, status, text);
    return JSON.parse(text) as T;
  };
  const rule = (suffix: string, effect: 'allow' | 'deny', scope: 'selected' | 'all', selectedIds: string[] = [], userId = actor.id) => {
    assert.ok(userIds.includes(userId));
    const actionCode = `one_time_orders.${suffix}`;
    assert.ok(ACCESS_ACTION_CATALOG.find((entry) => entry.code === actionCode)?.allowedScopes.includes(scope));
    return prisma.userAccessRule.upsert({ where: { userId_actionCode: { userId, actionCode } },
      create: { userId, actionCode, effect, scope, selectedIds }, update: { effect, scope, selectedIds } });
  };
  const revoke = (suffix: string, userId = actor.id) => prisma.userAccessRule.deleteMany({ where: { userId, actionCode: `one_time_orders.${suffix}` } });
  const reset = () => prisma.userAccessRule.deleteMany({ where: { userId: { in: userIds } } });
  let sequence = 0;
  const input = (sum = 0) => ({ title: `${marker}-${++sequence}`, executionAddress: 'Synthetic finance address', contactName: 'Synthetic client',
    status: 'in_progress', agreedSum: sum, plannedPaymentMethod: 'cash', financialNotes: `${marker}-private-finance`, expenseNotes: `${marker}-private-expenses` });
  const create = (sum = 0) => request('/one-time-orders', 'POST', { ...input(sum), managerUserIds: [payee.id, other.id] }, founderCookie)
    .then((response) => json<OneTimeOrderResponseDto>(response, 201));
  const root = (id: string) => `/one-time-orders/${id}`;
  const card = (id: string, session = cookie) => request(root(id), 'GET', undefined, session).then((response) => json<OneTimeOrderResponseDto>(response));
  const zero = async (id: string) => ({ workCycle: (await prisma.oneTimeOrder.findUniqueOrThrow({ where: { id } })).workCycle,
    clientRequestId: randomUUID(), payments: [{ amount: 0, zeroReason: 'free_order' }] });
  const a = await create();
  const b = await create();
  const paidA = await create(13);
  const paidB = await create(17);
  const initialCompletions = new Map<string, OneTimeOrderCompletionResponseDto>();
  for (const [order, first, second] of [[paidA, 7, 6], [paidB, 9, 8]] as const) {
    const completion = await json<OneTimeOrderCompletionResponseDto>(await request(`${root(order.id)}/complete`, 'POST', {
      workCycle: 1, clientRequestId: randomUUID(), payments: [
        { amount: first, recipientUserId: payee.id, paymentMethod: 'cash', paymentDestination: 'manager_accountability' },
        { amount: second, recipientUserId: other.id, paymentMethod: 'cash', paymentDestination: 'manager_accountability' },
      ],
    }, founderCookie), 201);
    initialCompletions.set(order.id, completion);
  }
  const snapshot = async () => {
    const orders = await prisma.oneTimeOrder.findMany({ where: { title: { startsWith: marker } }, orderBy: { id: 'asc' } });
    const ids = orders.map((entry) => entry.id);
    const [assignments, completions, payments, funding, expenses, accounts, approvals, audits, notifications, users] = await Promise.all([
      prisma.oneTimeOrderAssignment.findMany({ where: { oneTimeOrderId: { in: ids } }, orderBy: { id: 'asc' } }),
      prisma.oneTimeOrderCompletion.findMany({ where: { oneTimeOrderId: { in: ids } }, orderBy: { id: 'asc' } }),
      prisma.oneTimeOrderCompletionPayment.findMany({ where: { oneTimeOrderId: { in: ids } }, orderBy: { id: 'asc' } }),
      prisma.accountabilityFunding.findMany({ where: { oneTimeOrderId: { in: ids } }, orderBy: { id: 'asc' } }),
      prisma.accountabilityExpense.findMany({ where: { OR: [{ oneTimeOrderId: { in: ids } }, { accountabilityAccount: { userId: { in: userIds } } }] }, orderBy: { id: 'asc' } }),
      prisma.accountabilityAccount.findMany({ where: { userId: { in: userIds } }, orderBy: { id: 'asc' } }),
      prisma.approvalRequest.findMany({ where: { OR: [{ createdByUserId: { in: userIds } }, { sourceEntityId: { in: ids } }] }, orderBy: { id: 'asc' } }),
      prisma.auditEvent.findMany({ where: { OR: [{ entityType: 'one_time_order', entityId: { in: ids } }, { actorUserId: { in: userIds } },
        { entityType: 'accountability_funding', entityId: { in: (await prisma.accountabilityFunding.findMany({ where: { oneTimeOrderId: { in: ids } }, select: { id: true } })).map((entry) => entry.id) } }] }, orderBy: { id: 'asc' } }),
      prisma.notification.findMany({ where: { OR: [{ recipientUserId: { in: userIds } }, { entityType: 'one_time_order', entityId: { in: ids } }] }, orderBy: { id: 'asc' } }),
      identities(),
    ]);
    return { orders, assignments, completions, payments, funding, expenses, accounts, approvals, audits, notifications, users };
  };
  type Snapshot = Awaited<ReturnType<typeof snapshot>>;
  const rejected = async (path: string, method = 'GET', body?: unknown, status = 403, session = cookie) => {
    const before = await snapshot();
    const response = await request(path, method, body, session);
    const text = await response.text();
    assert.deepEqual(await snapshot(), before, `${method} ${path}: rejected requests preserve order, immutable ledger, audit and notifications (${response.status}: ${text})`);
    assert.equal(response.status, status, `${method} ${path}: ${text}`);
  };
  const unchanged = (before: Snapshot, after: Snapshot, except: Array<keyof Snapshot>) => {
    for (const key of Object.keys(before) as Array<keyof Snapshot>) if (!except.includes(key)) assert.deepEqual(after[key], before[key], key);
  };
  const audit = async (before: Snapshot, id: string, action: string) => {
    const events = (await snapshot()).audits.filter((entry) => !before.audits.some((old) => old.id === entry.id) && entry.entityId === id && entry.action === action);
    assert.equal(events.length, 1, action);
    assert.equal(events[0]!.actorUserId, actor.id);
    return events[0]!;
  };
  const stage = async (id: string, completed: boolean) => {
    const order = await prisma.oneTimeOrder.findUniqueOrThrow({ where: { id } });
    if ((order.status === 'completed') === completed) return;
    await json(await request(`${root(id)}/${completed ? 'complete' : 'reopen'}`, 'POST', completed ? await zero(id) : undefined, founderCookie), 201);
  };

  await t.test('finance.read selected/all never exposes another recipient ledger and denial redacts card fields', async () => {
    try {
      const check = async (order: OneTimeOrderResponseDto, visible: boolean, ownAmount: number) => {
        const before = await snapshot();
        const view = await card(order.id, payeeCookie);
        for (const key of ['agreedSum', 'plannedPaymentMethod', 'financialNotes', 'expenseNotes'] as const) assert.equal(view[key], visible ? order[key] : null);
        if (!visible) await rejected(`${root(order.id)}/completions`, 'GET', undefined, 403, payeeCookie);
        else {
          const entries = await json<OneTimeOrderCompletionResponseDto[]>(await request(`${root(order.id)}/completions`, 'GET', undefined, payeeCookie));
          assert.equal(entries[0]!.visibleTotalAmount, ownAmount);
          assert.equal(entries[0]!.fullTotalAmountVisible, false);
          const hidden = entries[0]!.payments.filter((entry) => entry.detailsRestricted);
          assert.equal(hidden.length, 1);
          assert.deepEqual(Object.keys(hidden[0]!).sort(), ['detailsRestricted', 'id']);
        }
        assert.deepEqual(await snapshot(), before);
      };
      await check(paidA, true, 7);
      await rule('finance.read', 'allow', 'selected', [paidA.id], payee.id);
      await check(paidA, true, 7);
      await check(paidB, true, 9);
      await rule('finance.read', 'deny', 'selected', [paidA.id], payee.id);
      await check(paidA, false, 7);
      await check(paidB, true, 9);
      await revoke('finance.read', payee.id);
      await check(paidA, true, 7);
      await rule('finance.read', 'deny', 'all', [], payee.id);
      await check(paidA, false, 7);
      await check(paidB, false, 9);
      await rule('finance.read', 'allow', 'all', [], payee.id);
      for (const parent of ['read', 'access']) {
        await rule(parent, 'deny', 'selected', [paidA.id], payee.id);
        await rejected(root(paidA.id), 'GET', undefined, 403, payeeCookie);
        await rejected(`${root(paidA.id)}/completions`, 'GET', undefined, 403, payeeCookie);
        await check(paidB, true, 9);
        await revoke(parent, payee.id);
      }
      await rejected(`/accountability/accounts/${other.id}`, 'GET', undefined, 403, payeeCookie);
    } finally { await reset(); }
  });

  for (const leaf of ['complete', 'payments.create', 'reopen'] as const) {
    await t.test(`${leaf}: real selected/all workflow, default/revoke and parent denial preserve cycles and ledger`, async () => {
      try {
        await rule('read', 'allow', 'all');
        if (leaf === 'complete') await rule('payments.create', 'allow', 'all');
        if (leaf === 'payments.create') await rule('complete', 'allow', 'all');
        const attempt = async (id: string, allowed: boolean) => {
          await stage(id, leaf === 'reopen');
          const body = leaf === 'reopen' ? undefined : await zero(id);
          const path = `${root(id)}/${leaf === 'reopen' ? 'reopen' : 'complete'}`;
          if (!allowed) { await rejected(path, 'POST', body); return; }
          const before = await snapshot();
          const old = before.orders.find((entry) => entry.id === id)!;
          const result = await json<{ id: string }>(await request(path, 'POST', body), 201);
          const after = await snapshot();
          const stored = after.orders.find((entry) => entry.id === id)!;
          assert.equal(stored.status, leaf === 'reopen' ? 'in_progress' : 'completed');
          assert.equal(stored.workCycle, old.workCycle + (leaf === 'reopen' ? 1 : 0));
          assert.deepEqual(after.orders.filter((entry) => entry.id !== id), before.orders.filter((entry) => entry.id !== id));
          if (leaf === 'reopen') {
            assert.equal(stored.completedAt, null);
            assert.equal(stored.completedByUserId, null);
            assert.deepEqual(after.payments, before.payments);
            assert.equal(after.completions.length, before.completions.length);
            assert.equal(after.completions.find((entry) => entry.oneTimeOrderId === id && entry.workCycle === old.workCycle)!.status, 'superseded');
          } else {
            assert.equal(stored.completedByUserId, actor.id);
            assert.ok(stored.completedAt);
            assert.equal(after.completions.length, before.completions.length + 1);
            const completion = after.completions.find((entry) => entry.id === result.id)!;
            assert.equal(completion.oneTimeOrderId, id);
            assert.equal(completion.workCycle, old.workCycle);
            const rows = after.payments.filter((entry) => entry.completionId === result.id);
            assert.equal(rows.length, 1);
            assert.equal(Number(rows[0]!.amount), 0);
            assert.equal(rows[0]!.zeroReason, 'free_order');
          }
          unchanged(before, after, ['orders', 'completions', 'payments', 'audits']);
          await audit(before, id, `one_time_order.${leaf === 'reopen' ? 'reopened' : 'completed'}`);
          if (body) {
            assert.equal((await json<{ id: string }>(await request(path, 'POST', body), 201)).id, result.id);
            assert.deepEqual(await snapshot(), after, 'Completion retry cannot create another payment or receipt');
          } else await rejected(path, 'POST', undefined, 409);
        };
        await attempt(a.id, false);
        await rule(leaf, 'allow', 'selected', [a.id]);
        await attempt(a.id, true);
        await attempt(b.id, false);
        await rule(leaf, 'deny', 'selected', [a.id]);
        await attempt(a.id, false);
        await revoke(leaf);
        await attempt(a.id, false);
        await rule(leaf, 'allow', 'all');
        await attempt(b.id, true);
        for (const parent of ['read', 'access']) {
          await rule(parent, 'deny', 'selected', [a.id]);
          await attempt(a.id, false);
          if (parent === 'read') {
            // Replacing this unassigned actor's sole read allow also removes
            // B's positive read source. Restore it before asserting success.
            await rejected(root(b.id), 'GET', undefined, 404);
            await rule('read', 'allow', 'all');
          }
          await attempt(b.id, true);
          await revoke(parent);
          await rule('read', 'allow', 'all');
        }
        await rule(leaf, 'deny', 'all');
        await attempt(a.id, false);
        await attempt(b.id, false);
      } finally { await reset(); }
    });
  }

  await t.test('payments.correct adds audited reversal/replacement chains without duplicate or cross-order effects', async () => {
    try {
      await rule('read', 'allow', 'all');
      const attempt = async (id: string, allowed: boolean) => {
        const source = await prisma.oneTimeOrderCompletionPayment.findFirstOrThrow({ where: { oneTimeOrderId: id, recipientUserId: payee.id, status: 'active' } });
        const body = { correctedAmount: Number(source.amount) + 1, recipientUserId: payee.id, paymentMethod: 'cash', paymentDestination: 'manager_accountability', reason: 'Synthetic receipt correction' };
        const path = `${root(id)}/payments/${source.id}/correct`;
        if (!allowed) { await rejected(path, 'POST', body); return; }
        const before = await snapshot();
        await json(await request(path, 'POST', body), 201);
        const after = await snapshot();
        const previous = after.payments.find((entry) => entry.id === source.id)!;
        const reversal = after.payments.find((entry) => entry.reversalOfPaymentId === source.id)!;
        const replacement = after.payments.find((entry) => entry.correctedFromPaymentId === source.id)!;
        assert.equal(previous.status, 'reversed');
        assert.equal(previous.reversedByPaymentId, reversal.id);
        assert.equal(previous.correctedByPaymentId, replacement.id);
        assert.equal(Number(previous.amount), Number(source.amount), 'Posted source amount is immutable');
        assert.equal(reversal.status, 'reversal');
        assert.equal(replacement.status, 'active');
        assert.equal(Number(replacement.amount), body.correctedAmount);
        assert.equal(after.payments.length, before.payments.length + 2);
        const oldFunding = before.funding.find((entry) => entry.oneTimeOrderPaymentId === source.id)!;
        const sourceFunding = after.funding.find((entry) => entry.id === oldFunding.id)!;
        const reverseFunding = after.funding.find((entry) => entry.reversalOfFundingId === oldFunding.id)!;
        const newFunding = after.funding.find((entry) => entry.oneTimeOrderPaymentId === replacement.id)!;
        assert.equal(sourceFunding.reversedByFundingId, reverseFunding.id);
        assert.equal(Number(sourceFunding.amount), Number(oldFunding.amount));
        assert.equal(reverseFunding.entryDirection, 'debit');
        assert.equal(Number(reverseFunding.amount), Number(source.amount));
        assert.equal(newFunding.entryDirection, 'credit');
        assert.equal(Number(newFunding.amount), body.correctedAmount);
        assert.equal(after.funding.length, before.funding.length + 2);
        const net = (rows: Snapshot['funding']) => rows.filter((entry) => entry.oneTimeOrderId === id).reduce((sum, entry) => sum + Number(entry.amount) * (entry.entryDirection === 'credit' ? 1 : -1), 0);
        assert.equal(net(after.funding) - net(before.funding), 1);
        assert.deepEqual(after.payments.filter((entry) => entry.oneTimeOrderId !== id), before.payments.filter((entry) => entry.oneTimeOrderId !== id));
        assert.deepEqual(after.funding.filter((entry) => entry.oneTimeOrderId !== id), before.funding.filter((entry) => entry.oneTimeOrderId !== id));
        unchanged(before, after, ['payments', 'funding', 'audits', 'accounts']);
        await audit(before, id, 'one_time_order.payment_corrected');
        await rejected(path, 'POST', body, 409);
      };
      await attempt(paidA.id, false);
      await rule('payments.correct', 'allow', 'selected', [paidA.id]);
      await rejected(`${root(paidA.id)}/payments/${initialCompletions.get(paidB.id)!.payments[0]!.id}/correct`, 'POST', { correctedAmount: 1, reason: marker }, 404);
      const active = await prisma.oneTimeOrderCompletionPayment.findFirstOrThrow({ where: { oneTimeOrderId: paidA.id, recipientUserId: payee.id, status: 'active' } });
      await rejected(`${root(paidA.id)}/payments/${active.id}/correct`, 'POST', { correctedAmount: 1, reason: ' ' }, 400);
      await attempt(paidA.id, true);
      await attempt(paidB.id, false);
      await rule('payments.correct', 'deny', 'selected', [paidA.id]);
      await attempt(paidA.id, false);
      await revoke('payments.correct');
      await attempt(paidA.id, false);
      await rule('payments.correct', 'allow', 'all');
      await attempt(paidB.id, true);
      for (const parent of ['read', 'access']) {
        await rule(parent, 'deny', 'selected', [paidA.id]);
        await attempt(paidA.id, false);
        await attempt(paidB.id, true);
        await revoke(parent);
        await rule('read', 'allow', 'all');
      }
      await rule('payments.correct', 'deny', 'all');
      await attempt(paidA.id, false);
      await attempt(paidB.id, false);
      await rejected(`/accountability/accounts/${other.id}`);
    } finally { await reset(); }
  });

  for (const leaf of ['copy', 'review.edit', 'review.delete', 'managers.manage'] as const) {
    await t.test(`${leaf}: actual selected/all writes remain independent, auditable and parent constrained`, async () => {
      try {
        await rule('read', 'allow', 'all');
        const attempt = async (id: string, allowed: boolean, copyStatus: 'new' | 'completed' = 'new') => {
          if (leaf === 'review.delete') await json(await request(`${root(id)}/review`, 'PATCH', { reviewText: `${marker}-restore-${++sequence}` }, founderCookie));
          const before = await snapshot();
          const old = before.orders.find((entry) => entry.id === id)!;
          const assignment = before.assignments.find((entry) => entry.oneTimeOrderId === id && entry.userId === spare.id);
          const remove = leaf === 'managers.manage' && assignment?.isActive;
          const path = `${root(id)}${leaf === 'copy' ? '/copy' : leaf === 'managers.manage' ? `/managers${remove ? `/${spare.id}` : ''}` : '/review'}`;
          const method = leaf === 'review.edit' ? 'PATCH' : leaf === 'review.delete' || remove ? 'DELETE' : 'POST';
          const body = leaf === 'copy' ? { ...input(old.agreedSum ?? 0), status: copyStatus, creationRequestId: randomUUID() }
            : leaf === 'review.edit' ? { reviewText: `${marker}-review-${++sequence}`, reviewRating: 4.5 }
            : leaf === 'managers.manage' && !remove ? { userId: spare.id } : undefined;
          if (!allowed) { await rejected(path, method, body); return; }
          const changed = await json<OneTimeOrderResponseDto>(await request(path, method, body), method === 'POST' ? 201 : 200);
          const after = await snapshot();
          if (leaf === 'copy') {
            const stored = after.orders.find((entry) => entry.id === changed.id)!;
            assert.notEqual(changed.id, id);
            assert.equal(changed.status, 'new');
            assert.equal(changed.workCycle, 1);
            assert.equal(stored.createdByUserId, actor.id);
            assert.equal(stored.status, 'new');
            assert.equal(stored.workCycle, 1);
            assert.equal(stored.completedAt, null);
            assert.equal(stored.completedByUserId, null);
            assert.equal(stored.reviewText, null);
            assert.equal(stored.reviewRating, null);
            assert.equal(after.orders.length, before.orders.length + 1);
            assert.deepEqual(after.orders.filter((entry) => entry.id !== changed.id), before.orders);
            unchanged(before, after, ['orders', 'assignments', 'audits', 'notifications']);
            const copiedAudit = await audit(before, changed.id, 'one_time_order.copied');
            if (copyStatus === 'completed') {
              const events = after.audits.filter((entry) => !before.audits.some((oldEvent) => oldEvent.id === entry.id));
              const rooms = await prisma.chatRoom.findMany({ where: { code: { in: ['one_time_orders', 'leadership'] } }, select: { id: true, code: true } });
              assert.deepEqual(rooms.map((room) => room.code).sort(), ['leadership', 'one_time_orders']);
              const expectedEventIds = [copiedAudit.id];
              for (const room of rooms) {
                const chatEvents = events.filter((entry) => entry.action === 'chat.system_message.created' && entry.entityType === 'chat_room' && entry.entityId === room.id);
                assert.equal(chatEvents.length, 1, `Exactly one copy system-message audit in ${room.code}`);
                const event = chatEvents[0]!;
                assert.equal(event.actorUserId, actor.id);
                assert.deepEqual(event.newValues, {
                  code: room.code,
                  text: `Создан разовый заказ: ${stored.title}`,
                  metadata: { oneTimeOrderId: changed.id, status: 'new', linkedObjectId: stored.linkedObjectId, sourceOneTimeOrderId: id },
                });
                expectedEventIds.push(event.id);
              }
              assert.deepEqual(events.map((event) => event.id).sort(), expectedEventIds.sort(),
                'Exactly one copy audit and its two mapped system-message audits; no completion/payment or unrelated events');
            }
            const replay = await json<{ id: string }>(await request(path, method, body), 201);
            assert.equal(replay.id, changed.id);
            assert.deepEqual(await snapshot(), after);
            await rejected('/one-time-orders', 'POST', input());
          } else if (leaf === 'managers.manage') {
            const row = after.assignments.find((entry) => entry.oneTimeOrderId === id && entry.userId === spare.id)!;
            assert.equal(row.isActive, !remove);
            assert.equal(row.assignmentRoleCode, 'one_time_manager');
            assert.deepEqual(after.assignments.filter((entry) => entry.id !== row.id), before.assignments.filter((entry) => entry.id !== row.id));
            unchanged(before, after, ['assignments', 'audits', 'notifications']);
            await audit(before, id, `one_time_order.manager_${remove ? 'removed' : 'added'}`);
          } else {
            const stored = after.orders.find((entry) => entry.id === id)!;
            assert.equal(changed.id, id);
            if (leaf === 'review.edit') {
              assert.equal(stored.reviewRating, 4.5);
              assert.equal(stored.reviewUpdatedByUserId, actor.id);
              assert.ok(stored.reviewText?.startsWith(marker));
              assert.ok(stored.reviewUpdatedAt);
            } else {
              for (const key of ['reviewText', 'reviewRating', 'reviewUpdatedAt', 'reviewUpdatedByUserId'] as const) assert.equal(stored[key], null);
            }
            assert.deepEqual(stored, { ...old, updatedAt: stored.updatedAt, reviewText: stored.reviewText, reviewRating: stored.reviewRating,
              reviewUpdatedAt: stored.reviewUpdatedAt, reviewUpdatedByUserId: stored.reviewUpdatedByUserId });
            assert.deepEqual(after.orders.filter((entry) => entry.id !== id), before.orders.filter((entry) => entry.id !== id));
            unchanged(before, after, ['orders', 'audits']);
            await audit(before, id, `one_time_order.review_${leaf === 'review.edit' ? 'updated' : 'cleared'}`);
          }
        };
        await attempt(paidA.id, false);
        await rule(leaf, 'allow', 'selected', [paidA.id]);
        await attempt(paidA.id, true);
        await attempt(paidB.id, false);
        await rule(leaf, 'deny', 'selected', [paidA.id]);
        await attempt(paidA.id, false);
        await revoke(leaf);
        await attempt(paidA.id, false);
        await rule(leaf, 'allow', 'all');
        await attempt(paidB.id, true);
        for (const parent of ['read', 'access']) {
          await rule(parent, 'deny', 'selected', [paidA.id]);
          await attempt(paidA.id, false);
          if (parent === 'read') {
            // Rules are unique per user/action: deny A replaces read allow,
            // so control B needs its explicit positive read source restored.
            await rejected(root(paidB.id), 'GET', undefined, 404);
            await rule('read', 'allow', 'all');
          }
          await attempt(paidB.id, true);
          await revoke(parent);
          await rule('read', 'allow', 'all');
        }
        if (leaf === 'managers.manage') await rejected(`${root(paidA.id)}/managers`, 'POST', { userId: founder.id });
        // Copy resets lifecycle regardless of the inherited Create DTO status:
        // assert a new record, one audit and unchanged ledger rather than inventing a 409.
        if (leaf === 'copy') await attempt(paidA.id, true, 'completed');
        await rule(leaf, 'deny', 'all');
        await attempt(paidA.id, false);
        await attempt(paidB.id, false);
      } finally { await reset(); }
    });
  }

  await t.test('review.view_all expands the real registry with selected/all grants, source denial before pagination and no finance escalation', async () => {
    try {
      for (const order of [paidA, paidB]) await json(await request(`${root(order.id)}/review`, 'PATCH', { reviewText: `${marker}-registry`, reviewRating: 5 }, founderCookie));
      await rule('read', 'allow', 'all');
      const path = `/one-time-orders/reviews?q=${marker}&limit=1`;
      const listing = async (expected: string[]) => {
        const before = await snapshot();
        const body = await json<{ total: number; items: Array<{ id: string }> }>(await request(path));
        assert.equal(body.total, expected.length);
        assert.equal(body.items.length, Math.min(1, expected.length));
        assert.ok(body.items.every((entry) => expected.includes(entry.id)));
        assert.deepEqual(await snapshot(), before);
      };
      await rejected(path);
      await rule('review.view_all', 'allow', 'selected', [paidA.id]);
      await listing([paidA.id]);
      await revoke('review.view_all');
      await rejected(path);
      await rule('review.view_all', 'allow', 'all');
      await listing([paidA.id, paidB.id]);
      for (const parent of ['read', 'access']) {
        await rule(parent, 'deny', 'selected', [paidA.id]);
        await listing([paidB.id]);
        await revoke(parent);
        await rule('read', 'allow', 'all');
      }
      await rule('finance.read', 'deny', 'all');
      await listing([paidA.id, paidB.id]);
      assert.equal((await card(paidA.id)).agreedSum, null);
      const activePayment = await prisma.oneTimeOrderCompletionPayment.findFirstOrThrow({ where: { oneTimeOrderId: paidA.id, recipientUserId: payee.id, status: 'active' } });
      await rejected(`${root(paidA.id)}/payments/${activePayment.id}/correct`, 'POST', { correctedAmount: 1, reason: marker });
      await rule('review.view_all', 'deny', 'all');
      await rejected(path);
    } finally { await reset(); }
  });

  assert.deepEqual(await identities(), originalIdentities, 'No role, global ledger permission or User/Employee identity escalation');
  // Runner drops its own schema. No shared/seed cleanup, commits or runtime edits.
});
