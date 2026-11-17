import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../modules/prisma/prisma.service';
import type { AccessContext, AccessSubject } from '../../modules/users-access/types/access-policy.type';
import { decideAccess } from '../../modules/users-access/utils/access-policy.util';
import { resolveRoomMembership } from '../../modules/chats/utils/chat-membership.util';

/** Notification sources are room IDs, not message IDs. Leaving an explicit
 * room must revoke stored notifications as well as future realtime messages. */
export async function notificationChatRoomSources(prisma: PrismaService, subject: AccessSubject, ids: string[]): Promise<Prisma.NotificationWhereInput[]> {
  if (!ids.length) return [];
  const rooms = await prisma.chatRoom.findMany({ where: { id: { in: ids } }, select: {
    id: true, createdByUserId: true, deletedAt: true, visibilityType: true,
    participants: { where: { leftAt: null }, select: { userId: true, joinedAt: true } },
  } });
  const readable: string[] = [];
  const messagesReadable: Prisma.NotificationWhereInput[] = [];
  for (const room of rooms) {
    const members = room.participants.map(member => member.userId);
    const eligibility = await resolveRoomMembership(prisma, subject, room);
    const context: AccessContext = {
      resourceType: 'chat_room', resourceId: room.id, ownerUserId: room.createdByUserId ?? undefined,
      assignedUserIds: members,
      invariantAllowed: subject.isActive !== false && !room.deletedAt && eligibility.allowed,
      parents: room.visibilityType === 'objects_scope' ? [{ actionCode: 'objects.access', context: {} }]
        : room.visibilityType === 'one_time_orders_scope' ? [{ actionCode: 'one_time_orders.access', context: {} }] : [],
    };
    if (!decideAccess(subject, 'chat.read', eligibility.allowed, context)) continue;
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
