import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient, type Prisma } from '@prisma/client';
import { AuditService } from '../src/modules/audit/audit.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('candidate creation keeps a bounded atomic assignment/audit/outbox transaction and observes uncommitted source denies', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());
  const { app, baseUrl } = await createTestApp();
  t.after(() => app.close());
  const creator = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const managers = await prisma.user.findMany({ where: { login: { in: ['manager1', 'manager2'] } }, orderBy: { login: 'asc' } });
  assert.equal(managers.length, 2);
  const deniedHr = await prisma.user.findUniqueOrThrow({ where: { login: 'kireeva' } });
  const visibleHr = await prisma.user.findUniqueOrThrow({ where: { login: 'hr1' } });
  const deny = await prisma.userAccessRule.create({ data: {
    userId: deniedHr.id, actionCode: 'candidates.view', effect: 'deny', scope: 'all', selectedIds: [],
  } });
  t.after(() => prisma.userAccessRule.delete({ where: { id: deny.id } }));
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: creator.login, password: 'founder123' });
  const marker = `candidate-atomic-${randomUUID()}`;
  let sequence = 0;
  const send = () => fetch(`${baseUrl}/api/v1/candidates`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({ fullName: `${marker}-${++sequence}`, phones: ['+79991234567'], candidateType: 'reserve',
      assignments: managers.map((manager) => ({ managerUserId: manager.id })) }),
  });
  const audit = app.get(AuditService);
  const original = audit.writeAuditEvent;
  const inserted: Array<{ entityType: string; entityId: string }> = [];
  let delayed = false;
  let injected = false;
  audit.writeAuditEvent = async (...args: Parameters<AuditService['writeAuditEvent']>) => {
    const [input, tx] = args;
    await original.apply(audit, args);
    if (input.actorUserId !== creator.id || input.entityType !== 'candidate') return;
    assert.ok(tx, 'Candidate audit must use the business transaction');
    inserted.push({ entityType: input.entityType, entityId: input.entityId });
    if (input.action === 'candidate.created' && !delayed) {
      delayed = true;
      // Controlled scheduling boundary exceeds Prisma's former 5s default.
      // No external I/O is introduced into the production transaction.
      await new Promise((resolve) => setTimeout(resolve, 5_100));
    }
    if (input.action === 'candidate.manager_assigned' && !injected) {
      assert.ok('notification' in tx && 'notificationOutbox' in tx, 'The real transaction client must reach the audit boundary');
      const transaction = tx as Prisma.TransactionClient;
      assert.equal(await transaction.notification.count({ where: { entityType: 'candidate', entityId: input.entityId } }), 1);
      assert.equal(await transaction.notificationOutbox.count({ where: { notification: { entityType: 'candidate', entityId: input.entityId } } }), 1);
      injected = true;
      throw new Error('Controlled candidate audit failure after notification/outbox insertion');
    }
  };
  t.after(() => { audit.writeAuditEvent = original; });

  await t.test('delayed transaction reaches the intended failure and rolls back every related record', async () => {
    try {
      const response = await send();
      assert.equal(response.status, 500, await response.text());
      assert.equal(delayed, true);
      assert.equal(injected, true, 'A timeout or unrelated 500 cannot satisfy this rollback test');
      const candidateIds = [...new Set(inserted.map((row) => row.entityId))];
      assert.equal(candidateIds.length, 1);
      assert.equal(await prisma.candidate.count({ where: { id: { in: candidateIds } } }), 0);
      assert.equal(await prisma.candidateManagerAssignment.count({ where: { candidateId: { in: candidateIds } } }), 0);
      assert.equal(await prisma.notification.count({ where: { entityType: 'candidate', entityId: { in: candidateIds } } }), 0);
      assert.equal(await prisma.notificationOutbox.count({ where: { notification: { entityType: 'candidate', entityId: { in: candidateIds } } } }), 0);
      assert.equal(await prisma.auditEvent.count({ where: { entityType: 'candidate', entityId: { in: candidateIds } } }), 0);
    } finally { audit.writeAuditEvent = original; }
  });
  await t.test('successful explicit retry creates one candidate and excludes source-denied HR from notification/outbox', async () => {
    const service = app.get(NotificationsService);
    const createForRecipients = service.createForRecipients;
    let verifiedOutbox = false;
    service.createForRecipients = async (...args: Parameters<NotificationsService['createForRecipients']>) => {
      const result = await createForRecipients.apply(service, args);
      const [input, tx] = args;
      if (input.type === 'candidate.created') {
        assert.ok(tx);
        // Inspect before commit: the background publisher cannot drain these
        // rows, and the new candidate is only visible on this connection.
        assert.equal(await tx.notificationOutbox.count({ where: {
          recipientUserId: deniedHr.id, notification: { entityType: 'candidate', entityId: input.entityId },
        } }), 0);
        assert.equal(await tx.notificationOutbox.count({ where: {
          recipientUserId: visibleHr.id, notification: { entityType: 'candidate', entityId: input.entityId },
        } }), 1);
        verifiedOutbox = true;
      }
      return result;
    };
    let response: Response;
    try { response = await send(); } finally { service.createForRecipients = createForRecipients; }
    assert.equal(response.status, 201, await response.clone().text());
    assert.equal(verifiedOutbox, true);
    const result = await response.json() as { id: string };
    assert.equal(await prisma.candidate.count({ where: { fullName: { startsWith: marker } } }), 1);
    assert.equal(await prisma.candidateManagerAssignment.count({ where: { candidateId: result.id, endedAt: null } }), 2);
    const notifications = await prisma.notification.findMany({ where: { entityType: 'candidate', entityId: result.id } });
    assert.equal(notifications.some((row) => row.recipientUserId === deniedHr.id), false);
    assert.equal(notifications.filter((row) => row.recipientUserId === visibleHr.id && row.type === 'candidate.created').length, 1);
    for (const manager of managers) assert.equal(notifications.filter((row) => row.recipientUserId === manager.id && row.type === 'candidate.assigned').length, 1);
    assert.equal(await prisma.auditEvent.count({ where: { entityType: 'candidate', entityId: result.id, action: 'candidate.created' } }), 1);
    assert.equal(await prisma.auditEvent.count({ where: { entityType: 'candidate', entityId: result.id, action: 'candidate.manager_assigned' } }), 2);
  });
});
