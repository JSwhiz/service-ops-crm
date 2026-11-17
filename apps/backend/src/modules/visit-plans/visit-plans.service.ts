import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { loadAccessSubject } from '../../common/access/notification-access';
import { projectCommittedWrite } from '../../common/access/project-committed-write';
import { lockActorAccessRevision } from '../../common/access/lock-actor-access-revision';
import type { AccessSubject } from '../users-access/types/access-policy.type';
import { buildAccessWhere, decideAccess, hasModuleDeny } from '../users-access/utils/access-policy.util';

import { AuditService } from "../audit/audit.service";
import {
  canViewObjectByScope,
  hasWideObjectAccess,
} from "../objects/utils/object-access.util";
import { delegatedObjectIds } from "../user-substitutions/object-delegation.context";
import { PrismaService } from "../prisma/prisma.service";
import { visitPlanReadUserWhere } from './visit-plan-access.util';
import {
  CreateVisitPlanDto,
  RecordVisitDto,
  SaveVisitPlanEntryDto,
  SaveVisitPlanReportDto,
  SaveVisitPlanDeadlineDto,
  VisitPlanObjectOptionsQueryDto,
  VisitPlanCapabilitiesDto,
} from "./dto/visit-plan.dto";

export interface VisitPlanUser extends AccessSubject {
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

  private visibleObjectWhere(user: VisitPlanUser): Prisma.ObjectWhereInput {
    return buildAccessWhere<Prisma.ObjectWhereInput>({ subject: user, actionCode: 'objects.read', legacyWhere: {}, invariantWhere: {},
      scopeWhere: rule => rule.scope === 'all' ? {} : rule.scope === 'selected' ? { id: { in: [...rule.selectedIds] } } : rule.scope === 'own' ? { createdByUserId: user.id } : { assignments: { some: { userId: user.id, isActive: true } } },
    }) as Prisma.ObjectWhereInput;
  }
  private planInclude(user: VisitPlanUser) {
    return { ...include, entries: { ...include.entries, where: { OR: [{ objectId: null }, { object: this.visibleObjectWhere(user) }] } } };
  }

  canManage(user: VisitPlanUser, managerUserId?: string): boolean {
    // Personal grants only. Leadership, ownership and assignment never bypass this.
    return decideAccess(user, 'visit_plans.manage', user.permissionCodes?.includes(VISIT_PLANS_MANAGE) === true, this.planContext(managerUserId));
  }

  private planContext(managerUserId?: string) {
    return { resourceType: 'user', resourceId: managerUserId, ownerUserId: managerUserId };
  }

  private planActionAllowed(user: VisitPlanUser, managerUserId?: string, actionCode = 'visit_plans.manage'): boolean {
    const legacy = user.permissionCodes?.includes(VISIT_PLANS_MANAGE) === true;
    const context = this.planContext(managerUserId);
    const bundle = this.canManage(user, managerUserId);
    const scopedEntry = !managerUserId && !hasModuleDeny(user, actionCode) && !hasModuleDeny(user, 'visit_plans.manage') && user.accessRules?.some(rule => [actionCode, 'visit_plans.manage'].includes(rule.actionCode) && rule.effect === 'allow');
    return !hasModuleDeny(user, 'visit_plans.manage', context) &&
      (scopedEntry === true || decideAccess(user, actionCode, legacy || bundle, context));
  }

  private assertManage(user: VisitPlanUser, managerUserId?: string, actionCode = 'visit_plans.manage'): void {
    if (!this.planActionAllowed(user, managerUserId, actionCode))
      throw new ForbiddenException("Visit plan management denied");
  }

  private planCapabilities(user: VisitPlanUser, managerUserId: string): VisitPlanCapabilitiesDto {
    return {
      canManage: this.canManage(user, managerUserId),
      canManageVisits: this.planActionAllowed(user, managerUserId, 'visit_plans.visits.manage'),
      canManageReports: this.planActionAllowed(user, managerUserId, 'visit_plans.reports.manage'),
    };
  }

  private async assertRead(
    user: VisitPlanUser,
    managerUserId: string,
    database: Pick<Prisma.TransactionClient, 'user'> = this.prisma,
  ): Promise<void> {
    const target = await database.user.findFirst({
      where: { AND: [{ id: managerUserId }, visitPlanReadUserWhere(user)] },
      select: { id: true },
    });
    if (!target) {
      throw new ForbiddenException("Visit plan access denied");
    }
  }

  async listManagers(user: VisitPlanUser) {
    return this.prisma.user.findMany({
      where: {
        // Discovery grants no write authority. Match the day-read scope while
        // retaining the existing active manager directory eligibility below.
        AND: [visitPlanReadUserWhere(user)],
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

  async listObjectOptions(
    user: VisitPlanUser,
    query: VisitPlanObjectOptionsQueryDto,
  ) {
    this.assertManage(user, query.managerUserId);
    const manager = await this.prisma.user.findFirst({
      where: {
        id: query.managerUserId,
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
      include: { roles: { include: { role: true } } },
    });
    if (!manager) throw new NotFoundException("Plan manager not found");

    const filters: Prisma.ObjectWhereInput[] = [{ deletedAt: null }];
    const managerRoles = manager.roles.map(({ role }) => role.code);
    if (!hasWideObjectAccess(managerRoles)) {
      filters.push({
        OR: [
          { createdByUserId: manager.id },
          { assignments: { some: { userId: manager.id, isActive: true } } },
        ],
      });
    }

    const plannerRoles = user.roleCodes ?? [user.roleCode];
    if (!hasWideObjectAccess(plannerRoles)) {
      filters.push({
        OR: [
          { id: { in: delegatedObjectIds(user.id, 'view', 'objects.read') } },
          { createdByUserId: user.id },
          { assignments: { some: { userId: user.id, isActive: true } } },
        ],
      });
    }

    filters.push(buildAccessWhere<Prisma.ObjectWhereInput>({
      subject: user,
      actionCode: 'objects.read',
      legacyWhere: {},
      invariantWhere: {},
      scopeWhere: rule => rule.scope === 'all' ? {} : rule.scope === 'selected' ? { id: { in: [...rule.selectedIds] } } : rule.scope === 'own' ? { createdByUserId: user.id } : { assignments: { some: { userId: user.id, isActive: true } } },
    }) as Prisma.ObjectWhereInput);

    const search = query.q?.trim();
    if (search) {
      filters.push({
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { internalName: { contains: search, mode: "insensitive" } },
          { address: { contains: search, mode: "insensitive" } },
        ],
      });
    }

    const where: Prisma.ObjectWhereInput = { AND: filters };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.object.count({ where }),
      this.prisma.object.findMany({
        where,
        select: { id: true, name: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return {
      items,
      page: query.page,
      limit: query.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    };
  }

  async getDay(user: VisitPlanUser, date: string, managerUserId = user.id) {
    await this.assertRead(user, managerUserId);
    const plan = await this.prisma.managerVisitPlan.findUnique({
      where: {
        managerUserId_planDate: {
          managerUserId,
          planDate: visitPlanDate(date),
        },
      },
      include: this.planInclude(user),
    });
    return { plan, capabilities: this.planCapabilities(user, managerUserId) };
  }

  async create(user: VisitPlanUser, input: CreateVisitPlanDto) {
    this.assertManage(user, input.managerUserId);
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
      const saved = await this.prisma.$transaction(async (tx) => {
        await lockActorAccessRevision(tx, user);
        const plan = await tx.managerVisitPlan.create({
          data: {
            managerUserId: manager.id,
            planDate,
            createdByUserId: user.id,
            reportDueAt: input.reportDueAt ? new Date(input.reportDueAt) : null,
          },
          include: this.planInclude(user),
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
      return this.mutationResponse(user, saved.id);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException("Manager already has a plan for this date");
      throw error;
    }
  }

  private mutationResponse(user: VisitPlanUser, id: string) {
    return projectCommittedWrite(this.prisma, user, async () => {
      const subject = await loadAccessSubject(this.prisma, user.id);
      if (!subject?.isActive) throw new ForbiddenException('Visit plan access changed');
      const actor: VisitPlanUser = {
        ...subject, roleCode: subject.roleCodes?.[0] ?? '',
        roleCodes: [...(subject.roleCodes ?? [])],
        permissionCodes: [...(subject.permissionCodes ?? [])],
      };
      const plan = await this.prisma.managerVisitPlan.findUniqueOrThrow({
        where: { id }, select: { managerUserId: true },
      });
      await this.assertRead(actor, plan.managerUserId);
      return this.prisma.managerVisitPlan.findUniqueOrThrow({
        where: { id }, include: this.planInclude(actor),
      });
    });
  }

  private async lock(
    user: VisitPlanUser,
    tx: Prisma.TransactionClient,
    id: string,
    version: number,
    actionCode = 'visit_plans.manage',
  ) {
    this.assertManage(user, undefined, actionCode);
    await tx.$queryRaw`SELECT "id" FROM "manager_visit_plans" WHERE "id" = ${id} FOR UPDATE`;
    await lockActorAccessRevision(tx, user);
    const plan = await tx.managerVisitPlan.findUnique({
      where: { id },
      include: this.planInclude(user),
    });
    if (!plan) throw new NotFoundException("Visit plan not found");
    await this.assertRead(user, plan.managerUserId, tx);
    this.assertManage(user, plan.managerUserId, actionCode);
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
    await this.prisma.$transaction(async (tx) => {
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
      return tx.managerVisitPlan.findUniqueOrThrow({ where: { id }, include: this.planInclude(user) });
    });
    return this.mutationResponse(user, id);
  }

  async recordVisit(
    user: VisitPlanUser,
    id: string,
    entryId: string,
    input: RecordVisitDto,
  ) {
    this.assertManage(user, undefined, 'visit_plans.visits.manage');
    await this.prisma.$transaction(async (tx) => {
      const plan = await this.lock(user, tx, id, input.expectedVersion, 'visit_plans.visits.manage');
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
      return tx.managerVisitPlan.findUniqueOrThrow({ where: { id }, include: this.planInclude(user) });
    });
    return this.mutationResponse(user, id);
  }

  async saveReport(
    user: VisitPlanUser,
    id: string,
    input: SaveVisitPlanReportDto,
  ) {
    this.assertManage(user, undefined, 'visit_plans.reports.manage');
    const report = input.report.trim();
    if (input.closeReport && !report)
      throw new BadRequestException("Report is required to close");
    await this.prisma.$transaction(async (tx) => {
      const plan = await this.lock(user, tx, id, input.expectedVersion, 'visit_plans.reports.manage');
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
        include: this.planInclude(user),
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
    return this.mutationResponse(user, id);
  }

  async history(user: VisitPlanUser, id: string) {
    const plan = await this.prisma.managerVisitPlan.findUnique({
      where: { id },
    });
    if (!plan) throw new NotFoundException("Visit plan not found");
    await this.assertRead(user, plan.managerUserId);
    if (!decideAccess(user, 'visit_plans.history', true, this.planContext(plan.managerUserId))) throw new ForbiddenException('Visit plan history denied');
    const [events, entries] = await Promise.all([
      this.audit.listAuditEvents("manager_visit_plan", id),
      this.prisma.managerVisitPlanEntry.findMany({ where: { planId: id }, select: { id: true, objectId: true } }),
    ]);
    const entryObjects = new Map<string, Set<string>>();
    const payloads = (event: typeof events[number]): Prisma.JsonObject[] =>
      [event.oldValues, event.newValues, event.metadata].filter((value): value is Prisma.JsonObject =>
        value !== null && typeof value === 'object' && !Array.isArray(value));
    for (const entry of entries) entryObjects.set(entry.id, new Set(entry.objectId ? [entry.objectId] : []));
    // Deleted entries are resolved from their immutable add/remove payloads.
    for (const event of events) for (const value of payloads(event)) {
      if (typeof value.entryId !== 'string' || (value.objectId !== null && typeof value.objectId !== 'string')) continue;
      const objects = entryObjects.get(value.entryId) ?? new Set<string>();
      if (typeof value.objectId === 'string') objects.add(value.objectId);
      entryObjects.set(value.entryId, objects);
    }
    const referencedObjects = new Set([...entryObjects.values()].flatMap((objects) => [...objects]));
    for (const event of events) for (const value of payloads(event)) if (typeof value.objectId === 'string') referencedObjects.add(value.objectId);
    const visible = new Set((await this.prisma.object.findMany({
      where: { AND: [{ id: { in: [...referencedObjects] } }, this.visibleObjectWhere(user)] }, select: { id: true },
    })).map((object) => object.id));
    return events.filter((event) => payloads(event).every((value) => {
      if (typeof value.objectId === 'string' && !visible.has(value.objectId)) return false;
      if (typeof value.entryId !== 'string') return true;
      const objects = entryObjects.get(value.entryId);
      // A legacy orphan without a resolvable source cannot disclose visit text.
      return !!objects && [...objects].every((objectId) => visible.has(objectId));
    }));
  }

  async saveDeadline(user: VisitPlanUser, id: string, input: SaveVisitPlanDeadlineDto) {
    this.assertManage(user);
    if (input.reportDueAt === undefined) throw new BadRequestException('Explicit deadline or null required');
    await this.prisma.$transaction(async (tx) => {
      const plan = await this.lock(user, tx, id, input.expectedVersion);
      const reportDueAt = input.reportDueAt ? new Date(input.reportDueAt) : null;
      const saved = await tx.managerVisitPlan.update({ where: { id }, data: { reportDueAt, version: { increment: 1 } }, include: this.planInclude(user) });
      await this.audit.writeAuditEvent({ entityType: 'manager_visit_plan', entityId: id, actorUserId: user.id, action: 'visit_plan.deadline_saved', oldValues: { reportDueAt: plan.reportDueAt?.toISOString() ?? null }, newValues: { reportDueAt: reportDueAt?.toISOString() ?? null } }, tx);
      return saved;
    });
    return this.mutationResponse(user, id);
  }

  async removeEntry(user: VisitPlanUser, id: string, entryId: string, expectedVersion: number) {
    this.assertManage(user);
    await this.prisma.$transaction(async (tx) => {
      const plan = await this.lock(user, tx, id, expectedVersion);
      const entry = plan.entries.find((row) => row.id === entryId);
      if (!entry) throw new NotFoundException('Plan entry not found');
      await tx.managerVisitPlanEntry.delete({ where: { id: entryId } });
      await tx.managerVisitPlan.update({ where: { id }, data: { version: { increment: 1 } } });
      await this.audit.writeAuditEvent({ entityType: 'manager_visit_plan', entityId: id, actorUserId: user.id, action: 'visit_plan.entry_removed', oldValues: { entryId, objectId: entry.objectId, objectName: entry.object?.name ?? null, clientName: entry.clientName, isUnplanned: entry.isUnplanned, visitedAt: entry.visitedAt?.toISOString() ?? null, visitReport: entry.visitReport, createdByUserId: entry.createdByUserId } }, tx);
      return tx.managerVisitPlan.findUniqueOrThrow({ where: { id }, include: this.planInclude(user) });
    });
    return this.mutationResponse(user, id);
  }
}
