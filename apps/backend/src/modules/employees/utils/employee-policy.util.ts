import type { Prisma } from '@prisma/client';
import type { AccessSubject } from '../../users-access/types/access-policy.type';
import { buildAccessWhere, decideAccess } from '../../users-access/utils/access-policy.util';
import { canViewEmployeesHr } from './employee-hr-access.util';

export function employeePolicyWhere(subject: AccessSubject): Prisma.EmployeeWhereInput {
  return buildAccessWhere<Prisma.EmployeeWhereInput>({
    subject, actionCode: 'employees.view', invariantWhere: {},
    legacyWhere: canViewEmployeesHr([...(subject.permissionCodes ?? [])]) ? {} : { id: { in: [] } },
    scopeWhere: rule => rule.scope === 'all' ? {} : rule.scope === 'selected' ? { id: { in: [...rule.selectedIds] } } : null,
  }) as Prisma.EmployeeWhereInput;
}

export function employeeAction(subject: AccessSubject, actionCode: string, legacyAllowed: boolean, employeeId?: string): boolean {
  return decideAccess(subject, actionCode, legacyAllowed, {
    resourceType: 'employee', resourceId: employeeId,
    ...(employeeId ? { parentAllowed: decideAccess(subject, 'employees.view', canViewEmployeesHr([...(subject.permissionCodes ?? [])]), { resourceType: 'employee', resourceId: employeeId }) } : {}),
  });
}

/** Preserve HR's existing reference visibility, subtract explicit object denies. */
export function employeeObjectDenyWhere(subject: AccessSubject): Prisma.ObjectWhereInput {
  return buildAccessWhere<Prisma.ObjectWhereInput>({
    subject, actionCode: 'objects.read', legacyWhere: {}, invariantWhere: {},
    scopeWhere: rule => rule.scope === 'all' ? {} : rule.scope === 'selected' ? { id: { in: [...rule.selectedIds] } }
      : rule.scope === 'own' ? { createdByUserId: subject.id } : { assignments: { some: { userId: subject.id, isActive: true } } },
  }) as Prisma.ObjectWhereInput;
}
