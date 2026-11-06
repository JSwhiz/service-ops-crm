import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../modules/prisma/prisma.service';
import type { AccessContext, AccessSubject } from '../../modules/users-access/types/access-policy.type';
import { decideAccess } from '../../modules/users-access/utils/access-policy.util';
import { hasOperationalChatRole, isChatLeadership, isObjectsChatDenied } from '../../modules/chats/utils/chat-access.util';

/** Notification sources are room IDs, not message IDs. Leaving an explicit
 * room must revoke stored notifications as well as future realtime messages. */
export async function notificationChatRoomSources(prisma: PrismaService, subject: AccessSubject, ids: string[]): Promise<Prisma.NotificationWhereInput[]> {
  if (!ids.length) return [];
  const rooms = await prisma.chatRoom.findMany({ where: { id: { in: ids } }, select: {
    id: true, createdByUserId: true, deletedAt: true, visibilityType: true,
    participants: { where: { leftAt: null }, select: { userId: true, joinedAt: true } },
  } });
  const roles = [...(subject.roleCodes ?? (subject.roleCode ? [subject.roleCode] : []))];
  const operational = hasOperationalChatRole(roles);
  const objectAssigned = !operational && rooms.some(room => room.visibilityType === 'objects_scope') && await prisma.objectAssignment.count({ where: { userId: subject.id, isActive: true } }) > 0;
  const orderAssigned = !operational && rooms.some(room => room.visibilityType === 'one_time_orders_scope') && await prisma.oneTimeOrderAssignment.count({ where: { userId: subject.id, isActive: true, assignmentRoleCode: 'one_time_manager' } }) > 0;
  const readable: string[] = [];
  const messagesReadable: Prisma.NotificationWhereInput[] = [];
  for (const room of rooms) {
    const members = room.participants.map(member => member.userId);
    const leadership = room.visibilityType === 'leadership_only';
    const explicit = room.visibilityType === 'explicit_members';
    const context: AccessContext = {
      resourceType: 'chat_room', resourceId: room.id, ownerUserId: room.createdByUserId ?? undefined,
      assignedUserIds: members,
      invariantAllowed: subject.isActive !== false && !room.deletedAt && (!leadership || isChatLeadership(roles)) && (!explicit || members.includes(subject.id)),
      parents: room.visibilityType === 'objects_scope' ? [{ actionCode: 'objects.access', context: {} }]
        : room.visibilityType === 'one_time_orders_scope' ? [{ actionCode: 'one_time_orders.access', context: {} }] : [],
    };
    const legacy = leadership ? isChatLeadership(roles) : explicit ? members.includes(subject.id)
      : room.visibilityType === 'objects_scope' ? !isObjectsChatDenied(roles) && (operational || objectAssigned)
        : room.visibilityType === 'one_time_orders_scope' && (operational || orderAssigned);
    if (!decideAccess(subject, 'chat.read', legacy, context)) continue;
    readable.push(room.id);
    const membership = room.participants.find(member => member.userId === subject.id);
    if (membership && decideAccess(subject, 'chat.messages.read', true, context)) {
      messagesReadable.push({ entityId: room.id, createdAt: { gte: membership.joinedAt } });
    }
  }
  return readable.length ? [{
    entityType: 'chat_room', entityId: { in: readable },
    OR: [{ type: { not: 'chat.message_received' } }, ...(messagesReadable.length ? [{ OR: messagesReadable }] : [])],
  }] : [];
}
