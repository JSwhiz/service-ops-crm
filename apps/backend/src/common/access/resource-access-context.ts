import type { Prisma } from '@prisma/client';
import type { AccessContext } from '../../modules/users-access/types/access-policy.type';

export interface ResourceAccessTarget {
  actionCode: string;
  context: AccessContext;
}

/** Resolve opaque attachment/event IDs to their real domain ancestors. Never
 * derive authorization from a URL, filename, client-supplied owner or role. */
export async function resourceAccessTarget(
  prisma: Prisma.TransactionClient,
  entityType: string,
  entityId: string,
): Promise<ResourceAccessTarget | null> {
  if (entityType === 'object') {
    // Resolve identity even for archived objects. Dropping a known ancestor here
    // would erase its selected/global denials from retained tasks and movements.
    // Endpoint-specific lifecycle/readability checks still belong to callers.
    const row = await prisma.object.findFirst({ where: { id: entityId }, select: {
      id: true, createdByUserId: true, assignments: { where: { isActive: true }, select: { userId: true } },
    } });
    return row ? { actionCode: 'objects.read', context: {
      resourceType: 'object', resourceId: row.id, ownerUserId: row.createdByUserId,
      assignedUserIds: row.assignments.map(item => item.userId),
    } } : null;
  }
  if (entityType === 'one_time_order') {
    const row = await prisma.oneTimeOrder.findUnique({ where: { id: entityId }, select: {
      id: true, createdByUserId: true, assignments: { where: { isActive: true }, select: { userId: true } },
    } });
    return row ? { actionCode: 'one_time_orders.read', context: {
      resourceType: 'one_time_order', resourceId: row.id, ownerUserId: row.createdByUserId,
      assignedUserIds: row.assignments.map(item => item.userId),
    } } : null;
  }
  if (entityType === 'task') {
    const row = await prisma.task.findUnique({ where: { id: entityId }, select: {
      id: true, createdByUserId: true, objectId: true, oneTimeOrderId: true,
      assignees: { where: { isActive: true }, select: { userId: true } }, visibilityUsers: { select: { userId: true } },
    } });
    if (!row) return null;
    const parents = await Promise.all([
      ...(row.objectId ? [resourceAccessTarget(prisma, 'object', row.objectId)] : []),
      ...(row.oneTimeOrderId ? [resourceAccessTarget(prisma, 'one_time_order', row.oneTimeOrderId)] : []),
    ]);
    return { actionCode: 'tasks.read', context: {
      resourceType: 'task', resourceId: row.id, ownerUserId: row.createdByUserId,
      assignedUserIds: [...row.assignees, ...row.visibilityUsers].map(item => item.userId),
      parents: parents.filter((parent): parent is ResourceAccessTarget => parent !== null),
    } };
  }
  if (entityType === 'candidate') {
    const row = await prisma.candidate.findFirst({ where: { id: entityId, deletedAt: null }, select: {
      id: true, createdByUserId: true, assignments: { where: { endedAt: null }, select: { managerUserId: true } },
    } });
    return row ? { actionCode: 'candidates.view', context: {
      resourceType: 'candidate', resourceId: row.id, ownerUserId: row.createdByUserId,
      assignedUserIds: row.assignments.map(item => item.managerUserId),
    } } : null;
  }
  if (entityType === 'chat_room') {
    const row = await prisma.chatRoom.findUnique({ where: { id: entityId }, select: {
      id: true, createdByUserId: true, participants: { where: { leftAt: null }, select: { userId: true } },
    } });
    return row ? { actionCode: 'chat.read', context: {
      resourceType: 'chat_room', resourceId: row.id, ownerUserId: row.createdByUserId ?? undefined,
      assignedUserIds: row.participants.map(item => item.userId),
    } } : null;
  }
  if (entityType === 'chat_message') {
    const row = await prisma.chatMessage.findUnique({ where: { id: entityId }, select: { chatRoomId: true } });
    const parent = row ? await resourceAccessTarget(prisma, 'chat_room', row.chatRoomId) : null;
    return parent ? { actionCode: 'chat.messages.read', context: { ...parent.context, parents: [parent] } } : null;
  }
  const objectChildren = {
    object_arrival_photo: { model: prisma.objectArrivalPhoto, actionCode: 'objects.arrival.read' },
    object_daily_report: { model: prisma.objectDailyReport, actionCode: 'objects.reports.read' },
    object_comment: { model: prisma.objectComment, actionCode: 'objects.comments.read' },
  };
  if (entityType in objectChildren) {
    const child = objectChildren[entityType as keyof typeof objectChildren];
    const row = await (child.model as unknown as { findUnique: (args: unknown) => Promise<{ objectId: string } | null> }).findUnique({ where: { id: entityId }, select: { objectId: true } });
    const target = row ? await resourceAccessTarget(prisma, 'object', row.objectId) : null;
    return target ? { actionCode: child.actionCode, context: { ...target.context, parents: [target] } } : null;
  }
  const orderChildren = {
    one_time_order_comment: { model: prisma.oneTimeOrderComment, actionCode: 'one_time_orders.comments.read' },
    one_time_order_daily_report: { model: prisma.oneTimeOrderDailyReport, actionCode: 'one_time_orders.reports.read' },
    one_time_order_photo: { model: prisma.oneTimeOrderPhoto, actionCode: 'one_time_orders.photos.read' },
    one_time_order_specification_item: { model: prisma.oneTimeOrderSpecificationItem, actionCode: 'one_time_orders.specification.read' },
  };
  if (entityType in orderChildren) {
    const child = orderChildren[entityType as keyof typeof orderChildren];
    const row = await (child.model as unknown as { findUnique: (args: unknown) => Promise<{ oneTimeOrderId: string } | null> }).findUnique({ where: { id: entityId }, select: { oneTimeOrderId: true } });
    const target = row ? await resourceAccessTarget(prisma, 'one_time_order', row.oneTimeOrderId) : null;
    return target ? { actionCode: child.actionCode, context: { ...target.context, parents: [target] } } : null;
  }
  if (entityType === 'task_assignee_completion') {
    const row = await prisma.taskAssigneeCompletion.findUnique({ where: { id: entityId }, select: { taskAssignee: { select: { taskId: true } } } });
    return row ? resourceAccessTarget(prisma, 'task', row.taskAssignee.taskId) : null;
  }
  if (entityType === 'inventory_movement') {
    const row = await prisma.inventoryMovement.findUnique({ where: { id: entityId }, select: {
      inventoryItemId: true, createdByUserId: true, relatedObjectId: true, relatedOneTimeOrderId: true,
    } });
    if (!row) return null;
    const parents = await Promise.all([
      ...(row.relatedObjectId ? [resourceAccessTarget(prisma, 'object', row.relatedObjectId)] : []),
      ...(row.relatedOneTimeOrderId ? [resourceAccessTarget(prisma, 'one_time_order', row.relatedOneTimeOrderId)] : []),
    ]);
    return { actionCode: 'inventory.movements.read', context: {
      resourceType: 'inventory_item', resourceId: row.inventoryItemId, ownerUserId: row.createdByUserId,
      parents: [
        { actionCode: 'inventory.read', context: { resourceType: 'inventory_item', resourceId: row.inventoryItemId } },
        ...parents.filter((parent): parent is ResourceAccessTarget => parent !== null),
      ],
    } };
  }
  if (entityType === 'equipment_movement') {
    const row = await prisma.equipmentMovement.findUnique({ where: { id: entityId }, select: {
      equipmentUnitId: true, createdByUserId: true, fromObjectId: true, toObjectId: true, fromOneTimeOrderId: true, toOneTimeOrderId: true,
    } });
    if (!row) return null;
    const parents = await Promise.all([
      ...[row.fromObjectId, row.toObjectId].filter((id): id is string => !!id).map(id => resourceAccessTarget(prisma, 'object', id)),
      ...[row.fromOneTimeOrderId, row.toOneTimeOrderId].filter((id): id is string => !!id).map(id => resourceAccessTarget(prisma, 'one_time_order', id)),
    ]);
    return { actionCode: 'equipment.history', context: {
      resourceType: 'equipment_unit', resourceId: row.equipmentUnitId, ownerUserId: row.createdByUserId,
      parents: [
        { actionCode: 'equipment.read', context: { resourceType: 'equipment_unit', resourceId: row.equipmentUnitId } },
        ...parents.filter((parent): parent is ResourceAccessTarget => parent !== null),
      ],
    } };
  }
  if (entityType === 'accountability_expense' || entityType === 'accountability_funding') {
    const model = entityType === 'accountability_expense' ? prisma.accountabilityExpense : prisma.accountabilityFunding;
    const row = await (model as unknown as { findUnique: (args: unknown) => Promise<{ oneTimeOrderId: string | null; accountabilityAccount: { userId: string } } | null> }).findUnique({
      where: { id: entityId }, select: { oneTimeOrderId: true, accountabilityAccount: { select: { userId: true } } },
    });
    if (!row) return null;
    const parent = row.oneTimeOrderId ? await resourceAccessTarget(prisma, 'one_time_order', row.oneTimeOrderId) : null;
    return { actionCode: 'accountability.read', context: {
      resourceType: 'user', resourceId: row.accountabilityAccount.userId, ownerUserId: row.accountabilityAccount.userId,
      ...(parent ? { parents: [parent] } : {}),
    } };
  }
  if (entityType === 'approval_request') {
    const row = await prisma.approvalRequest.findUnique({ where: { id: entityId }, select: {
      id: true, createdByUserId: true, sourceEntityType: true, sourceEntityId: true,
    } });
    if (!row) return null;
    // Approval sources are domain records, never another approval request.
    const parent = row.sourceEntityType === 'approval_request' ? null : await resourceAccessTarget(prisma, row.sourceEntityType, row.sourceEntityId);
    return { actionCode: 'approvals.read', context: {
      resourceType: 'approval', resourceId: row.id, ownerUserId: row.createdByUserId,
      ...(parent ? { parents: [parent] } : {}),
    } };
  }
  return null;
}
