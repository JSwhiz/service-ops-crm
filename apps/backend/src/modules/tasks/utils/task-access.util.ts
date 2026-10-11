import { Prisma } from '@prisma/client';
import { delegatedTaskScopes } from '../../user-substitutions/object-delegation.context';

export const TASK_LEADERSHIP_ROLE_CODES = [
  'founder',
  'deputy_founder',
  'director',
  'corporate_director',
] as const;

function hasAnyRole(
  roleCodes: string[],
  allowed: readonly string[],
): boolean {
  return roleCodes.some((roleCode) => allowed.includes(roleCode as never));
}

export function hasWideTaskAccess(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, TASK_LEADERSHIP_ROLE_CODES);
}

export function buildTaskAccessWhere(params: {
  currentUserId: string;
  roleCodes: string[];
}): Prisma.TaskWhereInput {
  if (hasWideTaskAccess(params.roleCodes)) {
    return {};
  }

  return {
    OR: [
      ...delegatedTaskScopes(params.currentUserId).map((grant): Prisma.TaskWhereInput => ({
        objectId: grant.objectId, oneTimeOrderId: null,
        ...(grant.taskWideAccess ? {} : { OR: [
          { visibilityType: 'target_participants' }, { createdByUserId: grant.principalUserId },
          { assignees: { some: { userId: grant.principalUserId, isActive: true } } },
          { visibilityUsers: { some: { userId: grant.principalUserId } } },
        ] }),
      })),
      { createdByUserId: params.currentUserId },
      {
        assignees: {
          some: {
            userId: params.currentUserId,
            isActive: true,
          },
        },
      },
      {
        visibilityUsers: {
          some: {
            userId: params.currentUserId,
          },
        },
      },
      {
        visibilityType: 'all_users',
      },
      {
        visibilityType: 'target_participants',
        object: {
          assignments: {
            some: {
              userId: params.currentUserId,
              isActive: true,
            },
          },
        },
      },
      {
        oneTimeOrder: {
          assignments: {
            some: {
              userId: params.currentUserId,
              assignmentRoleCode: 'one_time_manager',
              isActive: true,
            },
          },
        },
      },
    ],
  };
}
