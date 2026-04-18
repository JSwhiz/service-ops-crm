const WIDE_TASK_ACCESS_ROLE_CODES = ['founder', 'director'] as const;

export const OBJECT_TASK_ASSIGNMENT_ROLE_CODES = [
  'responsible',
  'manager',
] as const;

interface TaskScopedObjectView {
  createdByUserId: string;
  assignments: Array<{
    userId: string;
    assignmentRoleCode: string;
  }>;
}

function hasAnyRole(
  roleCodes: string[],
  allowed: readonly string[],
): boolean {
  return roleCodes.some((roleCode) => allowed.includes(roleCode as never));
}

function hasTaskScopedAssignment(
  object: TaskScopedObjectView,
  userId: string,
): boolean {
  return object.assignments.some(
    (assignment) =>
      assignment.userId === userId &&
      OBJECT_TASK_ASSIGNMENT_ROLE_CODES.includes(
        assignment.assignmentRoleCode as never,
      ),
  );
}

export function hasWideTaskAccess(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, WIDE_TASK_ACCESS_ROLE_CODES);
}

export function canCreateTaskOnObject(params: {
  currentUserId: string;
  roleCodes: string[];
  object: TaskScopedObjectView;
}): boolean {
  return (
    hasWideTaskAccess(params.roleCodes) ||
    params.object.createdByUserId === params.currentUserId ||
    hasTaskScopedAssignment(params.object, params.currentUserId)
  );
}

export function canAssignTaskToUserOnObject(params: {
  userId: string;
  roleCodes: string[];
  object: TaskScopedObjectView;
}): boolean {
  return (
    hasWideTaskAccess(params.roleCodes) ||
    hasTaskScopedAssignment(params.object, params.userId)
  );
}
