import type { Prisma } from '@prisma/client';
import type { AccessSubject } from '../../users-access/types/access-policy.type';
import { hasOperationalChatRole, isChatLeadership, isObjectsChatDenied } from './chat-access.util';

export type MembershipOverride = 'include' | 'exclude' | null;
export type MembershipState = { membershipOverride?: string | null; leftAt: Date | null };
export type MembershipRoom = { id: string; visibilityType: string };
type MembershipDatabase = Pick<Prisma.TransactionClient, 'chatRoomParticipant' | 'objectAssignment' | 'oneTimeOrderAssignment'>;

/** A personal grant cannot undo a durable room exclusion. Domain ACL is checked separately. */
export function effectiveRoomMembership(automatic: boolean, explicit: boolean, participant: MembershipState | null): boolean {
  if (participant?.membershipOverride === 'exclude') return false;
  if (participant?.membershipOverride === 'include') return participant.leftAt === null;
  if (participant?.membershipOverride) return false;
  return explicit ? !!participant && participant.leftAt === null : automatic;
}

export async function automaticRoomMembership(database: MembershipDatabase, subject: AccessSubject, room: MembershipRoom): Promise<boolean> {
  const roles = [...(subject.roleCodes ?? (subject.roleCode ? [subject.roleCode] : []))];
  switch (room.visibilityType) {
    case 'leadership_only': return isChatLeadership(roles);
    case 'objects_scope': return !isObjectsChatDenied(roles) && (hasOperationalChatRole(roles) || await database.objectAssignment.count({ where: { userId: subject.id, isActive: true } }) > 0);
    case 'one_time_orders_scope': return hasOperationalChatRole(roles) || await database.oneTimeOrderAssignment.count({ where: { userId: subject.id, isActive: true, assignmentRoleCode: 'one_time_manager' } }) > 0;
    default: return false;
  }
}

export async function resolveRoomMembership(database: MembershipDatabase, subject: AccessSubject, room: MembershipRoom) {
  const participant = await database.chatRoomParticipant.findUnique({ where: { chatRoomId_userId: { chatRoomId: room.id, userId: subject.id } } });
  const automatic = await automaticRoomMembership(database, subject, room);
  return { participant, automatic, allowed: effectiveRoomMembership(automatic, room.visibilityType === 'explicit_members', participant) };
}

export function applyMembershipOverrides(automaticIds: string[], rows: Array<{ userId: string; membershipOverride?: string | null; leftAt: Date | null }>): string[] {
  const ids = new Set(automaticIds);
  for (const row of rows) {
    if (row.membershipOverride === 'exclude') ids.delete(row.userId);
    else if (row.membershipOverride === 'include' && row.leftAt === null) ids.add(row.userId);
  }
  return [...ids];
}
