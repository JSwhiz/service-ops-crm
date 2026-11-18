import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { ObjectDailyReportResponseDto } from '../src/modules/object-operations/dto/object-daily-report-response.dto';
import type { ObjectResponseDto } from '../src/modules/objects/dto/object-response.dto';
import type { ObjectInventoryResponseDto } from '../src/modules/inventory/dto/object-inventory-response.dto';
import type { InventoryMovementResponseDto } from '../src/modules/inventory/dto/inventory-movement-response.dto';
import { moscowDayWindow } from '../src/modules/objects/utils/object-season.util';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

// JSON snapshot: history, reports.update/submit/attachments.correct,
// inventory.read/issue and equipment.read were unverified; contacts/materials
// were partial. These 12 leaves are a bounded addition, not all 47 objects codes.
const covered = [
  'history', 'contacts.read', 'contacts.manage', 'materials.read', 'materials.manage',
  'reports.read', 'reports.update', 'reports.submit', 'reports.attachments.correct',
  'inventory.read', 'inventory.issue', 'equipment.read',
] as const;
type Scope = 'selected' | 'all' | 'own' | 'assigned';
type Contact = { id: string; objectId: string; name: string; phones: string[]; version: number };

test('bounded object operation leaves enforce real HTTP action/parent rules and persistence', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(databaseUrl.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname));
  assert.equal(databaseUrl.port, '55432');
  assert.match(databaseUrl.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  for (const leaf of covered) assert.ok(ACCESS_ACTION_CATALOG.some((entry) => entry.code === `objects.${leaf}`));

  const prisma = new PrismaClient();
  const lifecycle: { close?: () => Promise<void> } = {};
  t.after(async () => {
    try { await lifecycle.close?.(); } finally { await prisma.$disconnect(); }
  });
  const { app, baseUrl } = await createTestApp();
  lifecycle.close = () => app.close();
  const marker = `acl-object-ops-${randomUUID()}`;
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'manager' } });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const actor = await prisma.user.create({ data: {
    login: marker, fullName: marker, passwordHash: template.passwordHash, isActive: true,
    roles: { create: { roleId: role.id } },
  } });
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const request = (path: string, method = 'GET', body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, expected: number): Promise<T> => {
    const text = await response.text();
    assert.equal(response.status, expected, text);
    return JSON.parse(text) as T;
  };
  const rule = (leaf: string, effect: 'allow' | 'deny', scope: Scope, selectedIds: string[] = [], module = 'objects') => {
    const actionCode = `${module}.${leaf}`;
    assert.ok(ACCESS_ACTION_CATALOG.find((entry) => entry.code === actionCode)?.allowedScopes.includes(scope));
    return prisma.userAccessRule.upsert({
      where: { userId_actionCode: { userId: actor.id, actionCode } },
      create: { userId: actor.id, actionCode, effect, scope, selectedIds }, update: { effect, scope, selectedIds },
    });
  };
  const revoke = (leaf: string, module = 'objects') => prisma.userAccessRule.delete({
    where: { userId_actionCode: { userId: actor.id, actionCode: `${module}.${leaf}` } },
  });
  const reset = () => prisma.userAccessRule.deleteMany({ where: { userId: actor.id } });
  let sequence = 0;
  const objectFixture = (label: string, assigned = true, status = 'active') => prisma.object.create({ data: {
    name: `${marker}-${label}-${++sequence}`, address: 'Isolated object operations fixture', status,
    createdByUserId: founder.id, instructionSteps: [`Instruction ${label}`],
    assignments: { create: [
      { userId: founder.id, assignmentRoleCode: 'responsible', isActive: true },
      ...(assigned ? [{ userId: actor.id, assignmentRoleCode: 'manager', isActive: true }] : []),
    ] },
  } });
  const fileFixture = async (entityType: 'object' | 'object_daily_report', entityId: string) => {
    const file = await prisma.file.create({ data: {
      bucket: 'integration-metadata-only', objectKey: `${marker}/${randomUUID()}.txt`,
      originalName: `${entityType}-${++sequence}.txt`, mimeType: 'text/plain', sizeBytes: 8, uploadedByUserId: actor.id,
    } });
    const attachment = await prisma.fileAttachment.create({ data: { entityType, entityId, fileId: file.id, uploadedByUserId: actor.id } });
    return { file, attachment };
  };
  const item = await prisma.inventoryItem.create({ data: {
    name: marker, category: 'Isolated fixture', unit: 'шт.', currentUnitPrice: 10, createdByUserId: founder.id,
  } });
  await prisma.inventoryMovement.create({ data: {
    inventoryItemId: item.id, movementType: 'receipt', status: 'applied', quantity: 100,
    unitPriceSnapshot: 10, totalAmountSnapshot: 1000, createdByUserId: founder.id,
  } });
  const catalog = await prisma.equipmentCatalogItem.create({ data: {
    category: 'Isolated fixture', name: marker, createdByUserId: founder.id,
  } });
  const sectionFixture = async (label: string) => {
    const object = await objectFixture(label);
    const contact = await prisma.objectContact.create({ data: { objectId: object.id, name: `Contact ${label}`, phones: ['+79990000001'] } });
    const report = await prisma.objectDailyReport.create({ data: {
      objectId: object.id, reportDate: moscowDayWindow().gte, content: `Report ${label}`, updatedByUserId: actor.id,
    } });
    const material = await fileFixture('object', object.id);
    const reportFile = await fileFixture('object_daily_report', report.id);
    const history = await prisma.objectAuditLog.create({ data: {
      objectId: object.id, actorUserId: founder.id, actionCode: 'object.fixture', payload: { label },
    } });
    const movement = await prisma.inventoryMovement.create({ data: {
      inventoryItemId: item.id, movementType: 'issue_to_object', status: 'applied', quantity: 1,
      unitPriceSnapshot: 10, totalAmountSnapshot: 10, relatedObjectId: object.id, createdByUserId: founder.id,
    } });
    const unit = await prisma.equipmentUnit.create({ data: {
      catalogItemId: catalog.id, inventoryNumber: `${marker}-${label}-${++sequence}`, status: 'assigned_to_object',
      currentObjectId: object.id, createdByUserId: founder.id,
    } });
    return { ...object, contact, report, material, reportFile, history, movement, unit };
  };
  const a = await sectionFixture('A');
  const b = await sectionFixture('B');

  // Isolated schema only. No binary is uploaded, downloaded or deleted. Immutable
  // queue content is captured; delivery bookkeeping can advance independently.
  const snapshot = async () => ({
    objects: await prisma.object.findMany({ orderBy: { id: 'asc' } }),
    assignments: await prisma.objectAssignment.findMany({ orderBy: { id: 'asc' } }),
    contacts: await prisma.objectContact.findMany({ orderBy: { id: 'asc' } }),
    reports: await prisma.objectDailyReport.findMany({ orderBy: { id: 'asc' } }),
    publications: await prisma.objectDailyReportPublication.findMany({ orderBy: { id: 'asc' }, select: {
      id: true, reportId: true, revision: true, actorUserId: true, content: true,
      attachmentSnapshot: true, attachmentDiff: true, correctionReason: true, createdAt: true,
    } }),
    attachmentRequests: await prisma.objectDailyReportAttachmentRequest.findMany({ orderBy: { id: 'asc' } }),
    attachmentStages: await prisma.objectDailyReportAttachmentStage.findMany({ orderBy: { id: 'asc' } }),
    files: await prisma.file.findMany({ orderBy: { id: 'asc' } }),
    attachments: await prisma.fileAttachment.findMany({ orderBy: { id: 'asc' } }),
    audits: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    objectAudits: await prisma.objectAuditLog.findMany({ orderBy: { id: 'asc' } }),
    approvals: await prisma.approvalRequest.findMany({ orderBy: { id: 'asc' } }),
    items: await prisma.inventoryItem.findMany({ orderBy: { id: 'asc' } }),
    movements: await prisma.inventoryMovement.findMany({ orderBy: { id: 'asc' } }),
    units: await prisma.equipmentUnit.findMany({ orderBy: { id: 'asc' } }),
    equipmentMovements: await prisma.equipmentMovement.findMany({ orderBy: { id: 'asc' } }),
    budgetPeriods: await prisma.objectBudgetPeriod.findMany({ where: { object: { name: { startsWith: marker } } }, orderBy: [{ objectId: 'asc' }, { month: 'asc' }] }),
    budgetAlerts: await prisma.objectBudgetAlert.findMany({ where: { object: { name: { startsWith: marker } } }, orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    outbox: await prisma.notificationOutbox.findMany({ orderBy: { id: 'asc' }, select: {
      id: true, notificationId: true, recipientUserId: true, createdAt: true,
    } }),
    messages: await prisma.chatMessage.findMany({ orderBy: { id: 'asc' } }),
    staffing: await prisma.objectEmployeeAssignment.findMany({ orderBy: { id: 'asc' } }),
    attendance: await prisma.objectAttendanceFact.findMany({ orderBy: { id: 'asc' } }),
    timesheet: await prisma.timesheetDayEntry.findMany({ orderBy: { id: 'asc' } }),
  });
  type Snapshot = Awaited<ReturnType<typeof snapshot>>;
  const onlyChanges = (before: Snapshot, after: Snapshot, keys: Array<keyof Snapshot>) => {
    for (const key of Object.keys(before) as Array<keyof Snapshot>) {
      if (!keys.includes(key)) assert.deepEqual(after[key], before[key], key);
    }
  };
  const denied = async (path: string, method = 'GET', body?: unknown, expected = 403) => {
    const before = await snapshot();
    const response = await request(path, method, body);
    const text = await response.text();
    assert.deepEqual(await snapshot(), before, `${method} ${path}: failure must preserve business, audit, queue and stock data`);
    assert.equal(response.status, expected, text);
  };
  const reportChatDelta = (before: Snapshot, after: Snapshot, objectId: string, reportId: string, revision: number) => {
    const systemEventKey = `object-daily-report:${reportId}:${revision}`;
    const messages = after.messages.filter((row) => !before.messages.some((old) => old.id === row.id));
    assert.equal(messages.length, 1, 'Exactly one system message belongs to this submitted revision');
    const message = messages[0];
    assert.equal(message.systemEventKey, systemEventKey);
    assert.equal(message.messageType, 'system');
    const metadata = message.metadata as { objectId: string; reportId: string; revision: number };
    assert.equal(metadata.objectId, objectId);
    assert.equal(metadata.reportId, reportId);
    assert.equal(metadata.revision, revision);
    assert.deepEqual(after.messages.filter((row) => row.id !== message.id), before.messages);
    const events = after.audits.filter((row) => !before.audits.some((old) => old.id === row.id));
    assert.equal(events.length, 1, 'No unrelated generic audit may accompany report publication');
    const event = events[0];
    assert.equal(event.entityType, 'chat_room');
    assert.equal(event.entityId, message.chatRoomId);
    assert.equal(event.action, 'chat.system_message.created');
    assert.equal(event.actorUserId, actor.id);
    assert.deepEqual(event.metadata, { systemEventKey });
    assert.deepEqual(event.newValues, { code: 'objects', text: message.text, metadata: message.metadata });
    assert.equal(event.oldValues, null);
    assert.deepEqual(after.audits.filter((row) => row.id !== event.id), before.audits);
    return event.id;
  };
  const objectAudit = (before: Snapshot, after: Snapshot, objectId: string, actionCode: string, generic: boolean, publicationAuditId?: string) => {
    const added = after.objectAudits.filter((row) => !before.objectAudits.some((old) => old.id === row.id));
    assert.equal(added.length, 1);
    assert.equal(added[0].objectId, objectId);
    assert.equal(added[0].actionCode, actionCode);
    assert.equal(added[0].actorUserId, actor.id);
    assert.deepEqual(after.objectAudits.filter((row) => row.id !== added[0].id), before.objectAudits);
    const events = after.audits.filter((row) => row.id !== publicationAuditId && !before.audits.some((old) => old.id === row.id));
    assert.equal(events.length, generic ? 1 : 0);
    if (generic) {
      assert.equal(events[0].entityId, objectId);
      assert.equal(events[0].action, actionCode);
      assert.equal(events[0].actorUserId, actor.id);
    }
    return added[0];
  };

  for (const leaf of ['history', 'contacts.read', 'materials.read', 'reports.read', 'inventory.read', 'equipment.read'] as const) {
    await t.test(`${leaf}: actual A/B data, selected/all deny, additive allow, revoke and parent denial`, async () => {
      await reset();
      const path = (id: string) => leaf === 'history' ? `/objects/${id}/audit`
        : leaf === 'contacts.read' ? `/objects/${id}/contacts`
          : leaf === 'materials.read' ? `/files/entity/object/${id}`
            : leaf === 'reports.read' ? `/objects/${id}/daily-reports`
              : `/objects/${id}/${leaf === 'inventory.read' ? 'inventory' : 'equipment'}`;
      const read = async (target: typeof a) => {
        const before = await snapshot();
        const response = await request(path(target.id));
        if (leaf === 'inventory.read') {
          const result = await json<ObjectInventoryResponseDto>(response, 200);
          assert.ok(result.movements.some((entry) => entry.id === target.movement.id));
          assert.ok(result.movements.every((entry) => entry.relatedObject?.id === target.id));
        } else if (leaf === 'equipment.read') {
          const result = await json<{ units: Array<{ id: string }> }>(response, 200);
          assert.deepEqual(result.units.map((unit) => unit.id), [target.unit.id]);
        } else {
          const result = await json<Array<{ id: string; content?: string }>>(response, 200);
          const expectedId = leaf === 'history' ? target.history.id : leaf === 'contacts.read' ? target.contact.id
            : leaf === 'materials.read' ? target.material.file.id : target.report.id;
          assert.ok(result.some((row) => row.id === expectedId));
          if (leaf === 'reports.read') {
            assert.equal(result.find((row) => row.id === target.report.id)?.content, target.report.content);
            const today = await json<ObjectDailyReportResponseDto>(await request(`/objects/${target.id}/daily-report/today`), 200);
            assert.equal(today.id, target.report.id);
            assert.deepEqual(today.attachments.map((file) => file.id), [target.reportFile.file.id]);
          }
          if (leaf === 'materials.read') {
            const card = await json<ObjectResponseDto>(await request(`/objects/${target.id}`), 200);
            assert.deepEqual(card.instructionSteps, target.instructionSteps);
          }
        }
        assert.deepEqual(await snapshot(), before, 'Reads add no events or business records');
      };
      const blocked = async (target: typeof a) => {
        await denied(path(target.id), 'GET', undefined, leaf === 'history' ? 404 : 403);
        if (leaf === 'reports.read') await denied(`/objects/${target.id}/daily-report/today`);
        if (leaf === 'materials.read') {
          const before = await snapshot();
          const card = await json<ObjectResponseDto>(await request(`/objects/${target.id}`), 200);
          assert.deepEqual(card.instructionSteps, []);
          assert.equal(card.capabilities.canReadMaterials, false);
          assert.deepEqual(await snapshot(), before);
        }
      };
      await read(a);
      await read(b);
      await rule(leaf, 'allow', 'selected', [a.id]);
      await read(a);
      await read(b);
      await rule(leaf, 'deny', 'selected', [a.id]);
      await blocked(a);
      await read(b);
      await revoke(leaf);
      await read(a);
      await rule(leaf, 'deny', 'all');
      await blocked(a);
      await blocked(b);
      await rule(leaf, 'allow', 'all');
      await read(a);
      for (const parent of ['read', 'access'] as const) {
        await rule(parent, 'deny', 'selected', [a.id]);
        await denied(path(a.id), 'GET', undefined, leaf === 'history' || leaf === 'contacts.read' ? 404 : 403);
        await read(b);
        await revoke(parent);
      }
      await reset();
    });
  }

  await t.test('materials.manage writes instructions only, preserves core and cannot grant contacts/report actions', async () => {
    await reset();
    const set = async (id: string) => {
      const before = await snapshot();
      const instructionSteps = [`Scoped instructions ${++sequence}`];
      const result = await json<ObjectResponseDto>(await request(`/objects/${id}`, 'PATCH', { instructionSteps }), 200);
      const after = await snapshot();
      onlyChanges(before, after, ['objects', 'objectAudits', 'audits', 'notifications', 'outbox']);
      assert.deepEqual(result.instructionSteps, instructionSteps);
      const old = before.objects.find((row) => row.id === id)!;
      const stored = after.objects.find((row) => row.id === id)!;
      assert.deepEqual(stored, { ...old, instructionSteps, updatedAt: stored.updatedAt });
      assert.deepEqual(after.objects.filter((row) => row.id !== id), before.objects.filter((row) => row.id !== id));
      objectAudit(before, after, id, 'object.updated', true);
    };
    const blocked = (id: string, status = 403) => denied(`/objects/${id}`, 'PATCH', { instructionSteps: ['Denied instruction'] }, status);
    await blocked(a.id);
    await rule('materials.manage', 'allow', 'selected', [a.id]);
    await set(a.id);
    await blocked(b.id);
    await denied(`/objects/${a.id}`, 'PATCH', { notes: 'Instruction grant is not core edit' });
    await denied(`/objects/${a.id}/contacts`, 'POST', { name: 'No contact grant' });
    await rule('materials.manage', 'deny', 'selected', [a.id]);
    await blocked(a.id);
    await revoke('materials.manage');
    await blocked(a.id);
    await rule('materials.manage', 'allow', 'all');
    await set(b.id);
    for (const parent of ['read', 'access'] as const) {
      await rule(parent, 'deny', 'selected', [a.id]);
      await blocked(a.id, 404);
      await set(b.id);
      await revoke(parent);
    }
    await reset();
  });

  await t.test('contacts.manage creates/updates/deletes real versioned contacts and cannot grant core edit', async () => {
    await reset();
    const create = async (id: string) => {
      const input = { name: `Scoped contact ${++sequence}`, phones: ['+79990000002'] };
      const before = await snapshot();
      const result = await json<Contact>(await request(`/objects/${id}/contacts`, 'POST', input), 201);
      const after = await snapshot();
      onlyChanges(before, after, ['contacts', 'objectAudits', 'audits']);
      assert.equal(result.objectId, id);
      assert.equal(result.version, 1);
      assert.equal(result.name, input.name);
      assert.deepEqual(result.phones, input.phones);
      assert.equal(after.contacts.length, before.contacts.length + 1);
      assert.deepEqual(after.contacts.filter((row) => row.id !== result.id), before.contacts);
      objectAudit(before, after, id, 'object.contact.created', true);
      return result;
    };
    await denied(`/objects/${a.id}/contacts`, 'POST', { name: 'No grant' });
    await rule('contacts.manage', 'allow', 'selected', [a.id]);
    const contact = await create(a.id);
    await denied(`/objects/${b.id}/contacts`, 'POST', { name: 'Control B' });
    await denied(`/objects/${a.id}`, 'PATCH', { notes: 'Contact grant is not core edit' });
    await rule('contacts.manage', 'deny', 'selected', [a.id]);
    await denied(`/objects/${a.id}/contacts/${contact.id}`, 'PATCH', { name: 'Denied', expectedVersion: 1 });
    await denied(`/objects/${a.id}/contacts/${contact.id}`, 'DELETE', { expectedVersion: 1 });
    await revoke('contacts.manage');
    await denied(`/objects/${a.id}/contacts`, 'POST', { name: 'Reverted default' });
    await rule('contacts.manage', 'allow', 'all');
    await create(b.id);
    for (const parent of ['read', 'access'] as const) {
      await rule(parent, 'deny', 'selected', [a.id]);
      await denied(`/objects/${a.id}/contacts/${contact.id}`, 'PATCH', { name: 'Parent denied', expectedVersion: 1 }, 404);
      await revoke(parent);
    }
    const before = await snapshot();
    const updated = await json<Contact>(await request(`/objects/${a.id}/contacts/${contact.id}`, 'PATCH', { name: 'Version two', expectedVersion: 1 }), 200);
    const after = await snapshot();
    onlyChanges(before, after, ['contacts', 'objectAudits', 'audits']);
    assert.equal(updated.version, 2);
    const stored = after.contacts.find((row) => row.id === contact.id)!;
    assert.deepEqual(stored, { ...before.contacts.find((row) => row.id === contact.id)!, name: 'Version two', version: 2, updatedAt: stored.updatedAt });
    objectAudit(before, after, a.id, 'object.contact.updated', true);
    await denied(`/objects/${a.id}/contacts/${contact.id}`, 'PATCH', { name: 'Stale', expectedVersion: 1 }, 409);
    await denied(`/objects/${a.id}/contacts/${contact.id}`, 'DELETE', { expectedVersion: 1 }, 409);
    const beforeDelete = await snapshot();
    await json(await request(`/objects/${a.id}/contacts/${contact.id}`, 'DELETE', { expectedVersion: 2 }), 200);
    const afterDelete = await snapshot();
    onlyChanges(beforeDelete, afterDelete, ['contacts', 'objectAudits', 'audits']);
    assert.deepEqual(afterDelete.contacts, beforeDelete.contacts.filter((row) => row.id !== contact.id));
    objectAudit(beforeDelete, afterDelete, a.id, 'object.contact.deleted', true);
    await reset();
  });

  const reportView = (id: string) => request(`/objects/${id}/daily-report/today`).then((response) => json<ObjectDailyReportResponseDto>(response, 200));
  const saveDraft = async (id: string) => {
    const current = await reportView(id);
    const before = await snapshot();
    const content = `Draft ${++sequence}`;
    const result = await json<ObjectDailyReportResponseDto>(await request(`/objects/${id}/daily-report/today`, 'PUT', { content, expectedRevision: current.revision }), 200);
    const after = await snapshot();
    onlyChanges(before, after, ['reports', 'objectAudits']);
    assert.equal(result.content, content);
    assert.equal(result.revision, current.revision + 1);
    assert.equal(result.submittedRevision, current.submittedRevision);
    const old = before.reports.find((row) => row.id === result.id)!;
    const stored = after.reports.find((row) => row.id === result.id)!;
    assert.deepEqual(stored, { ...old, content, revision: old.revision + 1, updatedByUserId: actor.id, updatedAt: stored.updatedAt });
    assert.deepEqual(after.reports.filter((row) => row.id !== result.id), before.reports.filter((row) => row.id !== result.id));
    objectAudit(before, after, id, 'daily_report.draft_saved', false);
    return result;
  };
  const submit = async (id: string) => {
    const current = await reportView(id);
    const before = await snapshot();
    const result = await json<ObjectDailyReportResponseDto>(await request(`/objects/${id}/daily-report/today/submit`, 'POST', { expectedRevision: current.revision }), 201);
    const after = await snapshot();
    const publicationAuditId = reportChatDelta(before, after, id, result.id, result.revision);
    onlyChanges(before, after, ['reports', 'publications', 'objectAudits', 'audits', 'messages', 'notifications', 'outbox']);
    assert.equal(result.revision, current.revision);
    assert.equal(result.submittedRevision, current.revision);
    assert.equal(result.publicationState, 'submitted');
    const added = after.publications.filter((row) => !before.publications.some((old) => old.id === row.id));
    assert.equal(added.length, 1);
    assert.equal(added[0].reportId, result.id);
    assert.equal(added[0].revision, result.revision);
    assert.equal(added[0].content, current.content);
    assert.equal(added[0].actorUserId, actor.id);
    objectAudit(before, after, id, 'daily_report.submitted', false, publicationAuditId);
    return result;
  };

  await t.test('reports.update/submit separate draft from immutable publication and enforce action/parent denies', async () => {
    await reset();
    for (const leaf of ['reports.update', 'reports.submit'] as const) {
      const method = leaf === 'reports.update' ? 'PUT' : 'POST';
      const path = (id: string) => `/objects/${id}/daily-report/today${leaf === 'reports.submit' ? '/submit' : ''}`;
      const body = async (id: string) => ({ content: 'Denied draft', expectedRevision: (await reportView(id)).revision });
      const blocked = async (id: string) => denied(path(id), method, leaf === 'reports.update' ? await body(id) : { expectedRevision: (await reportView(id)).revision });
      const act = leaf === 'reports.update' ? saveDraft : submit;
      await rule(leaf, 'deny', 'selected', [a.id]);
      await blocked(a.id);
      await act(b.id);
      await revoke(leaf);
      await act(a.id);
      if (leaf === 'reports.submit') {
        const beforeRetry = await snapshot();
        const current = await reportView(a.id);
        await json(await request(path(a.id), method, { expectedRevision: current.revision }), 201);
        assert.deepEqual(await snapshot(), beforeRetry, 'Retry cannot duplicate immutable publication or audit');
        await saveDraft(a.id);
        await saveDraft(b.id);
      }
      await rule(leaf, 'allow', 'selected', [a.id]);
      await act(a.id);
      await rule(leaf, 'deny', 'all');
      await blocked(a.id);
      await blocked(b.id);
      await rule(leaf, 'allow', 'all');
      await act(b.id);
      for (const parent of ['read', 'access'] as const) {
        await rule(parent, 'deny', 'selected', [a.id]);
        // No preflight read of denied A: payload revision comes from Prisma.
        const current = await prisma.objectDailyReport.findUniqueOrThrow({ where: { id: a.report.id } });
        await denied(path(a.id), method, leaf === 'reports.update' ? { content: 'Parent denied', expectedRevision: current.revision } : { expectedRevision: current.revision });
        await revoke(parent);
      }
      await reset();
    }
  });

  await t.test('reports.attachments.correct removes only the link, keeps submitted history and requires reason/version', async () => {
    await reset();
    // Fresh revisions make this independent of prior submission/retry state.
    await saveDraft(a.id);
    await saveDraft(b.id);
    await submit(a.id);
    await submit(b.id);
    const path = (id: string, reportId: string) => `/objects/${id}/daily-reports/${reportId}/attachments`;
    const input = async (target: typeof a, reason = 'Correct submitted evidence') => ({
      expectedRevision: (await reportView(target.id)).revision, requestId: randomUUID(),
      removeAttachmentIds: [target.reportFile.attachment.id], addFileIds: [], reason,
    });
    const payloadA = await input(a);
    await rule('reports.attachments.correct', 'deny', 'selected', [a.id]);
    await denied(path(a.id, a.report.id), 'PATCH', payloadA);
    await revoke('reports.attachments.correct');
    await rule('reports.attachments.correct', 'allow', 'all');
    for (const parent of ['read', 'access'] as const) {
      await rule(parent, 'deny', 'selected', [a.id]);
      await denied(path(a.id, a.report.id), 'PATCH', payloadA);
      await revoke(parent);
    }
    await rule('reports.update', 'deny', 'selected', [a.id]);
    await denied(path(a.id, a.report.id), 'PATCH', payloadA);
    await revoke('reports.update');
    await denied(path(a.id, a.report.id), 'PATCH', { ...payloadA, reason: ' ' }, 409);
    await denied(path(a.id, b.report.id), 'PATCH', payloadA, 404);
    for (const target of [b, a]) {
      const payload = await input(target);
      const before = await snapshot();
      const result = await json<{ reportId: string; revision: number; submittedRevision: number; attachments: unknown[] }>(await request(path(target.id, target.report.id), 'PATCH', payload), 200);
      const after = await snapshot();
      const publicationAuditId = reportChatDelta(before, after, target.id, target.report.id, result.revision);
      onlyChanges(before, after, ['reports', 'attachments', 'attachmentRequests', 'publications', 'objectAudits', 'audits', 'messages', 'notifications', 'outbox']);
      assert.equal(result.reportId, target.report.id);
      assert.equal(result.revision, payload.expectedRevision + 1);
      assert.equal(result.submittedRevision, result.revision);
      assert.deepEqual(result.attachments, []);
      assert.deepEqual(after.attachments, before.attachments.filter((row) => row.id !== target.reportFile.attachment.id));
      assert.deepEqual(after.files, before.files, 'Unlinking cannot delete a file record or binary');
      const oldPublications = after.publications.filter((row) => before.publications.some((old) => old.id === row.id));
      assert.deepEqual(oldPublications, before.publications, 'Earlier submitted attachment snapshots are immutable');
      const added = after.publications.filter((row) => !before.publications.some((old) => old.id === row.id));
      assert.equal(added.length, 1);
      assert.equal(added[0].correctionReason, payload.reason);
      assert.deepEqual(added[0].attachmentSnapshot, []);
      objectAudit(before, after, target.id, 'daily_report.attachments_corrected', false, publicationAuditId);
      const beforeRetry = await snapshot();
      const retry = await json(await request(path(target.id, target.report.id), 'PATCH', payload), 200);
      assert.deepEqual(retry, result);
      assert.deepEqual(await snapshot(), beforeRetry, 'Idempotent correction creates no duplicate queue/audit/request');
      await denied(path(target.id, target.report.id), 'PATCH', { ...payload, requestId: randomUUID() }, 409);
    }
    await reset();
  });

  await t.test('inventory.issue creates the actual object movement plus pending director-only bridge, never resolves it', async () => {
    await reset();
    const body = { inventoryItemId: item.id, quantity: 1, comment: 'Scoped issue without photo' };
    const path = (id: string) => `/objects/${id}/inventory/issue`;
    const issue = async (id: string) => {
      const before = await snapshot();
      const result = await json<InventoryMovementResponseDto>(await request(path(id), 'POST', body), 201);
      const after = await snapshot();
      onlyChanges(before, after, ['movements', 'approvals', 'audits', 'budgetPeriods', 'budgetAlerts', 'notifications', 'outbox', 'messages']);
      assert.equal(after.movements.length, before.movements.length + 1);
      const stored = after.movements.find((row) => row.id === result.id)!;
      assert.equal(stored.relatedObjectId, id);
      assert.equal(stored.inventoryItemId, item.id);
      assert.equal(stored.createdByUserId, actor.id);
      assert.equal(stored.movementType, 'issue_to_object');
      assert.equal(Number(stored.quantity), 1);
      assert.equal(Number(stored.unitPriceSnapshot), 10);
      assert.equal(Number(stored.totalAmountSnapshot), 10);
      assert.equal(stored.requiresApprovalBridge, true);
      assert.equal(stored.approvalBridgeType, 'inventory_without_photo_confirmation');
      assert.equal(stored.approvalBridgeResolvedAt, null);
      assert.deepEqual(after.movements.filter((row) => row.id !== result.id), before.movements);
      const added = after.approvals.filter((row) => !before.approvals.some((old) => old.id === row.id));
      assert.equal(added.length, 1);
      assert.equal(added[0].sourceEntityId, result.id);
      assert.equal(added[0].approvalType, 'inventory_exception_confirmation');
      assert.equal(added[0].status, 'pending');
      assert.equal(added[0].createdByUserId, actor.id);
      assert.equal(added[0].resolvedByUserId, null);
      assert.equal(result.approvalRequest?.id, added[0].id);
      assert.equal(after.audits.filter((row) => !before.audits.some((old) => old.id === row.id) && row.entityId === result.id && row.action === 'inventory.movement.created' && row.actorUserId === actor.id).length, 1);
      await denied(`/inventory/movements/${result.id}/resolve-missing-photo-approval`, 'POST');
    };
    await rule('inventory.issue', 'deny', 'selected', [a.id]);
    await denied(path(a.id), 'POST', body);
    await issue(b.id);
    await revoke('inventory.issue');
    await issue(a.id);
    await rule('inventory.issue', 'allow', 'selected', [a.id]);
    for (const parent of ['read', 'access'] as const) {
      await rule(parent, 'deny', 'selected', [a.id]);
      await denied(path(a.id), 'POST', body);
      await issue(b.id);
      await revoke(parent);
    }
    await rule('issue_to_object', 'deny', 'all', [], 'inventory');
    await denied(path(a.id), 'POST', body);
    await revoke('issue_to_object', 'inventory');
    await rule('inventory.issue', 'deny', 'all');
    await denied(path(a.id), 'POST', body);
    await denied(path(b.id), 'POST', body);
    await rule('inventory.issue', 'allow', 'all');
    await issue(b.id);
    await reset();
  });
  // No binary/storage, browser, production, delivery retry or audit-failure
  // injection is verified here. Source lifecycle invariants are not bypassed.
});
