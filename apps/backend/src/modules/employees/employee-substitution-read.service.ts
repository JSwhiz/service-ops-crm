import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getAccessAction } from '../users-access/access-action-catalog';
import { buildAccessWhere, decideAccess, hasModuleDeny, type AccessSubject } from '../users-access/utils/access-policy.util';
import { canViewObjectBasicProfile } from '../objects/utils/object-access.util';
import type { EmployeeSubstitutionReadQuery } from './employee-substitution-read.controller';

export const WORKFORCE_SUBSTITUTION_READ = 'objects.substitutions.read';

@Injectable()
export class EmployeeSubstitutionReadService {
  constructor(private readonly prisma: PrismaService) {}

  private assertEntry(actor: AccessSubject): void {
    const definition = getAccessAction(WORKFORCE_SUBSTITUTION_READ);
    const granted = definition?.manageable && actor.accessRules?.some((rule) =>
      rule.actionCode === WORKFORCE_SUBSTITUTION_READ && rule.effect === 'allow' &&
      definition.allowedScopes.includes(rule.scope) &&
      (rule.scope === 'assigned' || (rule.scope === 'selected' && rule.selectedIds.length > 0)));
    if (!granted || actor.isActive === false || hasModuleDeny(actor, WORKFORCE_SUBSTITUTION_READ) ||
        !decideAccess(actor, 'auth.access', true, { resourceType: 'user', resourceId: actor.id, ownerUserId: actor.id })) {
      throw new ForbiddenException('Просмотр кадровых подмен недоступен');
    }
  }

  private objects(actor: AccessSubject): Prisma.ObjectWhereInput {
    return buildAccessWhere<Prisma.ObjectWhereInput>({
      subject: actor, actionCode: WORKFORCE_SUBSTITUTION_READ,
      legacyWhere: { id: { in: [] } }, invariantWhere: { deletedAt: null },
      parentActionCodes: ['objects.access', 'objects.read'],
      scopeWhere: (rule) => rule.scope === 'all' ? {} : rule.scope === 'selected' ? { id: { in: [...rule.selectedIds] } }
        : rule.scope === 'assigned' ? { assignments: { some: { userId: actor.id, isActive: true } } }
          : rule.scope === 'own' ? { createdByUserId: actor.id } : null,
    }) as Prisma.ObjectWhereInput;
  }

  /** A name in this limited reader does not require permission for a full HR card.
   * Explicit employee/root denies still remove the corresponding source row. */
  private employeeNames(actor: AccessSubject): Prisma.EmployeeWhereInput {
    return buildAccessWhere<Prisma.EmployeeWhereInput>({
      subject: actor, actionCode: 'employees.view', legacyWhere: {}, invariantWhere: {},
      scopeWhere: (rule) => rule.scope === 'all' ? {} : rule.scope === 'selected' ? { id: { in: [...rule.selectedIds] } } : null,
    }) as Prisma.EmployeeWhereInput;
  }

  async list(actor: AccessSubject, query: EmployeeSubstitutionReadQuery) {
    this.assertEntry(actor);
    if (query.from && query.to && query.from > query.to) throw new BadRequestException('Начало периода должно быть не позже окончания');
    const objectWhere = this.objects(actor);
    if (query.objectId && !await this.prisma.object.findFirst({
      where: { AND: [objectWhere, { id: query.objectId }] }, select: { id: true },
    })) throw new ForbiddenException('Подмены выбранного объекта недоступны');
    const q = query.q?.trim();
    const where: Prisma.EmployeeSubstitutionWhereInput = {
      AND: [
        { objectId: { not: null }, object: { is: objectWhere } },
        { employee: { is: this.employeeNames(actor) }, substituteEmployee: { is: this.employeeNames(actor) } },
        ...(query.objectId ? [{ objectId: query.objectId }] : []),
        ...(q ? [{ OR: [
          { employee: { fullName: { contains: q, mode: Prisma.QueryMode.insensitive } } },
          { substituteEmployee: { fullName: { contains: q, mode: Prisma.QueryMode.insensitive } } },
          { object: { name: { contains: q, mode: Prisma.QueryMode.insensitive } } },
        ] }] : []),
        ...(query.from ? [{ OR: [{ endDate: null }, { endDate: { gte: new Date(`${query.from}T00:00:00+03:00`) } }] }] : []),
        ...(query.to ? [{ startDate: { lt: new Date(new Date(`${query.to}T00:00:00+03:00`).getTime() + 86400000) } }] : []),
      ],
    };
    // The exact same scoped predicate feeds both count and list, before pagination.
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.employeeSubstitution.count({ where }),
      this.prisma.employeeSubstitution.findMany({
        where, skip: (query.page - 1) * query.limit, take: query.limit,
        orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
        select: {
          id: true, startDate: true, endDate: true, status: true,
          employee: { select: { fullName: true } }, substituteEmployee: { select: { fullName: true } },
          object: { select: { id: true, name: true, createdByUserId: true,
            assignments: { where: { isActive: true }, select: { userId: true, isActive: true } } } },
        },
      }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return {
      page: query.page, limit: query.limit, total, totalPages: Math.max(1, Math.ceil(total / query.limit)),
      items: rows.map((row) => ({
        id: row.id, employeeName: row.employee.fullName, substituteEmployeeName: row.substituteEmployee.fullName,
        startDate: row.startDate.toISOString(), endDate: row.endDate?.toISOString() ?? null, status: row.status,
        object: { id: row.object!.id, name: row.object!.name,
          canView: canViewObjectBasicProfile({ subject: actor, currentUserId: actor.id,
            roleCodes: [...(actor.roleCodes ?? (actor.roleCode ? [actor.roleCode] : []))],
            permissionCodes: [...(actor.permissionCodes ?? [])], object: row.object! }) },
      })),
    };
  }
}
