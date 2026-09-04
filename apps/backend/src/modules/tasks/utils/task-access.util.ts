import { Prisma } from '@prisma/client';

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
        visibilityMode: 'scope',
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
