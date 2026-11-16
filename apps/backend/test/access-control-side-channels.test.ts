import assert from 'node:assert/strict';
import test from 'node:test';

import { loadAccessSubject, notificationAccessWhere } from '../src/common/access/notification-access';
import { notificationSourceVisibilityWhere } from '../src/common/access/notification-source-visibility';
import { resourceAccessTarget } from '../src/common/access/resource-access-context';
import type { PrismaService } from '../src/modules/prisma/prisma.service';
import type { AccessRule } from '../src/modules/users-access/types/access-policy.type';
import { decideAccess } from '../src/modules/users-access/utils/access-policy.util';
import { delegatedObjectIds, objectDelegationContext } from '../src/modules/user-substitutions/object-delegation.context';

type Row = Record<string, unknown>;
function isRecord(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
// Evaluate only ordinary filter operators, with no database or production service.
function matches(where: unknown, row: Row): boolean {
  assert.ok(isRecord(where), 'Expected a predicate object');
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return (Array.isArray(value) ? value : [value]).every((part) => matches(part, row));
    if (key === 'OR') { assert.ok(Array.isArray(value)); return value.some((part) => matches(part, row)); }
    if (key === 'NOT') return !(Array.isArray(value) ? value : [value]).some((part) => matches(part, row));
    const actual = row[key];
    if (!isRecord(value)) return actual === value;
    if ('in' in value) { assert.ok(Array.isArray(value.in)); return value.in.includes(actual); }
    if ('notIn' in value) { assert.ok(Array.isArray(value.notIn)); return !value.notIn.includes(actual); }
    if ('not' in value) return actual !== value.not;
    if ('lte' in value || 'gt' in value || 'gte' in value) {
      assert.ok(actual instanceof Date);
      if ('lte' in value) { assert.ok(value.lte instanceof Date); if (actual > value.lte) return false; }
      if ('gt' in value) { assert.ok(value.gt instanceof Date); if (actual <= value.gt) return false; }
      if ('gte' in value) { assert.ok(value.gte instanceof Date); if (actual < value.gte) return false; }
      return true;
    }
    if ('some' in value) { assert.ok(Array.isArray(actual)); return actual.some((item) => matches(value.some, item)); }
    if ('is' in value) return isRecord(actual) && matches(value.is, actual);
    return isRecord(actual) && matches(value, actual);
  });
}
function fixture(rules: AccessRule[] = [], permissions: string[] = []) {
  const user = {
    id: 'reader', isActive: true, deletedAt: null, accessVersion: 1, accessRules: rules,
    roles: [{ role: { code: 'manager', permissions: [{ permission: { code: 'objects.read' } }] } }],
    permissions: permissions.map((code) => ({ permission: { code } })),
  };
  const data: Record<string, Row[]> = {
    user: [user],
    object: [
      { id: 'object-a', createdByUserId: 'creator', deletedAt: null, assignments: [{ userId: 'reader', isActive: true }] },
      { id: 'object-outside', createdByUserId: 'reader', deletedAt: null, assignments: [] },
    ],
    objectDailyReport: [{ id: 'report-a', objectId: 'object-a' }],
    objectArrivalPhoto: [{ id: 'arrival-a', objectId: 'object-a' }],
    objectComment: [{ id: 'comment-a', objectId: 'object-a' }],
    oneTimeOrder: [{ id: 'order-a', createdByUserId: 'creator', assignments: [{ userId: 'reader', assignmentRoleCode: 'one_time_manager', isActive: true }] }],
    oneTimeOrderDailyReport: [{ id: 'order-report-a', oneTimeOrderId: 'order-a' }],
    oneTimeOrderComment: [{ id: 'order-comment-a', oneTimeOrderId: 'order-a' }],
    oneTimeOrderPhoto: [{ id: 'order-photo-a', oneTimeOrderId: 'order-a' }],
    oneTimeOrderSpecificationItem: [{ id: 'spec-a', oneTimeOrderId: 'order-a' }],
    task: [{ id: 'task-a', objectId: 'object-a', oneTimeOrderId: null, createdByUserId: 'creator', assignees: [{ userId: 'reader', isActive: true }], visibilityUsers: [] }],
    taskAssigneeCompletion: [{ id: 'completion-a', taskAssignee: { taskId: 'task-a' } }], candidate: [],
    userSubstitution: [], employee: [], chatRoom: [], chatMessage: [], objectAssignment: [], oneTimeOrderAssignment: [],
    inventoryMovement: [{ id: 'movement-a', inventoryItemId: 'item-a', createdByUserId: 'creator', relatedObjectId: 'object-a', relatedOneTimeOrderId: null }],
    equipmentUnit: [{ id: 'equipment-a', currentObjectId: 'object-a', currentOneTimeOrderId: null }],
    equipmentMovement: [{ id: 'equipment-movement-a', equipmentUnitId: 'equipment-a', fromObjectId: null, toObjectId: 'object-a', fromOneTimeOrderId: null, toOneTimeOrderId: null }],
    accountabilityExpense: [{ id: 'expense-a', oneTimeOrderId: 'order-a', accountabilityAccount: { userId: 'reader' } }],
    accountabilityFunding: [{ id: 'funding-a', oneTimeOrderId: 'order-a', accountabilityAccount: { userId: 'reader' } }],
    accountabilityClosure: [],
    approvalRequest: [
      { id: 'approval-object', approvalType: 'object_change_confirmation', createdByUserId: 'reader', sourceEntityType: 'object', sourceEntityId: 'object-a' },
      { id: 'approval-task', approvalType: 'task_result_confirmation', createdByUserId: 'reader', sourceEntityType: 'task', sourceEntityId: 'task-a' },
      { id: 'approval-expense', approvalType: 'accountability_closure_confirmation', createdByUserId: 'reader', sourceEntityType: 'accountability_expense', sourceEntityId: 'expense-a' },
      { id: 'approval-control', approvalType: 'object_change_confirmation', createdByUserId: 'reader', sourceEntityType: 'object', sourceEntityId: 'object-outside' },
    ],
    notification: [],
  };
  const queries: Array<{ model: string; where: Row; select?: Row; distinct?: string[] }> = [];
  const relational = (model: string, row: Row): Row => {
    if (['objectDailyReport', 'objectArrivalPhoto', 'objectComment'].includes(model)) {
      return { ...row, object: data.object.find((item) => item.id === row.objectId) ?? null };
    }
    if (['oneTimeOrderDailyReport', 'oneTimeOrderComment', 'oneTimeOrderPhoto', 'oneTimeOrderSpecificationItem'].includes(model)) {
      return { ...row, oneTimeOrder: data.oneTimeOrder.find((item) => item.id === row.oneTimeOrderId) ?? null };
    }
    if (model === 'task') return { objectId: null, oneTimeOrderId: null, assignees: [], visibilityUsers: [], ...row,
      object: data.object.find((item) => item.id === row.objectId) ?? null,
      oneTimeOrder: data.oneTimeOrder.find((item) => item.id === row.oneTimeOrderId) ?? null,
    };
    if (model === 'inventoryMovement') return { ...row,
      // The real movement visibility predicate requires a positive source read,
      // not merely the absence of an inventory deny. Model the actual relations.
      relatedObject: data.object.find((item) => item.id === row.relatedObjectId) ?? null,
      relatedOneTimeOrder: data.oneTimeOrder.find((item) => item.id === row.relatedOneTimeOrderId) ?? null,
    };
    if (model === 'taskAssigneeCompletion') {
      assert.ok(isRecord(row.taskAssignee));
      const task = data.task.find((item) => item.id === (row.taskAssignee as Row).taskId);
      return { ...row, taskAssignee: { ...row.taskAssignee, task: task ? relational('task', task) : null } };
    }
    return row;
  };
  const project = (row: Row, select: Row): Row => Object.fromEntries(Object.entries(select).map(([key, selection]) => {
    if (selection === true) return [key, row[key]];
    assert.ok(isRecord(selection));
    assert.ok(Array.isArray(row[key]));
    const children = (row[key] as Row[]).filter((child) => !selection.where || matches(selection.where, child));
    return [key, children.map((child) => selection.select ? project(child, selection.select as Row) : child)];
  }));
  const models = Object.fromEntries(Object.entries(data).map(([name, items]) => [name, {
    count: async ({ where }: { where: Row }) => items.filter((row) => matches(where, row)).length,
    findFirst: async ({ where }: { where: Row }) => items.map((row) => relational(name, row)).find((row) => matches(where, row)) ?? null,
    findUnique: async ({ where }: { where: Row }) => items.map((row) => relational(name, row)).find((row) => matches(where, row)) ?? null,
    findMany: async ({ where, select, distinct }: { where: Row; select?: Row; distinct?: string[] }) => {
      queries.push({ model: name, where, select, distinct });
      let result = items.map((row) => relational(name, row)).filter((row) => matches(where, row));
      if (distinct) result = result.filter((row, index) => result.findIndex((other) => distinct.every((key) => other[key] === row[key])) === index);
      return select ? result.map((row) => project(row, select)) : result;
    },
  }]));
  const syncNotifications = () => {
    data.notification.splice(0, data.notification.length);
    for (const [model, type] of [
      ['object', 'object'], ['objectDailyReport', 'object_daily_report'], ['objectArrivalPhoto', 'object_arrival_photo'], ['objectComment', 'object_comment'],
      ['oneTimeOrder', 'one_time_order'], ['oneTimeOrderDailyReport', 'one_time_order_daily_report'], ['oneTimeOrderComment', 'one_time_order_comment'],
      ['oneTimeOrderPhoto', 'one_time_order_photo'], ['oneTimeOrderSpecificationItem', 'one_time_order_specification_item'],
      ['task', 'task'], ['taskAssigneeCompletion', 'task_assignee_completion'], ['candidate', 'candidate'], ['employee', 'employee'], ['chatRoom', 'chat_room'],
      ['inventoryMovement', 'inventory_movement'], ['equipmentUnit', 'equipment_unit'], ['equipmentMovement', 'equipment_movement'],
      ['accountabilityExpense', 'accountability_expense'], ['accountabilityFunding', 'accountability_funding'], ['approvalRequest', 'approval_request'],
    ]) for (const row of data[model]) data.notification.push(notification(type, String(row.id)));
  };
  syncNotifications();
  return { db: models as unknown as PrismaService, data, user, queries, syncNotifications };
}
const deny = (actionCode: string, scope: AccessRule['scope'] = 'all', selectedIds: string[] = []): AccessRule => ({
  actionCode, effect: 'deny', scope, selectedIds,
});
const notification = (entityType: string, entityId: string, extra: Row = {}) => ({
  id: `${entityType}-${entityId}`, recipientUserId: 'reader', dismissedAt: null,
  createdAt: new Date('2026-11-07T00:00:00Z'), entityType, entityId, ...extra,
});

test('resource context resolves report/file ancestry to its real object identity', async () => {
  const f = fixture([deny('objects.access', 'selected', ['object-a'])]);
  const target = await resourceAccessTarget(f.db, 'object_daily_report', 'report-a');
  assert.ok(target);
  assert.equal(target.actionCode, 'objects.reports.read');
  assert.equal(target.context.resourceId, 'object-a');
  assert.deepEqual(target.context.assignedUserIds, ['reader']);
  const subject = await loadAccessSubject(f.db, 'reader');
  assert.ok(subject);
  assert.equal(decideAccess(subject, 'files.preview', true, {
    resourceType: 'file', resourceId: 'opaque-file', parents: [target],
  }), false);
});

test('task and movement contexts preserve domain parents; finance uses account owner identity', async () => {
  const f = fixture([deny('objects.access')]);
  const subject = await loadAccessSubject(f.db, 'reader');
  assert.ok(subject);
  for (const [type, id] of [['task', 'task-a'], ['inventory_movement', 'movement-a']]) {
    const target = await resourceAccessTarget(f.db, type, id);
    assert.ok(target);
    assert.equal(decideAccess(subject, target.actionCode, true, target.context), false, type);
  }
  const expense = await resourceAccessTarget(f.db, 'accountability_expense', 'expense-a');
  assert.equal(expense?.context.ownerUserId, 'reader');
  assert.equal(expense?.context.resourceId, 'reader');
  assert.equal(expense?.context.parents?.[0].context?.resourceId, 'order-a');
});

test('fresh subject preserves legacy deny and reflects revoke without changing an old client identity', async () => {
  const f = fixture([], ['candidates.view', 'candidates.denied']);
  const first = await loadAccessSubject(f.db, 'reader');
  assert.ok(first);
  assert.ok(first.permissionCodes?.includes('objects.read'));
  assert.ok(first.permissionCodes?.includes('candidates.denied'));
  assert.equal(decideAccess(first, 'candidates.view', true), false);
  f.user.accessRules.push(deny('notifications.access'));
  f.user.accessVersion += 1;
  const where = await notificationAccessWhere(f.db, 'reader');
  assert.equal(matches(where, notification('object', 'object-a')), false);
});

test('notification invariant never opens foreign recipients or dismissed rows through all-scope allow', async () => {
  const f = fixture([{ actionCode: 'notifications.read', effect: 'allow', scope: 'all', selectedIds: [] }]);
  const where = await notificationAccessWhere(f.db, 'reader');
  assert.equal(matches(where, notification('object', 'object-a')), true);
  assert.equal(matches(where, notification('object', 'object-a', { recipientUserId: 'other' })), false);
  assert.equal(matches(where, notification('object', 'object-a', { dismissedAt: new Date() })), false);
  f.user.isActive = false;
  assert.equal(matches(await notificationAccessWhere(f.db, 'reader'), notification('object', 'object-a')), false);
});

test('direct object/report deny is present in the same predicate used for list and count', async () => {
  const f = fixture([deny('objects.access', 'selected', ['object-a'])]);
  const where = await notificationAccessWhere(f.db, 'reader');
  const rows = [notification('object', 'object-a'), notification('object_daily_report', 'report-a'), notification('one_time_order', 'order-a')];
  const allowed = rows.filter((row) => matches(where, row));
  assert.deepEqual(allowed.map((row) => row.entityType), ['one_time_order']);
  assert.equal(allowed.length, 1);
});

test('write-only deny leaves unrelated read notifications available', async () => {
  const f = fixture([deny('objects.update')]);
  assert.equal(matches(await notificationAccessWhere(f.db, 'reader'), notification('object', 'object-a')), true);
});

test('object deny also removes task notifications whose parent object is forbidden', async () => {
  const f = fixture([deny('objects.access')]);
  const where = await notificationAccessWhere(f.db, 'reader');
  assert.equal(matches(where, notification('task', 'task-a')), false,
    'A saved task notification may reveal its forbidden object after revocation');
});

test('selected order deny also removes linked payout notifications', async () => {
  const f = fixture([deny('one_time_orders.access', 'selected', ['order-a'])]);
  const where = await notificationAccessWhere(f.db, 'reader');
  assert.equal(matches(where, notification('accountability_expense', 'expense-a')), false,
    'A saved payout notification must respect its real order ancestor');
});

test('object descendants and their approval notifications are excluded without suppressing unrelated approvals', async () => {
  const f = fixture([deny('objects.access', 'selected', ['object-a'])]);
  const where = await notificationAccessWhere(f.db, 'reader');
  for (const [type, id] of [
    ['task', 'task-a'], ['task_assignee_completion', 'completion-a'],
    ['inventory_movement', 'movement-a'], ['equipment_unit', 'equipment-a'],
    ['equipment_movement', 'equipment-movement-a'],
    ['approval_request', 'approval-object'], ['approval_request', 'approval-task'],
  ]) {
    assert.equal(matches(where, notification(type, id)), false, `${type}/${id}`);
  }
  assert.equal(matches(where, notification('approval_request', 'approval-control')), true);
  assert.equal(matches(where, notification('approval_request', 'approval-expense')), true);
  assert.ok(f.queries.some((query) => query.model === 'approvalRequest'), 'Approval ancestry must be queried, not stubbed away');
});

test('order financial descendants and approval source ids are filtered before notification queries', async () => {
  const f = fixture([deny('one_time_orders.access', 'selected', ['order-a'])]);
  const where = await notificationAccessWhere(f.db, 'reader');
  for (const [type, id] of [
    ['accountability_expense', 'expense-a'], ['accountability_funding', 'funding-a'],
    ['approval_request', 'approval-expense'],
  ]) assert.equal(matches(where, notification(type, id)), false, `${type}/${id}`);
  assert.equal(matches(where, notification('approval_request', 'approval-object')), true);
  assert.equal(matches(where, notification('approval_request', 'approval-control')), true);
});

for (const scope of ['all', 'selected'] as const) {
  test(`reports.read ${scope} deny hides reports only, preserving root/arrival/comment/task`, async () => {
    const f = fixture([deny('objects.reports.read', scope, scope === 'selected' ? ['object-a'] : [])]);
    f.data.object.push({ id: 'object-other', createdByUserId: 'creator', deletedAt: null, assignments: [{ userId: 'reader', isActive: true }] });
    f.data.objectDailyReport.push({ id: 'report-other', objectId: 'object-other' });
    f.syncNotifications();
    const where = await notificationAccessWhere(f.db, 'reader');
    assert.equal(matches(where, notification('object_daily_report', 'report-a')), false);
    assert.equal(matches(where, notification('object_daily_report', 'report-other')), scope === 'selected');
    for (const [type, id] of [
      ['object', 'object-a'], ['object_arrival_photo', 'arrival-a'], ['object_comment', 'comment-a'],
      ['task', 'task-a'], ['inventory_movement', 'movement-a'], ['approval_request', 'approval-object'],
    ]) assert.equal(matches(where, notification(type, id)), true, `${scope}: unrelated ${type}/${id}`);
  });
}

test('selected specification deny hides item and specification_updated notification keyed by order id only', async () => {
  const f = fixture([deny('one_time_orders.specification.read', 'selected', ['order-a'])]);
  f.data.oneTimeOrder.push({ id: 'order-other', createdByUserId: 'creator', assignments: [{ userId: 'reader', assignmentRoleCode: 'one_time_manager', isActive: true }] });
  f.data.oneTimeOrderSpecificationItem.push({ id: 'spec-other', oneTimeOrderId: 'order-other' });
  f.syncNotifications();
  const where = await notificationAccessWhere(f.db, 'reader');
  assert.equal(matches(where, notification('one_time_order_specification_item', 'spec-a')), false);
  assert.equal(matches(where, notification('one_time_order', 'order-a', { type: 'one_time_order.specification_updated' })), false);
  assert.equal(matches(where, notification('one_time_order', 'order-other', { type: 'one_time_order.specification_updated' })), true);
  assert.equal(matches(where, notification('one_time_order_specification_item', 'spec-other')), true);
  assert.equal(matches(where, notification('one_time_order', 'order-a', { type: 'one_time_order.status_changed' })), true);
  assert.equal(matches(where, notification('accountability_expense', 'expense-a')), false,
    'A raw expense is not a registered positive notification source; an unrelated leaf deny cannot authorize it by absence');
  assert.equal(matches(where, notification('approval_request', 'approval-expense')), true,
    'The saved approval is a registered, actually readable source with the real expense/order ancestry');
});

for (const actionCode of ['objects.access', 'objects.read', 'one_time_orders.access', 'one_time_orders.read']) {
  test(`${actionCode} root deny still hides its descendants`, async () => {
    const f = fixture([deny(actionCode)]);
    const where = await notificationAccessWhere(f.db, 'reader');
    const object = actionCode.startsWith('objects.');
    const descendants = object ? [
      ['object', 'object-a'], ['object_daily_report', 'report-a'], ['object_arrival_photo', 'arrival-a'],
      ['object_comment', 'comment-a'], ['task', 'task-a'], ['task_assignee_completion', 'completion-a'],
      ['inventory_movement', 'movement-a'], ['approval_request', 'approval-task'],
    ] : [
      ['one_time_order', 'order-a'], ['one_time_order_specification_item', 'spec-a'],
      ['accountability_expense', 'expense-a'], ['accountability_funding', 'funding-a'],
      ['approval_request', 'approval-expense'],
    ];
    for (const [type, id] of descendants) assert.equal(matches(where, notification(type, id)), false, `${type}/${id}`);
  });
}

test('empty refs fail closed for known, unknown and incomplete sources; only genuinely source-less notices remain visible', async () => {
  const f = fixture();
  f.data.notification.splice(0);
  const subject = await loadAccessSubject(f.db, 'reader');
  assert.ok(subject);
  const where = await notificationSourceVisibilityWhere(f.db, subject);
  for (const type of ['object', 'object_daily_report', 'object_arrival_photo', 'object_comment',
    'one_time_order', 'one_time_order_daily_report', 'one_time_order_comment', 'one_time_order_photo',
    'one_time_order_specification_item', 'task', 'task_assignee_completion', 'candidate', 'employee', 'chat_room', 'manager_visit_plan',
    'inventory_movement', 'approval_request']) {
    assert.equal(matches(where, notification(type, 'inserted-after-refs')), false, type);
  }
  assert.equal(matches(where, notification('custom_uncovered_source', 'opaque')), false);
  assert.equal(matches(where, notification('placeholder', 'opaque', { entityType: null })), false,
    'A null type with a non-null ID is incomplete, not source-less');
  assert.equal(matches(where, notification('object', 'opaque', { entityId: null })), false);
  assert.equal(matches(where, notification('custom_uncovered_source', 'opaque', { entityId: null })), false);
  assert.equal(matches(where, notification('placeholder', 'opaque', { entityType: null, entityId: null })), true);
  assert.equal(f.queries.some((query) => query.model === 'userSubstitution'), false,
    'Empty refs must not trigger delegation or whole-domain scans');
  assert.deepEqual(f.queries.map((query) => query.model), ['notification']);
});

test('saved inventory notifications require actual readable source relations and explicit recipient references', async () => {
  const f = fixture();
  f.data.inventoryMovement.push({ id: 'movement-control', inventoryItemId: 'item-control', createdByUserId: 'creator',
    relatedObjectId: 'object-outside', relatedOneTimeOrderId: null });
  f.syncNotifications();
  const subject = await loadAccessSubject(f.db, 'reader');
  assert.ok(subject);
  const visible = async (id: string) => matches(await notificationSourceVisibilityWhere(f.db, subject), notification('inventory_movement', id));
  assert.equal(await visible('movement-a'), true, 'Saved movement has an actually assigned readable object source');
  assert.equal(await visible('movement-control'), true, 'Control source is independently owned by the reader');
  f.data.object[0].assignments = [];
  assert.equal(await visible('movement-a'), false, 'Inventory baseline cannot replace positive parent object read');
  assert.equal(await visible('movement-control'), true);
  f.data.object[0].assignments = [{ userId: 'reader', isActive: true }];
  f.data.notification.splice(0);
  assert.equal(await visible('movement-a'), false, 'Existing accessible domain rows do not manufacture missing notification references');
  f.data.notification.push(notification('inventory_movement', 'movement-control'));
  assert.equal(await visible('movement-a'), false, 'An unrelated saved reference cannot authorize A');
  assert.equal(await visible('movement-control'), true, 'Explicit saved known reference restores only its own readable source');
});

test('saved core 12 sources are positively allowed by actual source ids, with no body loading or domain scan', async () => {
  const f = fixture([], ['candidates.view']);
  f.data.candidate.push({ id: 'candidate-a', deletedAt: null, createdByUserId: 'creator', assignments: [] });
  f.syncNotifications();
  const subject = await loadAccessSubject(f.db, 'reader');
  assert.ok(subject);
  const where = await notificationSourceVisibilityWhere(f.db, subject);
  for (const [type, id] of [
    ['object', 'object-a'], ['object_daily_report', 'report-a'], ['object_arrival_photo', 'arrival-a'], ['object_comment', 'comment-a'],
    ['one_time_order', 'order-a'], ['one_time_order_daily_report', 'order-report-a'], ['one_time_order_comment', 'order-comment-a'],
    ['one_time_order_photo', 'order-photo-a'], ['one_time_order_specification_item', 'spec-a'],
    ['task', 'task-a'], ['task_assignee_completion', 'completion-a'], ['candidate', 'candidate-a'],
  ]) assert.equal(matches(where, notification(type, id)), true, `${type}/${id}`);
  const referenceQuery = f.queries.find((query) => query.model === 'notification')!;
  assert.deepEqual(referenceQuery.select, { entityType: true, entityId: true });
  assert.deepEqual(referenceQuery.distinct, ['entityType', 'entityId']);
  for (const query of f.queries.filter((entry) => !['notification', 'userSubstitution'].includes(entry.model))) {
    assert.deepEqual(query.select, { id: true }, query.model);
    assert.ok(JSON.stringify(query.where).includes('"id":{"in":['), `${query.model} must restrict to saved refs`);
  }
  f.data.object.push({ id: 'new-after-snapshot', createdByUserId: 'reader', deletedAt: null, assignments: [] });
  f.data.notification.push(notification('object', 'new-after-snapshot'));
  assert.equal(matches(where, notification('object', 'new-after-snapshot')), false,
    'A source inserted after refs cannot bypass positive membership even if it is otherwise accessible');
});

test('fresh assignment removal hides stored root and report, while independent ownership stays visible', async () => {
  const f = fixture();
  f.data.object.push({ id: 'own-object', createdByUserId: 'reader', deletedAt: null, assignments: [] });
  f.syncNotifications();
  const subject = await loadAccessSubject(f.db, 'reader');
  assert.ok(subject);
  const first = await notificationSourceVisibilityWhere(f.db, subject);
  assert.equal(matches(first, notification('object', 'object-a')), true);
  assert.equal(matches(first, notification('object_daily_report', 'report-a')), true);
  f.data.object[0].assignments = [];
  const revoked = await notificationSourceVisibilityWhere(f.db, subject);
  assert.equal(matches(revoked, notification('object', 'object-a')), false);
  assert.equal(matches(revoked, notification('object_daily_report', 'report-a')), false);
  assert.equal(matches(revoked, notification('object', 'own-object')), true);
  assert.deepEqual(subject.accessRules, [], 'No explicit deny may be invented to simulate assignment removal');
});

test('child order grant requires positive root order read, and own task still requires its parent order read', async () => {
  const f = fixture([{ actionCode: 'one_time_orders.specification.read', effect: 'allow', scope: 'selected', selectedIds: ['order-a'] }]);
  f.data.oneTimeOrder[0].assignments = [];
  f.data.task.push({ id: 'own-order-task', objectId: null, oneTimeOrderId: 'order-a', createdByUserId: 'reader', assignees: [], visibilityUsers: [] });
  f.syncNotifications();
  const subject = await loadAccessSubject(f.db, 'reader');
  assert.ok(subject);
  const childOnly = await notificationSourceVisibilityWhere(f.db, subject);
  assert.equal(matches(childOnly, notification('one_time_order_specification_item', 'spec-a')), false);
  assert.equal(matches(childOnly, notification('task', 'own-order-task')), false);
  f.user.accessRules.push({ actionCode: 'one_time_orders.read', effect: 'allow', scope: 'selected', selectedIds: ['order-a'] });
  const rootGranted = await notificationSourceVisibilityWhere(f.db, (await loadAccessSubject(f.db, 'reader'))!);
  assert.equal(matches(rootGranted, notification('one_time_order_specification_item', 'spec-a')), true);
  assert.equal(matches(rootGranted, notification('task', 'own-order-task')), true);
});

test('delegation expiry removes only delegated rights and ignores an ambient actor grant snapshot', async () => {
  const f = fixture();
  f.data.object[0].createdByUserId = 'principal';
  f.data.object[0].assignments = [];
  f.data.object.push({ id: 'own-object', createdByUserId: 'reader', deletedAt: null, assignments: [] });
  f.syncNotifications();
  const principal = { ...f.user, id: 'principal', accessRules: [], permissions: [] };
  const record: Row = {
    id: 'substitution-a', principalUserId: 'principal', replacementUserId: 'reader', revokedAt: null,
    startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 60_000),
    principal, replacement: f.user, objects: [{ objectId: 'object-a', object: f.data.object[0] }],
  };
  f.data.userSubstitution.push(record);
  const subject = await loadAccessSubject(f.db, 'reader');
  assert.ok(subject);
  const live = await notificationSourceVisibilityWhere(f.db, subject);
  assert.equal(matches(live, notification('object', 'object-a')), true);
  assert.equal(matches(live, notification('object', 'own-object')), true);
  record.endsAt = new Date(0);
  const outer = { actorUserId: 'reader', used: new Map(), grants: [{
    substitutionId: 'stale-ambient', principalUserId: 'principal', objectId: 'object-a',
    actions: ['view' as const], endsAt: Date.now() + 60_000, taskWideAccess: false,
  }] };
  await objectDelegationContext.run(outer, async () => {
    const expired = await notificationSourceVisibilityWhere(f.db, subject);
    assert.equal(matches(expired, notification('object', 'object-a')), false);
    assert.equal(matches(expired, notification('object', 'own-object')), true);
    assert.equal(objectDelegationContext.getStore(), outer, 'Temporary recipient context must restore outer ALS');
    assert.deepEqual(delegatedObjectIds('reader'), ['object-a']);
  });
  assert.equal(objectDelegationContext.getStore(), undefined);
});

test('saved employee birthday sources preserve archived-card read baseline but obey current permission deny', async () => {
  const f = fixture();
  f.data.employee.push({ id: 'employee-a', deletedAt: null }, { id: 'employee-deleted', deletedAt: new Date() });
  f.syncNotifications();
  const check = async (id: string) => matches(await notificationSourceVisibilityWhere(f.db, (await loadAccessSubject(f.db, 'reader'))!),
    notification('employee', id, { type: 'employee.birthday' }));
  assert.equal(await check('employee-a'), false);
  assert.equal(await check('employee-deleted'), false);
  f.user.accessRules.push({ actionCode: 'employees.view', effect: 'allow', scope: 'selected', selectedIds: ['employee-a', 'employee-deleted'] });
  assert.equal(await check('employee-a'), true);
  // EmployeesService.getById deliberately permits archived cards; source
  // visibility must preserve that baseline, not invent a deletedAt invariant.
  assert.equal(await check('employee-deleted'), true);
  f.user.accessRules.push(deny('employees.view', 'selected', ['employee-deleted']));
  assert.equal(await check('employee-deleted'), false);
  assert.equal(await check('employee-a'), true);
  f.user.accessRules.push(deny('employees.access'));
  assert.equal(await check('employee-a'), false);
  assert.equal(await check('employee-deleted'), false);
});

function chatFixture() {
  const f = fixture();
  for (const id of ['room-a', 'room-control']) f.data.chatRoom.push({
    id, createdByUserId: 'other', deletedAt: null, visibilityType: 'explicit_members',
    participants: [{ userId: 'reader', leftAt: null, joinedAt: new Date('2026-01-01T00:00:00Z') }],
  });
  f.syncNotifications();
  return f;
}

test('stored chat room notification is revoked after leave with the same subject, retaining control room', async () => {
  const f = chatFixture();
  const subject = (await loadAccessSubject(f.db, 'reader'))!;
  const row = notification('chat_room', 'room-a', { type: 'chat.message_received' });
  assert.equal(matches(await notificationSourceVisibilityWhere(f.db, subject), row), true);
  (f.data.chatRoom[0].participants as Row[])[0].leftAt = new Date();
  const after = await notificationSourceVisibilityWhere(f.db, subject);
  assert.equal(matches(after, row), false);
  assert.equal(matches(after, notification('chat_room', 'room-control', { type: 'chat.message_received' })), true);
  subject.accessRules = [
    { actionCode: 'chat.read', effect: 'allow', scope: 'all', selectedIds: [] },
    { actionCode: 'chat.messages.read', effect: 'allow', scope: 'all', selectedIds: [] },
  ];
  assert.equal(matches(await notificationSourceVisibilityWhere(f.db, subject), row), false, 'Grants cannot invent active membership');
  const query = f.queries.find((entry) => entry.model === 'chatRoom')!;
  assert.deepEqual(query.where, { id: { in: ['room-a', 'room-control'] } });
  assert.deepEqual(query.select?.participants, { where: { leftAt: null }, select: { userId: true, joinedAt: true } });
});

test('chat rejoin boundary hides older message events, includes exact joinedAt and retains other room events', async () => {
  const f = chatFixture();
  const subject = (await loadAccessSubject(f.db, 'reader'))!;
  const joinedAt = new Date('2026-11-07T01:00:00Z');
  const membership = (f.data.chatRoom[0].participants as Row[])[0];
  const oldMessage = notification('chat_room', 'room-a', { type: 'chat.message_received', createdAt: new Date(joinedAt.getTime() - 1) });
  assert.equal(matches(await notificationSourceVisibilityWhere(f.db, subject), oldMessage), true);
  membership.leftAt = new Date();
  assert.equal(matches(await notificationSourceVisibilityWhere(f.db, subject), oldMessage), false);
  membership.leftAt = null;
  membership.joinedAt = joinedAt;
  const where = await notificationSourceVisibilityWhere(f.db, subject);
  assert.equal(matches(where, oldMessage), false);
  for (const offset of [0, 1]) assert.equal(matches(where, notification('chat_room', 'room-a', {
    type: 'chat.message_received', createdAt: new Date(joinedAt.getTime() + offset),
  })), true, `createdAt offset ${offset}`);
  assert.equal(matches(where, notification('chat_room', 'room-a', { type: 'chat.room_updated', createdAt: oldMessage.createdAt })), true);
  assert.equal(matches(where, notification('chat_room', 'room-control', { type: 'chat.message_received' })), true,
    'A different room retains its own membership boundary');
});

test('chat message leaf deny hides message_received only; room/root deny hides all room events', async () => {
  const f = chatFixture();
  const message = notification('chat_room', 'room-a', { type: 'chat.message_received' });
  const update = notification('chat_room', 'room-a', { type: 'chat.room_updated' });
  f.user.accessRules.push(deny('chat.messages.read', 'selected', ['room-a']));
  let where = await notificationAccessWhere(f.db, 'reader');
  assert.equal(matches(where, message), false);
  assert.equal(matches(where, update), true);
  assert.equal(matches(where, notification('chat_room', 'room-control', { type: 'chat.message_received' })), true);
  f.user.accessRules.push(deny('chat.read', 'selected', ['room-a']));
  where = await notificationAccessWhere(f.db, 'reader');
  assert.equal(matches(where, update), false);
});

test('chat source uses real role/assignment baseline, leadership invariant and root module deny', async () => {
  const f = fixture();
  f.user.roles[0].role.code = 'hr';
  for (const [id, visibilityType] of [['objects-room', 'objects_scope'], ['orders-room', 'one_time_orders_scope'], ['leadership-room', 'leadership_only']]) {
    f.data.chatRoom.push({ id, visibilityType, deletedAt: null, createdByUserId: 'other', participants: [] });
  }
  f.syncNotifications();
  const visible = async (id: string) => matches(await notificationSourceVisibilityWhere(f.db, (await loadAccessSubject(f.db, 'reader'))!),
    notification('chat_room', id, { type: 'chat.room_updated' }));
  assert.equal(await visible('objects-room'), false);
  assert.equal(await visible('orders-room'), false);
  f.data.objectAssignment.push({ userId: 'reader', isActive: true });
  f.data.oneTimeOrderAssignment.push({ userId: 'reader', isActive: true, assignmentRoleCode: 'one_time_manager' });
  assert.equal(await visible('objects-room'), true);
  assert.equal(await visible('orders-room'), true);
  f.user.accessRules.push({ actionCode: 'chat.read', effect: 'allow', scope: 'all', selectedIds: [] });
  assert.equal(await visible('leadership-room'), false);
  f.user.accessRules.splice(0);
  f.user.roles[0].role.code = 'operation_manager';
  assert.equal(await visible('objects-room'), false, 'Legacy objects-chat role exclusion remains');
  assert.equal(await visible('orders-room'), true);
  f.user.accessRules.push(deny('one_time_orders.access'));
  assert.equal(await visible('orders-room'), false);
});

test('HR profile extension deny removes only the profile branch, preserving independent own/assigned rights', async () => {
  const f = fixture([], ['objects.view_hr']);
  f.data.object[0].assignments = [];
  const visible = async () => matches(await notificationSourceVisibilityWhere(f.db, (await loadAccessSubject(f.db, 'reader'))!),
    notification('object', 'object-a'));
  assert.equal(await visible(), true);
  f.user.accessRules.push(deny('objects.view_hr'));
  assert.equal(await visible(), false);
  f.data.object[0].createdByUserId = 'reader';
  assert.equal(await visible(), true);
  f.data.object[0].createdByUserId = 'other';
  f.data.object[0].assignments = [{ userId: 'reader', isActive: true }];
  assert.equal(await visible(), true);
  f.user.accessRules.push(deny('objects.read'));
  assert.equal(await visible(), false);
});

test('HR report extension deny removes the extension, not independent own/assigned report rights', async () => {
  const f = fixture([deny('objects.hr_reports_view')], ['objects.hr_reports_view']);
  f.data.object[0].assignments = [];
  const visible = async () => matches(await notificationSourceVisibilityWhere(f.db, (await loadAccessSubject(f.db, 'reader'))!),
    notification('object_daily_report', 'report-a'));
  assert.equal(await visible(), false);
  f.data.object[0].createdByUserId = 'reader';
  assert.equal(await visible(), true);
  f.data.object[0].createdByUserId = 'other';
  f.data.object[0].assignments = [{ userId: 'reader', isActive: true }];
  assert.equal(await visible(), true);
  f.user.accessRules.push(deny('objects.reports.read'));
  assert.equal(await visible(), false);
});

for (const permission of ['objects.view_hr', 'objects.hr_reports_view']) {
  test(`${permission} preserves its narrow source-read exception without opening arrival/comments`, async () => {
    const f = fixture([], [permission]);
    f.data.object[0].assignments = [];
    const subject = await loadAccessSubject(f.db, 'reader');
    assert.ok(subject);
    const where = await notificationSourceVisibilityWhere(f.db, subject);
    assert.equal(matches(where, notification('object', 'object-a')), permission === 'objects.view_hr');
    assert.equal(matches(where, notification('object_daily_report', 'report-a')), permission === 'objects.hr_reports_view');
    assert.equal(matches(where, notification('object_arrival_photo', 'arrival-a')), false);
    assert.equal(matches(where, notification('object_comment', 'comment-a')), false);
    f.user.accessRules.push(deny('objects.access'));
    const denied = await notificationSourceVisibilityWhere(f.db, (await loadAccessSubject(f.db, 'reader'))!);
    assert.equal(matches(denied, notification('object', 'object-a')), false);
    assert.equal(matches(denied, notification('object_daily_report', 'report-a')), false);
  });
}
