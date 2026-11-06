import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AccessSubject } from "../users-access/types/access-policy.type";
import {
  buildAccessWhere,
  decideAccess,
} from "../users-access/utils/access-policy.util";
import { hasWideObjectAccess } from "../objects/utils/object-access.util";
import { delegatedObjectIds } from "../user-substitutions/object-delegation.context";
import type { UserAbsencesService } from "../user-absences/user-absences.service";
import type { PrismaService } from "../prisma/prisma.service";
import { buildOneTimeOrderAccessWhere } from "../one-time-orders/utils/one-time-order-access.util";

type DashboardUser = AccessSubject & {
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
};
export async function dashboardAbsenceCount(
  service: UserAbsencesService,
  prisma: PrismaService,
  user: DashboardUser,
  date: string,
) {
  if (!user.accessRules?.length) return service.countTodayForLeadership(date);
  const rows = await dashboardUpcomingAbsences(service, prisma, user, date);
  return new Set(
    rows
      .filter((row) => row.startDate <= date && row.endDate >= date)
      .map((row) => row.userId),
  ).size;
}
export async function dashboardUpcomingAbsences(
  service: UserAbsencesService,
  prisma: PrismaService,
  user: DashboardUser,
  date: string,
) {
  const result = await service.list(user, { from: date });
  const active = await prisma.user.findMany({
    where: {
      id: { in: [...new Set(result.items.map((row) => row.userId))] },
      isActive: true,
      deletedAt: null,
    },
    select: { id: true },
  });
  const ids = new Set(active.map((row) => row.id));
  return result.items
    .filter((row) => ids.has(row.userId))
    .sort(
      (a, b) =>
        Number(a.startDate > date) - Number(b.startDate > date) ||
        a.startDate.localeCompare(b.startDate) ||
        a.user.fullName.localeCompare(b.user.fullName),
    );
}

export function assertDashboardAccess(
  user: AccessSubject,
  variant: string,
  legacyAllowed: boolean,
) {
  if (
    !decideAccess(user, "dashboard.view", true) ||
    !decideAccess(user, `dashboard.${variant}.view`, legacyAllowed)
  )
    throw new ForbiddenException("Dashboard access denied");
}
export async function dashboardSection<T>(
  work: () => Promise<T>,
  empty: T,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ForbiddenException) return empty;
    throw error;
  }
}
export function dashboardObjectWhere(
  user: AccessSubject,
  actionCode = "objects.read",
): Prisma.ObjectWhereInput {
  const roles = [...(user.roleCodes ?? (user.roleCode ? [user.roleCode] : []))];
  const extraRead =
    (actionCode === "objects.read" &&
      user.permissionCodes?.includes("objects.view_hr")) ||
    (actionCode === "objects.reports.read" &&
      user.permissionCodes?.includes("objects.hr_reports_view"));
  const legacyWhere: Prisma.ObjectWhereInput =
    hasWideObjectAccess(roles) || extraRead
      ? {}
      : {
          OR: [
            { createdByUserId: user.id },
            { assignments: { some: { userId: user.id, isActive: true } } },
            {
              id: {
                in: delegatedObjectIds(
                  user.id,
                  actionCode === "objects.read" ? "view" : "operate",
                  actionCode,
                ),
              },
            },
          ],
        };
  return buildAccessWhere<Prisma.ObjectWhereInput>({
    subject: user,
    actionCode,
    legacyWhere,
    invariantWhere: { deletedAt: null },
    parentActionCodes: ["objects.read"],
    scopeWhere: (rule) =>
      rule.scope === "all"
        ? {}
        : rule.scope === "selected"
          ? { id: { in: [...rule.selectedIds] } }
          : rule.scope === "own"
            ? { createdByUserId: user.id }
            : rule.scope === "assigned"
              ? { assignments: { some: { userId: user.id, isActive: true } } }
              : null,
  }) as Prisma.ObjectWhereInput;
}
export async function dashboardObjectIds(
  prisma: PrismaService,
  user: AccessSubject,
  ids: string[],
  actionCode: string,
) {
  const rows = await prisma.object.findMany({
    where: {
      AND: [{ id: { in: ids } }, dashboardObjectWhere(user, actionCode)],
    },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}
export async function dashboardOrderIds(
  prisma: PrismaService,
  user: AccessSubject,
  ids: string[],
  actionCode: string,
) {
  const rows = await prisma.oneTimeOrder.findMany({
    where: {
      AND: [
        { id: { in: ids } },
        buildOneTimeOrderAccessWhere({
          subject: user,
          currentUserId: user.id,
          roleCodes: [
            ...(user.roleCodes ?? (user.roleCode ? [user.roleCode] : [])),
          ],
          permissionCodes: [...(user.permissionCodes ?? [])],
          actionCode,
        }),
      ],
    },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}
export async function dashboardObjectStaffing(
  prisma: PrismaService,
  user: AccessSubject,
  objects: readonly { id: string; employees: readonly { id: string }[] }[],
) {
  const allowed = await dashboardObjectIds(
    prisma,
    user,
    objects.map((object) => object.id),
    "objects.staffing.read",
  );
  const candidates = [
    ...new Set(
      objects
        .filter((object) => allowed.has(object.id))
        .flatMap((object) => object.employees.map((employee) => employee.id)),
    ),
  ];
  const employees = await prisma.employee.findMany({
    where: { AND: [{ id: { in: candidates } }, dashboardEmployeeWhere(user)] },
    select: { id: true },
  });
  const employeeIds = new Set(employees.map((employee) => employee.id));
  const counts = new Map(
    objects.map((object) => [
      object.id,
      allowed.has(object.id)
        ? object.employees.filter((employee) => employeeIds.has(employee.id))
            .length
        : 0,
    ]),
  );
  return { allowed, counts, employeeIds };
}
export function dashboardCandidateWhere(
  user: AccessSubject,
): Prisma.CandidateWhereInput {
  return buildAccessWhere<Prisma.CandidateWhereInput>({
    subject: user,
    actionCode: "candidates.view",
    legacyWhere: {},
    invariantWhere: { deletedAt: null },
    scopeWhere: (rule) =>
      rule.scope === "all"
        ? {}
        : rule.scope === "selected"
          ? { id: { in: [...rule.selectedIds] } }
          : rule.scope === "own"
            ? { createdByUserId: user.id }
            : rule.scope === "assigned"
              ? {
                  assignments: {
                    some: { managerUserId: user.id, endedAt: null },
                  },
                }
              : null,
  }) as Prisma.CandidateWhereInput;
}
export function dashboardEmployeeWhere(
  user: AccessSubject,
): Prisma.EmployeeWhereInput {
  return buildAccessWhere<Prisma.EmployeeWhereInput>({
    subject: user,
    actionCode: "employees.view",
    legacyWhere: {},
    invariantWhere: { deletedAt: null },
    scopeWhere: (rule) =>
      rule.scope === "all"
        ? {}
        : rule.scope === "selected"
          ? { id: { in: [...rule.selectedIds] } }
          : null,
  }) as Prisma.EmployeeWhereInput;
}
