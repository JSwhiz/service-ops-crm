import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../modules/prisma/prisma.service';
import type { AccessSubject } from '../../modules/users-access/types/access-policy.type';
import { buildObjectAccessPolicyWhere, hasHrObjectView, hasWideObjectAccess } from '../../modules/objects/utils/object-access.util';
import { buildOneTimeOrderAccessWhere, canAccessOneTimeOrders } from '../../modules/one-time-orders/utils/one-time-order-access.util';
import { buildTaskAccessWhere } from '../../modules/tasks/utils/task-access.util';
import { taskVisibilityWhere } from '../../modules/tasks/utils/task-policy.util';
import { buildCandidateAccessWhere } from '../../modules/candidates/utils/candidate-access.util';
import { employeePolicyWhere } from '../../modules/employees/utils/employee-policy.util';
import { visitPlanReadUserWhere } from '../../modules/visit-plans/visit-plan-access.util';
import { delegatedObjectIds, objectDelegationContext } from '../../modules/user-substitutions/object-delegation.context';
import { resolveObjectDelegationGrants } from '../../modules/user-substitutions/resolve-object-delegation-grants.util';
import { notificationChatRoomSources } from './notification-chat-visibility';
import { approvalReadVisibilityWhere } from '../../modules/approvals/utils/approval-read-access.util';
import { inventoryMovementVisibilityWhere } from './inventory-movement-visibility';

const sourceTypes = [
  'object', 'object_daily_report', 'object_arrival_photo', 'object_comment',
  'one_time_order', 'one_time_order_daily_report', 'one_time_order_comment',
  'one_time_order_photo', 'one_time_order_specification_item',
  'task', 'task_assignee_completion', 'candidate', 'employee', 'manager_visit_plan', 'inventory_movement',
] as const;
const coveredSourceTypes = [...sourceTypes, 'chat_room', 'approval_request'];

async function visibleIds(model: unknown, ids: string[], where: unknown): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await (model as { findMany(args: unknown): Promise<Array<{ id: string }>> }).findMany({
    where: { AND: [{ id: { in: ids } }, where] }, select: { id: true },
  });
  return new Set(rows.map(row => row.id));
}

/** Restrict only references actually held by this recipient, not entire domain
 * tables. No notification title/body is loaded. The resulting predicate is used
 * by list/count/delivery before pagination. A fresh substitution snapshot also
 * makes background workers independent from the HTTP actor's ambient context. */
export async function notificationSourceVisibilityWhere(prisma: PrismaService, subject: AccessSubject, includeDismissed = false): Promise<Prisma.NotificationWhereInput> {
  const refs = await prisma.notification.findMany({
    where: { recipientUserId: subject.id, ...(!includeDismissed ? { dismissedAt: null } : {}), entityType: { in: coveredSourceTypes }, entityId: { not: null } },
    distinct: ['entityType', 'entityId'], select: { entityType: true, entityId: true },
  });
  // Only genuinely source-less notices bypass domain membership. An unknown,
  // unsupported or incomplete non-null source cannot be authorized by absence
  // from the registry; keep its stored record but fail closed for every channel.
  const uncovered: Prisma.NotificationWhereInput[] = [{ entityType: null, entityId: null }];
  if (!refs.length) return { OR: uncovered };
  const grants = await resolveObjectDelegationGrants(prisma, subject.id);
  return objectDelegationContext.run({ actorUserId: subject.id, grants, used: new Map() }, async () => {
    const roles = [...(subject.roleCodes ?? (subject.roleCode ? [subject.roleCode] : []))];
    const permissions = [...(subject.permissionCodes ?? [])];
    const objectWhere = (actionCode = 'objects.read'): Prisma.ObjectWhereInput => {
      const legacy: Prisma.ObjectWhereInput = hasWideObjectAccess(roles) ? {} : { OR: [
        { createdByUserId: subject.id }, { assignments: { some: { userId: subject.id, isActive: true } } },
        { id: { in: delegatedObjectIds(subject.id, 'view', actionCode) } },
      ] };
      const ordinary: Prisma.ObjectWhereInput = { AND: [buildObjectAccessPolicyWhere(subject, legacy), buildObjectAccessPolicyWhere(subject, legacy, actionCode)] };
      if (actionCode === 'objects.read') {
        const profile = buildObjectAccessPolicyWhere(subject, hasHrObjectView(permissions) ? {} : { id: { in: [] } }, 'objects.view_hr');
        return { OR: [ordinary, { AND: [profile, buildObjectAccessPolicyWhere(subject, {}, 'objects.read')] }] };
      }
      if (actionCode !== 'objects.reports.read') return ordinary;
      // HR's report-only extension is an independent real source. Its own deny
      // removes only this branch; actor ownership/assignment remains intact.
      const hrExtension = buildObjectAccessPolicyWhere(subject,
        permissions.includes('objects.hr_reports_view') ? {} : { id: { in: [] } }, 'objects.hr_reports_view');
      return { OR: [ordinary, { AND: [hrExtension,
        buildObjectAccessPolicyWhere(subject, {}, 'objects.read'),
        buildObjectAccessPolicyWhere(subject, {}, 'objects.reports.read'),
      ] }] };
    };
    const orderWhere = (actionCode = 'one_time_orders.read'): Prisma.OneTimeOrderWhereInput => {
      const params = { subject, currentUserId: subject.id, roleCodes: roles, permissionCodes: permissions,
        ...(!canAccessOneTimeOrders(roles, permissions) ? { legacyWhere: { id: { in: [] } } } : {}) };
      return { AND: [buildOneTimeOrderAccessWhere(params), buildOneTimeOrderAccessWhere({ ...params, actionCode })] };
    };
    const taskWhere = taskVisibilityWhere(subject, buildTaskAccessWhere({ currentUserId: subject.id, roleCodes: roles }));
    const adapters: Record<string, [unknown, unknown]> = {
      object: [prisma.object, objectWhere()],
      object_daily_report: [prisma.objectDailyReport, { object: objectWhere('objects.reports.read') }],
      object_arrival_photo: [prisma.objectArrivalPhoto, { object: objectWhere('objects.arrival.read') }],
      object_comment: [prisma.objectComment, { object: objectWhere('objects.comments.read') }],
      one_time_order: [prisma.oneTimeOrder, orderWhere()],
      one_time_order_daily_report: [prisma.oneTimeOrderDailyReport, { oneTimeOrder: orderWhere('one_time_orders.reports.read') }],
      one_time_order_comment: [prisma.oneTimeOrderComment, { oneTimeOrder: orderWhere('one_time_orders.comments.read') }],
      one_time_order_photo: [prisma.oneTimeOrderPhoto, { oneTimeOrder: orderWhere('one_time_orders.photos.read') }],
      one_time_order_specification_item: [prisma.oneTimeOrderSpecificationItem, { oneTimeOrder: orderWhere('one_time_orders.specification.read') }],
      task: [prisma.task, taskWhere],
      task_assignee_completion: [prisma.taskAssigneeCompletion, { taskAssignee: { task: taskWhere } }],
      candidate: [prisma.candidate, buildCandidateAccessWhere(subject)],
      employee: [prisma.employee, employeePolicyWhere(subject)],
      manager_visit_plan: [prisma.managerVisitPlan, { manager: visitPlanReadUserWhere(subject) }],
      inventory_movement: [prisma.inventoryMovement, inventoryMovementVisibilityWhere(subject, 'inventory.movements.read', {
        // Non-global recipients may read movements only through an actually
        // visible work source; the shared predicate checks that source too.
        OR: [{ relatedObject: objectWhere('objects.inventory.read') },
          { relatedOneTimeOrder: orderWhere('one_time_orders.inventory.read') }],
      })],
    };
    const allowedSources = await Promise.all(sourceTypes.map(async entityType => {
      const ids = [...new Set(refs.filter(ref => ref.entityType === entityType).flatMap(ref => ref.entityId ? [ref.entityId] : []))];
      const [model, where] = adapters[entityType]!;
      const allowed = await visibleIds(model, ids, where);
      return { entityType, entityId: { in: [...allowed] } };
    }));
    // Positive membership closes the race where a new, unchecked source is
    // inserted after refs were read but before list/count/delivery executes.
    const roomIds = refs.filter(ref => ref.entityType === 'chat_room').flatMap(ref => ref.entityId ? [ref.entityId] : []);
    const rooms = await notificationChatRoomSources(prisma, subject, roomIds);
    const approvalIds = refs.filter(ref => ref.entityType === 'approval_request').flatMap(ref => ref.entityId ? [ref.entityId] : []);
    const approvals = approvalIds.length ? await visibleIds(prisma.approvalRequest, approvalIds,
      await approvalReadVisibilityWhere(prisma, subject, approvalIds)) : new Set<string>();
    return { OR: [...uncovered, ...allowedSources.filter(source => source.entityId.in.length), ...rooms,
      ...(approvals.size ? [{ entityType: 'approval_request', entityId: { in: [...approvals] } }] : []),
    ] };
  });
}
