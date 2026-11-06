import assert from 'node:assert/strict';
import test from 'node:test';

import { ForbiddenException } from '@nestjs/common';

import { FilesService } from '../src/modules/files/files.service';
import type { AccessRule } from '../src/modules/users-access/types/access-policy.type';

type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
// Evaluate the actual order policy emitted by the service, not a boolean flag
// preselected from the current grant. Actual SQL truth has its own DB suite.
function matches(where: unknown, row: RecordValue): boolean {
  assert.ok(record(where));
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return (Array.isArray(value) ? value : [value]).every((part) => matches(part, row));
    if (key === 'OR') { assert.ok(Array.isArray(value)); return value.some((part) => matches(part, row)); }
    if (key === 'NOT') return !(Array.isArray(value) ? value : [value]).some((part) => matches(part, row));
    const actual = row[key];
    if (!record(value)) return actual === value;
    if ('in' in value) { assert.ok(Array.isArray(value.in)); return value.in.includes(actual); }
    if ('not' in value) return actual !== value.not;
    if ('some' in value) { assert.ok(Array.isArray(actual)); return actual.some((item) => matches(value.some, item)); }
    return record(actual) && matches(value, actual);
  });
}

test('completion upload requires current parent-order visibility in addition to draft/assignee/cycle invariants', async () => {
  const order = { id: 'order-a', createdByUserId: 'other', assignments: [] as Array<RecordValue> };
  const task = { id: 'task-a', createdByUserId: 'other', objectId: null, oneTimeOrderId: order.id,
    oneTimeOrder: order, status: 'in_progress', workCycle: 1, visibilityType: 'target_participants',
    assignees: [{ userId: 'reader', isActive: true }], visibilityUsers: [] };
  const completion = { status: 'draft', workCycle: 1, taskAssignee: { userId: 'reader', isActive: true, taskId: task.id, task } };
  const service = new FilesService({
    taskAssigneeCompletion: { findUnique: async () => completion },
    task: { findFirst: async ({ where }: { where: RecordValue }) => matches(where, task) ? task : null },
  } as never, {} as never, {} as never, {} as never, {} as never);
  const gate = service as unknown as { canAccessTaskCompletion(user: unknown, id: string, mode: 'read' | 'write'): Promise<boolean> };
  const reader = { id: 'reader', isActive: true, roleCode: 'manager', roleCodes: ['manager'], permissionCodes: [] };
  assert.equal(await gate.canAccessTaskCompletion(reader, 'completion-a', 'write'), false, 'An active task assignment alone must not permit completion uploads into an inaccessible order');
  order.assignments.push({ userId: 'reader', assignmentRoleCode: 'one_time_manager', isActive: true });
  assert.equal(await gate.canAccessTaskCompletion(reader, 'completion-a', 'write'), true);
  completion.workCycle = 0;
  assert.equal(await gate.canAccessTaskCompletion(reader, 'completion-a', 'write'), false, 'Current order access must not bypass completion lifecycle');
});

test('specification child grant cannot download attached file without root order read; root grant enables it', async () => {
  const order = { id: 'order-a', status: 'in_progress', createdByUserId: 'other', assignments: [] };
  const item = { id: 'spec-a', oneTimeOrderId: order.id, oneTimeOrder: order, deletedAt: null };
  const content = Buffer.from('private specification proof');
  const file = {
    id: 'file-a', deletedAt: null, uploadedByUserId: 'other', objectKey: 'isolated-unit-proof',
    mimeType: 'text/plain', sizeBytes: content.length, originalName: 'private-proof.txt',
    attachments: [{ entityType: 'one_time_order_specification_item', entityId: item.id }],
  };
  const db = {
    file: { findFirst: async ({ where }: { where: RecordValue }) => matches(where, file) ? file : null },
    oneTimeOrder: {
      findFirst: async ({ where }: { where: RecordValue }) => matches(where, order) ? order : null,
      findUnique: async ({ where }: { where: RecordValue }) => matches(where, order) ? order : null,
    },
    oneTimeOrderSpecificationItem: {
      findFirst: async ({ where }: { where: RecordValue }) => matches(where, item) ? item : null,
      findUnique: async ({ where }: { where: RecordValue }) => matches(where, item) ? item : null,
    },
  };
  let downloads = 0;
  const service = new FilesService(db as never, {
    downloadObject: async (objectKey: string) => {
      downloads += 1;
      assert.equal(objectKey, file.objectKey);
      return { body: content };
    },
  } as never, {} as never, {} as never, {} as never);
  const accessRules: AccessRule[] = [{
    actionCode: 'one_time_orders.specification.read', effect: 'allow', scope: 'selected', selectedIds: [order.id],
  }];
  const reader = { id: 'reader', login: 'reader', fullName: 'Reader', isActive: true,
    roleCode: 'manager', roleCodes: ['manager'], permissionCodes: [], accessRules };
  await assert.rejects(service.getContentById(reader, file.id), ForbiddenException);
  assert.equal(downloads, 0, 'Child permission must not reach storage without positive root visibility');
  accessRules.push({ actionCode: 'one_time_orders.read', effect: 'allow', scope: 'selected', selectedIds: [order.id] });
  const allowed = await service.getContentById(reader, file.id);
  assert.deepEqual(allowed.body, content);
  assert.equal(downloads, 1, 'Positive root grant must enable the real attached-file path');
  accessRules.push({ actionCode: 'one_time_orders.access', effect: 'deny', scope: 'all', selectedIds: [] });
  await assert.rejects(service.getContentById(reader, file.id), ForbiddenException);
  assert.equal(downloads, 1, 'Explicit root deny still wins both positive grants');
});

function objectFileFixture() {
  const object = { id: 'object-a', createdByUserId: 'reader', deletedAt: null as Date | null, status: 'active', assignments: [] };
  const children = ['object_daily_report', 'object_comment', 'object_arrival_photo'] as const;
  const files = ['object', ...children].map((type) => ({
    id: `file-${type}`, deletedAt: null, uploadedByUserId: 'other', objectKey: `key-${type}`,
    mimeType: 'text/plain', sizeBytes: 5, originalName: `${type}.txt`,
    attachments: [{ entityType: type, entityId: type === 'object' ? object.id : type }],
  }));
  const model = (rows: RecordValue[]) => ({
    findFirst: async ({ where }: { where: RecordValue }) => rows.find((row) => matches(where, row)) ?? null,
    findUnique: async ({ where }: { where: RecordValue }) => rows.find((row) => matches(where, row)) ?? null,
  });
  const db = { file: model(files), object: model([object]),
    objectDailyReport: model([{ id: 'object_daily_report', objectId: object.id, object }]),
    objectComment: model([{ id: 'object_comment', objectId: object.id, object }]),
    objectArrivalPhoto: model([{ id: 'object_arrival_photo', objectId: object.id, object }]),
  };
  const downloads: string[] = [];
  const service = new FilesService(db as never, { downloadObject: async (key: string) => {
    downloads.push(key); return { body: Buffer.from('proof') };
  } } as never, {} as never, {} as never, {} as never);
  const reader = { id: 'reader', login: 'reader', fullName: 'Reader', isActive: true,
    roleCode: 'manager', roleCodes: ['manager'], permissionCodes: [] as string[], accessRules: [] as AccessRule[] };
  return { service, reader, object, downloads, children };
}

test('materials deny blocks direct object original content but not report/comment/arrival files', async () => {
  const f = objectFileFixture();
  await f.service.getContentById(f.reader, 'file-object');
  f.reader.accessRules.push({ actionCode: 'objects.materials.read', effect: 'deny', scope: 'selected', selectedIds: [f.object.id] });
  await assert.rejects(f.service.getContentById(f.reader, 'file-object'), ForbiddenException);
  assert.equal(f.downloads.length, 1, 'Denied original must not reach storage');
  for (const type of f.children) assert.deepEqual((await f.service.getContentById(f.reader, `file-${type}`)).body, Buffer.from('proof'), type);
  f.reader.accessRules.push({ actionCode: 'objects.read', effect: 'deny', scope: 'selected', selectedIds: [f.object.id] });
  for (const type of f.children) await assert.rejects(f.service.getContentById(f.reader, `file-${type}`), ForbiddenException);
  assert.equal(f.downloads.length, 4);
});

test('HR extension deny blocks unassigned report file, retaining independent owner and assignment rights', async () => {
  const f = objectFileFixture();
  f.object.createdByUserId = 'other';
  f.reader.permissionCodes.push('objects.hr_reports_view');
  await f.service.getContentById(f.reader, 'file-object_daily_report');
  f.reader.accessRules.push({ actionCode: 'objects.hr_reports_view', effect: 'deny', scope: 'all', selectedIds: [] });
  await assert.rejects(f.service.getContentById(f.reader, 'file-object_daily_report'), ForbiddenException);
  assert.equal(f.downloads.length, 1);
  f.object.createdByUserId = f.reader.id;
  await f.service.getContentById(f.reader, 'file-object_daily_report');
  f.reader.accessRules.push({ actionCode: 'objects.reports.read', effect: 'deny', scope: 'all', selectedIds: [] });
  await assert.rejects(f.service.getContentById(f.reader, 'file-object_daily_report'), ForbiddenException);
  assert.equal(f.downloads.length, 2);
});

test('archived object report cannot reach storage through HR extension or all-scope read grants', async () => {
  const f = objectFileFixture();
  f.object.createdByUserId = 'other';
  f.reader.permissionCodes.push('objects.hr_reports_view');
  for (const actionCode of ['objects.read', 'objects.reports.read', 'objects.hr_reports_view', 'files.read', 'files.download']) {
    f.reader.accessRules.push({ actionCode, effect: 'allow', scope: 'all', selectedIds: [] });
  }
  f.object.deletedAt = new Date('2026-11-01T00:00:00Z');
  await assert.rejects(f.service.getContentById(f.reader, 'file-object_daily_report'), ForbiddenException);
  assert.equal(f.downloads.length, 0, 'Retaining archived ancestor identity must not authorize its original content');
  f.object.deletedAt = null;
  assert.deepEqual((await f.service.getContentById(f.reader, 'file-object_daily_report')).body, Buffer.from('proof'));
  assert.equal(f.downloads.length, 1, 'Same HR/grant fixture is a positive control when lifecycle permits read');
});
