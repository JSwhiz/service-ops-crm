import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient, type Prisma } from '@prisma/client';

import { AuditService } from '../src/modules/audit/audit.service';
import { ChatsService } from '../src/modules/chats/chats.service';
import type { ObjectResponseDto } from '../src/modules/objects/dto/object-response.dto';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

// Only POST /objects: dual audit rollback, generated-card read deny, one explicit
// retry after each failure. No generic create-idempotency contract is assumed.
test('object create atomically persists business data, both audits and notification outbox', async (t) => {
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
  const marker = `object-create-atomic-${randomUUID()}`;
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'manager' } });
  const colleague = await prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } });
  const actor = await prisma.user.create({ data: {
    login: marker, fullName: marker, passwordHash: template.passwordHash,
    isActive: true, roles: { create: { roleId: role.id } },
  } });
  await prisma.userAccessRule.create({ data: {
    userId: actor.id, actionCode: 'objects.create', effect: 'allow', scope: 'all', selectedIds: [],
  } });
  // Grant/deny/revoke checks below reuse this exact session.
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const audit = app.get(AuditService);
  const chats = app.get(ChatsService);
  const originalEvent = audit.writeAuditEvent;
  const originalLog = audit.writeObjectAuditLog;
  const originalMessage = chats.createSystemMessage;
  const chatCalls: Array<{ room: string; objectId: unknown }> = [];
  chats.createSystemMessage = async (...args: Parameters<ChatsService['createSystemMessage']>) => {
    if (args[3] === actor.id) chatCalls.push({ room: args[0], objectId: args[2]?.objectId });
    // Observation only: successful HTTP retries still use the real chat service.
    return originalMessage.apply(chats, args);
  };
  lifecycle.restore = () => {
    audit.writeAuditEvent = originalEvent;
    audit.writeObjectAuditLog = originalLog;
    chats.createSystemMessage = originalMessage;
  };
  let sequence = 0;
  const input = () => ({
    name: `${marker}-${++sequence}`, internalName: `${marker}-internal-${sequence}`,
    address: 'Isolated atomic creation', status: 'active', notes: 'Atomic fixture',
    responsibleUserId: actor.id, managerUserIds: [colleague.id],
    contacts: [{ name: `${marker}-contact-${sequence}`, phones: ['+79990000001'] }],
  });
  type Input = ReturnType<typeof input>;
  const send = (payload: Input) => fetch(`${baseUrl}/api/v1/objects`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000),
  });
  const snapshot = async () => ({
    objects: await prisma.object.findMany({ orderBy: { id: 'asc' } }),
    assignments: await prisma.objectAssignment.findMany({ orderBy: { id: 'asc' } }),
    contacts: await prisma.objectContact.findMany({ orderBy: { id: 'asc' } }),
    genericAudit: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    objectAudit: await prisma.objectAuditLog.findMany({ orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    // Publication timestamps belong to the background delivery worker. Capture
    // durable queue identity/content, not its independently advancing state.
    outbox: await prisma.notificationOutbox.findMany({ orderBy: { id: 'asc' }, select: {
      id: true, notificationId: true, recipientUserId: true, createdAt: true,
    } }),
    messages: await prisma.chatMessage.findMany({ orderBy: { id: 'asc' } }),
    approvals: await prisma.approvalRequest.findMany({ orderBy: { id: 'asc' } }),
    files: await prisma.fileAttachment.findMany({ orderBy: { id: 'asc' } }),
    setup: await prisma.objectSetup.findMany({ orderBy: { objectId: 'asc' } }),
    planning: await prisma.objectPlanningSettings.findMany({ orderBy: { objectId: 'asc' } }),
    positions: await prisma.objectStaffPosition.findMany({ orderBy: { id: 'asc' } }),
    contours: await prisma.objectPayContour.findMany({ orderBy: { id: 'asc' } }),
    staffing: await prisma.objectEmployeeAssignment.findMany({ orderBy: { id: 'asc' } }),
    attendance: await prisma.objectAttendanceFact.findMany({ orderBy: { id: 'asc' } }),
    inventory: await prisma.inventoryMovement.findMany({ orderBy: { id: 'asc' } }),
    equipment: await prisma.equipmentMovement.findMany({ orderBy: { id: 'asc' } }),
  });
  type Snapshot = Awaited<ReturnType<typeof snapshot>>;

  const verifyInTransaction = async (tx: Prisma.TransactionClient, id: string, payload: Input) => {
    const stored = await tx.object.findUniqueOrThrow({ where: { id } });
    assert.equal(stored.name, payload.name);
    assert.equal(stored.createdByUserId, actor.id);
    const assignments = await tx.objectAssignment.findMany({ where: { objectId: id } });
    assert.deepEqual(assignments.map((row) => `${row.userId}:${row.assignmentRoleCode}:${row.isActive}`).sort(), [
      `${actor.id}:responsible:true`, `${colleague.id}:manager:true`,
    ].sort());
    assert.equal(await tx.objectContact.count({ where: { objectId: id, name: payload.contacts[0].name } }), 1);
    assert.equal(await tx.objectAuditLog.count({ where: { objectId: id, actionCode: 'object.contacts.created', actorUserId: actor.id } }), 1);
    const notifications = await tx.notification.findMany({ where: { entityType: 'object', entityId: id, type: 'object.created' } });
    assert.equal(notifications.filter((row) => row.recipientUserId === colleague.id).length, 1);
    assert.ok(notifications.length > 0);
    assert.equal(await tx.notificationOutbox.count({ where: { notificationId: { in: notifications.map((row) => row.id) } } }), notifications.length);
  };

  const retryOnce = async (payload: Input, before: Snapshot) => {
    const beforeChatCalls = chatCalls.length;
    const response = await send(payload); // Exactly one retry of the same body.
    const text = await response.text();
    assert.equal(response.status, 201, text);
    const result = JSON.parse(text) as ObjectResponseDto;
    const after = await snapshot();
    assert.equal(await prisma.object.count({ where: { name: payload.name } }), 1);
    assert.equal(after.objects.length, before.objects.length + 1);
    const stored = after.objects.find((row) => row.id === result.id)!;
    assert.ok(stored);
    assert.equal(stored.name, payload.name);
    assert.equal(stored.address, payload.address);
    assert.equal(stored.internalName, payload.internalName);
    assert.equal(stored.createdByUserId, actor.id);
    assert.equal(stored.status, 'active');
    assert.deepEqual(after.objects.filter((row) => row.id !== result.id), before.objects);
    assert.deepEqual(result.responsibles.map((row) => row.userId), [actor.id]);
    assert.deepEqual(result.managers.map((row) => row.userId), [colleague.id]);
    const assignments = after.assignments.filter((row) => row.objectId === result.id);
    assert.equal(assignments.length, 2);
    assert.ok(assignments.every((row) => row.isActive));
    assert.deepEqual(after.assignments.filter((row) => row.objectId !== result.id), before.assignments);
    const contacts = after.contacts.filter((row) => row.objectId === result.id);
    assert.equal(contacts.length, 1);
    assert.equal(contacts[0].name, payload.contacts[0].name);
    assert.deepEqual(contacts[0].phones, payload.contacts[0].phones);
    assert.deepEqual(after.contacts.filter((row) => row.objectId !== result.id), before.contacts);
    const allEvents = after.genericAudit.filter((row) => !before.genericAudit.some((old) => old.id === row.id));
    const events = allEvents.filter((row) => row.entityType === 'object');
    assert.equal(events.length, 1);
    assert.equal(events[0].entityType, 'object');
    assert.equal(events[0].entityId, result.id);
    assert.equal(events[0].action, 'object.created');
    assert.equal(events[0].actorUserId, actor.id);
    const chatEvents = allEvents.filter((row) => row.entityType === 'chat_room' && row.action === 'chat.system_message.created');
    assert.equal(chatEvents.length, 2, 'The two real post-commit system messages also write their own audit');
    assert.equal(allEvents.length, 3);
    assert.ok(chatEvents.every((row) => row.actorUserId === actor.id));
    assert.deepEqual(chatEvents.map((row) => (row.newValues as { code: string }).code).sort(), ['leadership', 'objects']);
    assert.ok(chatEvents.every((row) => (row.newValues as { metadata: { objectId: string } }).metadata.objectId === result.id));
    assert.deepEqual(after.genericAudit.filter((row) => !allEvents.some((added) => added.id === row.id)), before.genericAudit);
    const logs = after.objectAudit.filter((row) => !before.objectAudit.some((old) => old.id === row.id));
    assert.deepEqual(logs.map((row) => row.actionCode).sort(), ['object.contacts.created', 'object.created']);
    assert.ok(logs.every((row) => row.objectId === result.id && row.actorUserId === actor.id));
    assert.deepEqual(events[0].metadata, logs.find((row) => row.actionCode === 'object.created')!.payload);
    assert.deepEqual(after.objectAudit.filter((row) => !logs.some((added) => added.id === row.id)), before.objectAudit);
    const notifications = after.notifications.filter((row) => !before.notifications.some((old) => old.id === row.id));
    assert.ok(notifications.length > 0);
    assert.ok(notifications.every((row) => row.entityType === 'object' && row.entityId === result.id && row.type === 'object.created'));
    assert.equal(notifications.filter((row) => row.recipientUserId === colleague.id).length, 1);
    assert.equal(new Set(notifications.map((row) => row.recipientUserId)).size, notifications.length);
    const queued = after.outbox.filter((row) => !before.outbox.some((old) => old.id === row.id));
    assert.deepEqual(queued.map((row) => row.notificationId).sort(), notifications.map((row) => row.id).sort());
    assert.deepEqual(chatCalls.slice(beforeChatCalls), [
      { room: 'objects', objectId: result.id }, { room: 'leadership', objectId: result.id },
    ]);
    const messages = after.messages.filter((row) => !before.messages.some((old) => old.id === row.id));
    assert.equal(messages.length, 2);
    assert.ok(messages.every((row) => row.messageType === 'system' && (row.metadata as { objectId: string }).objectId === result.id));
    assert.deepEqual(messages.map((row) => row.chatRoomId).sort(), chatEvents.map((row) => row.entityId).sort());
    assert.deepEqual(after.messages.filter((row) => !messages.some((added) => added.id === row.id)), before.messages);
    for (const key of ['approvals', 'files', 'setup', 'planning', 'positions', 'contours', 'staffing', 'attendance', 'inventory', 'equipment'] as const) {
      assert.deepEqual(after[key], before[key], key);
    }
    const card = await fetch(`${baseUrl}/api/v1/objects/${result.id}`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(15_000) });
    assert.equal(card.status, 200, await card.clone().text());
    assert.equal((await card.json() as ObjectResponseDto).id, result.id);
    return result;
  };

  for (const boundary of ['generic-event', 'object-log'] as const) {
    await t.test(`failure after real ${boundary} INSERT rolls back; one valid retry persists once`, async () => {
      const payload = input();
      const before = await snapshot();
      const beforeChatCalls = chatCalls.length;
      let injected = false;
      let generatedId: string | undefined;
      audit.writeAuditEvent = async (...args: Parameters<AuditService['writeAuditEvent']>) => {
        await originalEvent.apply(audit, args);
        const [params, database] = args;
        if (boundary !== 'generic-event' || params.actorUserId !== actor.id || params.entityType !== 'object' || params.action !== 'object.created') return;
        assert.ok(database && 'object' in database, 'Creation audit must receive the real business transaction');
        const tx = database as Prisma.TransactionClient;
        await verifyInTransaction(tx, params.entityId, payload);
        assert.equal(await tx.auditEvent.count({ where: { entityType: 'object', entityId: params.entityId, action: 'object.created' } }), 1);
        assert.equal(await tx.objectAuditLog.count({ where: { objectId: params.entityId, actionCode: 'object.created' } }), 0);
        generatedId = params.entityId;
        injected = true;
        throw new Error('Controlled object creation failure after generic audit INSERT');
      };
      audit.writeObjectAuditLog = async (...args: Parameters<AuditService['writeObjectAuditLog']>) => {
        await originalLog.apply(audit, args);
        const [params, database] = args;
        if (boundary !== 'object-log' || params.actorUserId !== actor.id || params.actionCode !== 'object.created') return;
        assert.ok(database && 'object' in database, 'Both audit stores must share the business transaction');
        const tx = database as Prisma.TransactionClient;
        await verifyInTransaction(tx, params.objectId, payload);
        assert.equal(await tx.auditEvent.count({ where: { entityType: 'object', entityId: params.objectId, action: 'object.created' } }), 1);
        assert.equal(await tx.objectAuditLog.count({ where: { objectId: params.objectId, actionCode: 'object.created' } }), 1);
        generatedId = params.objectId;
        injected = true;
        throw new Error('Controlled object creation failure after both real audit INSERTs');
      };
      let response: Response;
      try { response = await send(payload); } finally {
        audit.writeAuditEvent = originalEvent;
        audit.writeObjectAuditLog = originalLog;
      }
      assert.equal(response.status, 500, await response.text());
      assert.equal(injected, true, 'An unrelated 500, validation error or timeout cannot pass this test');
      assert.ok(generatedId);
      assert.equal(await prisma.object.count({ where: { id: generatedId } }), 0);
      assert.equal(chatCalls.length, beforeChatCalls, 'Failed business transaction must never reach post-commit chat calls');
      assert.deepEqual(await snapshot(), before, 'Object, assignments, contacts, both audits, notifications/outbox and chat must all roll back');
      const result = await retryOnce(payload, before);
      assert.notEqual(result.id, generatedId);
    });
  }

  await t.test('create allow plus read deny all cannot leak/persist a generated card; revoke enables one valid retry', async () => {
    const payload = input();
    const deny = await prisma.userAccessRule.create({ data: {
      userId: actor.id, actionCode: 'objects.read', effect: 'deny', scope: 'all', selectedIds: [],
    } });
    const before = await snapshot();
    const beforeChatCalls = chatCalls.length;
    let auditCalls = 0;
    audit.writeObjectAuditLog = async (...args: Parameters<AuditService['writeObjectAuditLog']>) => {
      if (args[0].actorUserId === actor.id && args[0].actionCode === 'object.created') auditCalls++;
      return originalLog.apply(audit, args);
    };
    try {
      const response = await send(payload);
      const text = await response.text();
      assert.deepEqual(await snapshot(), before, 'Unreadable generated resource must not survive a forbidden response');
      assert.equal(response.status, 403, text);
      assert.equal(text.includes(payload.name), false, 'Denied response must not disclose a created object card');
      assert.equal(await prisma.object.count({ where: { name: payload.name } }), 0);
      assert.equal(auditCalls, 0, 'Generated-card authorization must precede the creation audit');
      assert.equal(chatCalls.length, beforeChatCalls);
    } finally {
      audit.writeObjectAuditLog = originalLog;
      await prisma.userAccessRule.delete({ where: { id: deny.id } });
    }
    await retryOnce(payload, before);
  });
  // Explicit remaining risk: createSystemMessage('objects') and then
  // createSystemMessage('leadership') run AFTER the business commit. A failure
  // there may return 500 with an already-created object or partial chat delivery;
  // another POST may duplicate the object. No chat-failure injection, durable
  // chat outbox, successful-POST idempotency or fix for that risk is claimed.
  // No acceptance of the separate independent create-approval contract is made.
  // Runner owns disposal of the isolated schema; no shared-data cleanup occurs.
});
