import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import {
  canViewObjectByScope,
  LEADERSHIP_OBJECT_ROLE_CODES,
} from "../objects/utils/object-access.util";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateVisitPlanDto,
  RecordVisitDto,
  SaveVisitPlanEntryDto,
  SaveVisitPlanReportDto,
  SaveVisitPlanDeadlineDto,
} from "./dto/visit-plan.dto";

export interface VisitPlanUser {
  id: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
}

export const VISIT_PLANS_MANAGE = "visit_plans.manage";
const include = {
  manager: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
  entries: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    include: {
      object: { select: { id: true, name: true } },
      createdBy: { select: { id: true, fullName: true } },
    },
  },
} satisfies Prisma.ManagerVisitPlanInclude;

export function visitPlanDate(value: string): Date {
  const result = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(result.getTime()) ||
    result.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException("Invalid plan date");
  }
  return result;
}

@Injectable()
export class VisitPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  canManage(user: VisitPlanUser): boolean {
    // Personal grants only. Leadership, ownership and assignment never bypass this.
    return user.permissionCodes?.includes(VISIT_PLANS_MANAGE) === true;
  }

  private assertManage(user: VisitPlanUser): void {
    if (!this.canManage(user))
      throw new ForbiddenException("Visit plan management denied");
  }

  private assertRead(user: VisitPlanUser, managerUserId: string): void {
    const roles = user.roleCodes ?? [user.roleCode];
    if (
      user.id !== managerUserId &&
      !this.canManage(user) &&
      !roles.some((role) =>
        (LEADERSHIP_OBJECT_ROLE_CODES as readonly string[]).includes(role),
      )
    ) {
      throw new ForbiddenException("Visit plan access denied");
    }
  }

  async listManagers(user: VisitPlanUser) {
    this.assertManage(user);
    return this.prisma.user.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        roles: {
          some: {
            role: {
              code: { in: ["manager", "senior_manager", "operation_manager"] },
            },
          },
        },
      },
      select: { id: true, fullName: true },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
    });
  }

  async getDay(user: VisitPlanUser, date: string, managerUserId = user.id) {
    this.assertRead(user, managerUserId);
    const plan = await this.prisma.managerVisitPlan.findUnique({
      where: {
        managerUserId_planDate: {
          managerUserId,
          planDate: visitPlanDate(date),
        },
      },
      include,
    });
    return { plan, capabilities: { canManage: this.canManage(user) } };
  }

  async create(user: VisitPlanUser, input: CreateVisitPlanDto) {
    this.assertManage(user);
    const planDate = visitPlanDate(input.planDate);
    const manager = await this.prisma.user.findFirst({
      where: {
        id: input.managerUserId,
        isActive: true,
        deletedAt: null,
        roles: {
          some: {
            role: {
              code: { in: ["manager", "senior_manager", "operation_manager"] },
            },
          },
        },
      },
    });
    if (!manager) throw new BadRequestException("Active manager required");
    try {
      return await this.prisma.$transaction(async (tx) => {
        const plan = await tx.managerVisitPlan.create({
          data: {
            managerUserId: manager.id,
            planDate,
            createdByUserId: user.id,
            reportDueAt: input.reportDueAt ? new Date(input.reportDueAt) : null,
          },
          include,
        });
        await this.audit.writeAuditEvent(
          {
            entityType: "manager_visit_plan",
            entityId: plan.id,
            actorUserId: user.id,
            action: "visit_plan.created",
            newValues: {
              managerUserId: manager.id,
              planDate: input.planDate,
              reportDueAt: input.reportDueAt ?? null,
            },
          },
          tx,
        );
        return plan;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException("Manager already has a plan for this date");
      throw error;
    }
  }

  private async lock(
    user: VisitPlanUser,
    tx: Prisma.TransactionClient,
    id: string,
    version: number,
  ) {
    this.assertManage(user);
    await tx.$queryRaw`SELECT "id" FROM "manager_visit_plans" WHERE "id" = ${id} FOR UPDATE`;
    const plan = await tx.managerVisitPlan.findUnique({
      where: { id },
      include,
    });
    if (!plan) throw new NotFoundException("Visit plan not found");
    if (plan.version !== version)
      throw new ConflictException("Visit plan changed; reload before saving");
    return plan;
  }

  async addEntry(
    user: VisitPlanUser,
    id: string,
    input: SaveVisitPlanEntryDto,
  ) {
    this.assertManage(user);
    const clientName = input.clientName?.trim() || null;
    if (Boolean(input.objectId) === Boolean(clientName))
      throw new BadRequestException("Choose exactly one object or client");
    return this.prisma.$transaction(async (tx) => {
      const plan = await this.lock(user, tx, id, input.expectedVersion);
      if (input.objectId) {
        const object = await tx.object.findUnique({
          where: { id: input.objectId },
          include: { assignments: { where: { isActive: true } } },
        });
        const manager = await tx.user.findUniqueOrThrow({
          where: { id: plan.managerUserId },
          include: { roles: { include: { role: true } } },
        });
        if (
          !object ||
          !canViewObjectByScope({
            currentUserId: manager.id,
            roleCodes: manager.roles.map(({ role }) => role.code),
            object,
            ownScopeOnly: true,
          })
        )
          throw new ForbiddenException("Object is outside manager scope");
        if (
          !canViewObjectByScope({
            currentUserId: user.id,
            roleCodes: user.roleCodes ?? [user.roleCode],
            object,
          })
        )
          throw new ForbiddenException("Object is outside planner scope");
      }
      const entry = await tx.managerVisitPlanEntry.create({
        data: {
          planId: id,
          objectId: input.objectId ?? null,
          clientName,
          isUnplanned: input.isUnplanned ?? false,
          createdByUserId: user.id,
        },
      });
      await tx.managerVisitPlan.update({
        where: { id },
        data: { version: { increment: 1 } },
      });
      await this.audit.writeAuditEvent(
        {
          entityType: "manager_visit_plan",
          entityId: id,
          actorUserId: user.id,
          action: entry.isUnplanned
            ? "visit_plan.unplanned_added"
            : "visit_plan.entry_added",
          newValues: {
            entryId: entry.id,
            objectId: entry.objectId,
            clientName,
            isUnplanned: entry.isUnplanned,
          },
        },
        tx,
      );
      return tx.managerVisitPlan.findUniqueOrThrow({ where: { id }, include });
    });
  }

  async recordVisit(
    user: VisitPlanUser,
    id: string,
    entryId: string,
    input: RecordVisitDto,
  ) {
    this.assertManage(user);
    return this.prisma.$transaction(async (tx) => {
      const plan = await this.lock(user, tx, id, input.expectedVersion);
      const entry = plan.entries.find((row) => row.id === entryId);
      if (!entry) throw new NotFoundException("Plan entry not found");
      const visitedAt = input.visited ? (entry.visitedAt ?? new Date()) : null;
      const visitReport = input.visitReport?.trim() || null;
      await tx.managerVisitPlanEntry.update({
        where: { id: entryId },
        data: { visitedAt, visitReport },
      });
      await tx.managerVisitPlan.update({
        where: { id },
        data: { version: { increment: 1 } },
      });
      await this.audit.writeAuditEvent(
        {
          entityType: "manager_visit_plan",
          entityId: id,
          actorUserId: user.id,
          action: "visit_plan.visit_recorded",
          oldValues: {
            entryId,
            visitedAt: entry.visitedAt?.toISOString() ?? null,
            visitReport: entry.visitReport,
          },
          newValues: {
            entryId,
            visitedAt: visitedAt?.toISOString() ?? null,
            visitReport,
          },
        },
        tx,
      );
      return tx.managerVisitPlan.findUniqueOrThrow({ where: { id }, include });
    });
  }

  async saveReport(
    user: VisitPlanUser,
    id: string,
    input: SaveVisitPlanReportDto,
  ) {
    this.assertManage(user);
    const report = input.report.trim();
    if (input.closeReport && !report)
      throw new BadRequestException("Report is required to close");
    return this.prisma.$transaction(async (tx) => {
      const plan = await this.lock(user, tx, id, input.expectedVersion);
      const reportClosedAt = input.closeReport
        ? (plan.reportClosedAt ?? new Date())
        : null;
      const saved = await tx.managerVisitPlan.update({
        where: { id },
        data: {
          report: report || null,
          reportClosedAt,
          version: { increment: 1 },
        },
        include,
      });
      await this.audit.writeAuditEvent(
        {
          entityType: "manager_visit_plan",
          entityId: id,
          actorUserId: user.id,
          action: "visit_plan.report_saved",
          oldValues: {
            report: plan.report,
            reportClosedAt: plan.reportClosedAt?.toISOString() ?? null,
          },
          newValues: {
            report: saved.report,
            reportClosedAt: reportClosedAt?.toISOString() ?? null,
          },
        },
        tx,
      );
      return saved;
    });
  }

  async history(user: VisitPlanUser, id: string) {
    const plan = await this.prisma.managerVisitPlan.findUnique({
      where: { id },
    });
    if (!plan) throw new NotFoundException("Visit plan not found");
    this.assertRead(user, plan.managerUserId);
    return this.audit.listAuditEvents("manager_visit_plan", id);
  }

  async saveDeadline(user: VisitPlanUser, id: string, input: SaveVisitPlanDeadlineDto) {
    this.assertManage(user);
    if (input.reportDueAt === undefined) throw new BadRequestException('Explicit deadline or null required');
    return this.prisma.$transaction(async (tx) => {
      const plan = await this.lock(user, tx, id, input.expectedVersion);
      const reportDueAt = input.reportDueAt ? new Date(input.reportDueAt) : null;
      const saved = await tx.managerVisitPlan.update({ where: { id }, data: { reportDueAt, version: { increment: 1 } }, include });
      await this.audit.writeAuditEvent({ entityType: 'manager_visit_plan', entityId: id, actorUserId: user.id, action: 'visit_plan.deadline_saved', oldValues: { reportDueAt: plan.reportDueAt?.toISOString() ?? null }, newValues: { reportDueAt: reportDueAt?.toISOString() ?? null } }, tx);
      return saved;
    });
  }

  async removeEntry(user: VisitPlanUser, id: string, entryId: string, expectedVersion: number) {
    this.assertManage(user);
    return this.prisma.$transaction(async (tx) => {
      const plan = await this.lock(user, tx, id, expectedVersion);
      const entry = plan.entries.find((row) => row.id === entryId);
      if (!entry) throw new NotFoundException('Plan entry not found');
      await tx.managerVisitPlanEntry.delete({ where: { id: entryId } });
      await tx.managerVisitPlan.update({ where: { id }, data: { version: { increment: 1 } } });
      await this.audit.writeAuditEvent({ entityType: 'manager_visit_plan', entityId: id, actorUserId: user.id, action: 'visit_plan.entry_removed', oldValues: { entryId, objectId: entry.objectId, objectName: entry.object?.name ?? null, clientName: entry.clientName, isUnplanned: entry.isUnplanned, visitedAt: entry.visitedAt?.toISOString() ?? null, visitReport: entry.visitReport, createdByUserId: entry.createdByUserId } }, tx);
      return tx.managerVisitPlan.findUniqueOrThrow({ where: { id }, include });
    });
  }
}
