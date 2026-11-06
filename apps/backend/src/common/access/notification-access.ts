import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../modules/prisma/prisma.service';
import { getAccessAction } from '../../modules/users-access/access-action-catalog';
import { resolveEffectivePermissionCodes } from '../../modules/users-access/utils/effective-permissions.util';
import { buildAccessWhere, type AccessRule, type AccessSubject } from '../../modules/users-access/utils/access-policy.util';
import { notificationSourceVisibilityWhere } from './notification-source-visibility';

const entityTypes: Record<string, string[]> = {
  objects: ['object', 'object_arrival_photo', 'object_daily_report', 'object_comment'],
  one_time_orders: ['one_time_order', 'one_time_order_daily_report', 'one_time_order_comment', 'one_time_order_photo', 'one_time_order_specification_item'],
  tasks: ['task', 'task_assignee_completion'], candidates: ['candidate'],
  inventory: ['inventory_movement'], equipment: ['equipment_unit', 'equipment_movement'],
  accountability: ['accountability_expense', 'accountability_funding', 'accountability_closure'],
  approvals: ['approval_request'], employees: ['employee'], counterparties: ['counterparty'],
  mats: ['rubber_mat', 'object_rubber_mat_quantity'], user_absences: ['user_absence'],
  visit_plans: ['manager_visit_plan'], user_substitutions: ['user_substitution'], chat: ['chat_room', 'chat_message'],
};

const leafNotificationTypes: Record<string, string[]> = {
  'objects.arrival.read': ['object_arrival_photo'],
  'objects.reports.read': ['object_daily_report'],
  'objects.comments.read': ['object_comment'],
  'one_time_orders.reports.read': ['one_time_order_daily_report'],
  'one_time_orders.comments.read': ['one_time_order_comment'],
  'one_time_orders.photos.read': ['one_time_order_photo'],
  'one_time_orders.specification.read': ['one_time_order_specification_item'],
  'chat.messages.read': ['chat_message'],
};

async function childIds(model: unknown, where: Record<string, unknown>): Promise<string[]> {
  return (await (model as { findMany: (args: unknown) => Promise<Array<{ id: string }>> }).findMany({ where, select: { id: true } })).map(row => row.id);
}

async function descendantExclusions(prisma: PrismaService, module: string, ids: string[]): Promise<Prisma.NotificationWhereInput[]> {
  if (!ids.length) return [];
  const object = module === 'objects';
  const result: Prisma.NotificationWhereInput[] = [];
  const add = (entityType: string, values: string[]): void => { if (values.length) result.push({ entityType, entityId: { in: values } }); };
  const tasks = await childIds(prisma.task, object ? { objectId: { in: ids } } : { oneTimeOrderId: { in: ids } });
  add('task', tasks);
  if (tasks.length) add('task_assignee_completion', await childIds(prisma.taskAssigneeCompletion, { taskAssignee: { taskId: { in: tasks } } }));
  add('inventory_movement', await childIds(prisma.inventoryMovement, object ? { relatedObjectId: { in: ids } } : { relatedOneTimeOrderId: { in: ids } }));
  add('equipment_unit', await childIds(prisma.equipmentUnit, object ? { currentObjectId: { in: ids } } : { currentOneTimeOrderId: { in: ids } }));
  add('equipment_movement', await childIds(prisma.equipmentMovement, object
    ? { OR: [{ fromObjectId: { in: ids } }, { toObjectId: { in: ids } }] }
    : { OR: [{ fromOneTimeOrderId: { in: ids } }, { toOneTimeOrderId: { in: ids } }] }));
  if (!object) {
    add('accountability_expense', await childIds(prisma.accountabilityExpense, { oneTimeOrderId: { in: ids } }));
    add('accountability_funding', await childIds(prisma.accountabilityFunding, { oneTimeOrderId: { in: ids } }));
  }
  return result;
}

export async function loadAccessSubject(prisma: Pick<PrismaService, 'user'>, id: string): Promise<AccessSubject | null> {
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: {
    id: true, isActive: true, accessVersion: true,
    accessRules: { select: { actionCode: true, effect: true, scope: true, selectedIds: true } },
    roles: { select: { role: { select: { code: true, permissions: { select: { permission: { select: { code: true } } } } } } } },
    permissions: { select: { permission: { select: { code: true } } } },
  } });
  return user ? {
    id: user.id, isActive: user.isActive, roleCodes: user.roles.map(entry => entry.role.code),
    permissionCodes: resolveEffectivePermissionCodes(user), accessVersion: user.accessVersion,
    accessRules: user.accessRules as AccessRule[],
  } : null;
}

/** Resolve denied resource IDs before paginating/counting notifications. Global
 * denials need no resource scan. No notification payload is loaded for filtering. */
export async function notificationAccessWhere(prisma: PrismaService, userId: string, actionCode = 'notifications.read', options: { includeDismissed?: boolean } = {}): Promise<Prisma.NotificationWhereInput> {
  const subject = await loadAccessSubject(prisma, userId);
  if (!subject?.isActive) return { id: { in: [] } };
  const inbox = { recipientUserId: userId, ...(!options.includeDismissed ? { dismissedAt: null } : {}) };
  const where = buildAccessWhere<Prisma.NotificationWhereInput>({
    subject, actionCode, legacyWhere: inbox,
    invariantWhere: inbox,
    parentActionCodes: ['notifications.read'],
    scopeWhere: rule => rule.scope === 'all' ? {} : rule.scope === 'own' ? { recipientUserId: userId } : null,
  }) as Prisma.NotificationWhereInput;
  const exclusions: Prisma.NotificationWhereInput[] = [];
  if (subject.permissionCodes?.includes('candidates.denied')) exclusions.push({ entityType: 'candidate' });
  for (const rule of subject.accessRules ?? []) {
    if (rule.effect !== 'deny') continue;
    const action = getAccessAction(rule.actionCode);
    if (!action || !entityTypes[action.module]) continue;
    // Write restrictions do not suppress unrelated read notifications.
    if (!rule.actionCode.endsWith('.access') && !/\.(read|view|history)$/.test(rule.actionCode)) continue;
    const types = leafNotificationTypes[rule.actionCode] ?? entityTypes[action.module]!;
    const denyDomainChildren = ['objects.access', 'objects.read', 'one_time_orders.access', 'one_time_orders.read'].includes(rule.actionCode);
    if (rule.scope === 'all') {
      exclusions.push({ entityType: { in: types } });
      if (rule.actionCode === 'one_time_orders.specification.read') exclusions.push({ entityType: 'one_time_order', type: 'one_time_order.specification_updated' });
      if (denyDomainChildren) {
        const model = action.module === 'objects' ? prisma.object : prisma.oneTimeOrder;
        exclusions.push(...await descendantExclusions(prisma, action.module, await childIds(model, {})));
      }
      continue;
    }
    const own = rule.scope === 'own';
    const assigned = rule.scope === 'assigned';
    const selectedIds = [...rule.selectedIds];
    const addIds = (entityType: string, ids: string[]): void => {
      if (ids.length) exclusions.push({ entityType, entityId: { in: ids } });
    };
    if (action.module === 'inventory') {
      addIds('inventory_movement', await childIds(prisma.inventoryMovement, { inventoryItemId: { in: selectedIds } }));
      continue;
    }
    if (action.module === 'equipment') {
      addIds('equipment_unit', selectedIds);
      addIds('equipment_movement', await childIds(prisma.equipmentMovement, { equipmentUnitId: { in: selectedIds } }));
      continue;
    }
    if (action.module === 'accountability') {
      const users = own ? [userId] : selectedIds;
      const accountWhere = { accountabilityAccount: { userId: { in: users } } };
      addIds('accountability_expense', await childIds(prisma.accountabilityExpense, accountWhere));
      addIds('accountability_funding', await childIds(prisma.accountabilityFunding, accountWhere));
      addIds('accountability_closure', await childIds(prisma.accountabilityClosure, accountWhere));
      continue;
    }
    if (action.module === 'visit_plans') {
      addIds('manager_visit_plan', await childIds(prisma.managerVisitPlan, { managerUserId: { in: own || assigned ? [userId] : selectedIds } }));
      continue;
    }
    if (action.module === 'user_absences') {
      const users = own || assigned ? [userId] : selectedIds;
      const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "user_absences" WHERE "userId" = ANY(${users}::text[])`;
      addIds('user_absence', rows.map(row => row.id));
      continue;
    }
    if (action.module === 'chat') {
      const rooms = own ? await childIds(prisma.chatRoom, { createdByUserId: userId })
        : assigned ? await childIds(prisma.chatRoom, { participants: { some: { userId, leftAt: null } } }) : selectedIds;
      if (types.includes('chat_room')) addIds('chat_room', rooms);
      addIds('chat_message', await childIds(prisma.chatMessage, { chatRoomId: { in: rooms } }));
      continue;
    }
    if (action.module === 'mats' || action.module === 'user_substitutions') {
      const objects = own ? await childIds(prisma.object, { createdByUserId: userId })
        : assigned ? await childIds(prisma.object, { assignments: { some: { userId, isActive: true } } }) : selectedIds;
      if (action.module === 'mats') {
        addIds('rubber_mat', await childIds(prisma.rubberMat, { objectId: { in: objects } }));
        addIds('object_rubber_mat_quantity', await childIds(prisma.objectRubberMatQuantity, { objectId: { in: objects } }));
      } else addIds('user_substitution', await childIds(prisma.userSubstitution, { objects: { some: { objectId: { in: objects } } } }));
      continue;
    }
    let ids: string[] | null = null;
    if (action.module === 'objects') ids = (await prisma.object.findMany({ where: own ? { createdByUserId: userId } : assigned ? { assignments: { some: { userId, isActive: true } } } : { id: { in: selectedIds } }, select: { id: true } })).map(item => item.id);
    if (action.module === 'one_time_orders') ids = (await prisma.oneTimeOrder.findMany({ where: own ? { createdByUserId: userId } : assigned ? { assignments: { some: { userId, isActive: true } } } : { id: { in: selectedIds } }, select: { id: true } })).map(item => item.id);
    if (action.module === 'tasks') ids = (await prisma.task.findMany({ where: own ? { createdByUserId: userId } : assigned ? { assignees: { some: { userId, isActive: true } } } : { id: { in: selectedIds } }, select: { id: true } })).map(item => item.id);
    if (action.module === 'candidates') ids = (await prisma.candidate.findMany({ where: own ? { createdByUserId: userId } : assigned ? { assignments: { some: { managerUserId: userId, endedAt: null } } } : { id: { in: selectedIds } }, select: { id: true } })).map(item => item.id);
    if (action.module === 'approvals') ids = (await prisma.approvalRequest.findMany({ where: own ? { createdByUserId: userId } : assigned ? { id: { in: [] } } : { id: { in: selectedIds } }, select: { id: true } })).map(item => item.id);
    if (['employees', 'counterparties'].includes(action.module) && rule.scope === 'selected') ids = selectedIds;
    const primary = entityTypes[action.module]![0]!;
    if (ids !== null) {
      if (denyDomainChildren) exclusions.push(...await descendantExclusions(prisma, action.module, ids));
      if (ids.length && types.includes(primary)) exclusions.push({ entityType: primary, entityId: { in: ids } });
      if (ids.length && rule.actionCode === 'one_time_orders.specification.read') {
        exclusions.push({ entityType: 'one_time_order', entityId: { in: ids }, type: 'one_time_order.specification_updated' });
      }
      const children: Array<[string, unknown, Record<string, unknown>]> = [];
      if (action.module === 'objects') children.push(
        ['object_arrival_photo', prisma.objectArrivalPhoto, { objectId: { in: ids } }],
        ['object_daily_report', prisma.objectDailyReport, { objectId: { in: ids } }],
        ['object_comment', prisma.objectComment, { objectId: { in: ids } }],
      );
      if (action.module === 'one_time_orders') children.push(
        ['one_time_order_daily_report', prisma.oneTimeOrderDailyReport, { oneTimeOrderId: { in: ids } }],
        ['one_time_order_comment', prisma.oneTimeOrderComment, { oneTimeOrderId: { in: ids } }],
        ['one_time_order_photo', prisma.oneTimeOrderPhoto, { oneTimeOrderId: { in: ids } }],
        ['one_time_order_specification_item', prisma.oneTimeOrderSpecificationItem, { oneTimeOrderId: { in: ids } }],
      );
      if (action.module === 'tasks') children.push(['task_assignee_completion', prisma.taskAssigneeCompletion, { taskAssignee: { taskId: { in: ids } } }]);
      for (const [entityType, model, childWhere] of children) {
        if (!types.includes(entityType)) continue;
        const entityIds = await childIds(model, childWhere);
        if (entityIds.length) exclusions.push({ entityType, entityId: { in: entityIds } });
      }
    } else exclusions.push({ entityType: { in: types } });
  }
  // Approval events use the endpoint's exact approval/source policy through
  // notificationSourceVisibilityWhere below. Converting unrelated module leaf
  // exclusions into source-wide approval exclusions would hide readable cards.
  return { AND: [where, await notificationSourceVisibilityWhere(prisma, subject, options.includeDismissed), ...exclusions.map(exclusion => ({ NOT: exclusion }))] };
}
