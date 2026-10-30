import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ChatsService } from "../chats/chats.service";
import { ObjectsService } from "./objects.service";
import {
  ContactVersionDto,
  SaveObjectContactDto,
  SaveObjectPlanningDto,
} from "./dto/object-planning.dto";
import {
  LEADERSHIP_OBJECT_ROLE_CODES,
  canOverrideFrozenObject,
} from "./utils/object-access.util";
import {
  annualSeason,
  baseCompensation,
  moscowDateKey,
  moscowMonthWindow,
  seasonalCompensation,
  validAnnualDate,
} from "./utils/object-season.util";

interface PlanningActor {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
}

@Injectable()
export class ObjectPlanningService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ObjectPlanningService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly objects: ObjectsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly chats: ChatsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.runMaintenance().catch((error: unknown) =>
        this.logger.error(
          "Object planning maintenance failed",
          error instanceof Error ? error.stack : undefined,
        ),
      );
    }, 15000);
    this.timer.unref();
    void this.runMaintenance().catch((error: unknown) =>
      this.logger.error(
        "Object planning startup failed",
        error instanceof Error ? error.stack : undefined,
      ),
    );
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private roles(user: PlanningActor) {
    return user.roleCodes?.length ? user.roleCodes : [user.roleCode];
  }
  private canEditBudget(user: PlanningActor) {
    return (
      this.roles(user).some((role) => ["founder", "director"].includes(role)) ||
      !!user.permissionCodes?.includes("object.budget_edit")
    );
  }
  private async context(user: PlanningActor, objectId: string, write = false) {
    const object = await this.objects.getObjectById(user, objectId);
    if (
      write &&
      (object.status === "archived" ||
        (object.status === "frozen" &&
          !canOverrideFrozenObject(this.roles(user))))
    )
      throw new ForbiddenException("Объект недоступен для изменения");
    return object;
  }
  async listContacts(user: PlanningActor, objectId: string) {
    await this.context(user, objectId);
    return this.prisma.objectContact.findMany({
      where: { objectId },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
  }
  async saveContact(
    user: PlanningActor,
    objectId: string,
    id: string | null,
    payload: SaveObjectContactDto,
  ) {
    const object = await this.context(user, objectId, true);
    if (!object.capabilities.canEdit)
      throw new ForbiddenException("Редактирование контактов недоступно");
    const data = {
      name: payload.name.trim(),
      ...(payload.position !== undefined
        ? { position: payload.position?.trim() || null }
        : {}),
      ...(payload.phones !== undefined
        ? {
            phones: (payload.phones ?? []).map((v) => v.trim()).filter(Boolean),
          }
        : {}),
      ...(payload.emails !== undefined ? { emails: payload.emails ?? [] } : {}),
      ...(payload.links !== undefined ? { links: payload.links ?? [] } : {}),
      ...(payload.notes !== undefined
        ? { notes: payload.notes?.trim() || null }
        : {}),
    };
    return this.prisma.$transaction(async (tx) => {
      if (id) {
        const updated = await tx.objectContact.updateMany({
          where: { id, objectId, version: payload.expectedVersion },
          data: { ...data, version: { increment: 1 } },
        });
        if (!payload.expectedVersion || updated.count !== 1)
          throw new ConflictException(
            "Контакт изменён. Обновите данные перед сохранением.",
          );
      }
      const saved = id
        ? await tx.objectContact.findUniqueOrThrow({ where: { id } })
        : await tx.objectContact.create({ data: { ...data, objectId } });
      await tx.objectAuditLog.create({
        data: {
          objectId,
          actorUserId: user.id,
          actionCode: id ? "object.contact.updated" : "object.contact.created",
          payload: { name: saved.name, contactId: saved.id },
        },
      });
      await this.audit.writeAuditEvent(
        {
          entityType: "object",
          entityId: objectId,
          actorUserId: user.id,
          action: id ? "object.contact.updated" : "object.contact.created",
          newValues: { contactId: saved.id, ...data },
        },
        tx,
      );
      return saved;
    });
  }
  async deleteContact(
    user: PlanningActor,
    objectId: string,
    id: string,
    payload: ContactVersionDto,
  ) {
    const object = await this.context(user, objectId, true);
    if (!object.capabilities.canEdit)
      throw new ForbiddenException("Редактирование контактов недоступно");
    return this.prisma.$transaction(async (tx) => {
      const contact = await tx.objectContact.findFirst({
        where: { id, objectId },
      });
      if (!contact) throw new NotFoundException("Контакт не найден");
      const deleted = await tx.objectContact.deleteMany({
        where: { id, objectId, version: payload.expectedVersion },
      });
      if (!deleted.count)
        throw new ConflictException("Контакт изменён. Обновите данные.");
      await tx.objectAuditLog.create({
        data: {
          objectId,
          actorUserId: user.id,
          actionCode: "object.contact.deleted",
          payload: { name: contact.name, contactId: contact.id },
        },
      });
      await this.audit.writeAuditEvent(
        {
          entityType: "object",
          entityId: objectId,
          actorUserId: user.id,
          action: "object.contact.deleted",
          oldValues: {
            name: contact.name,
            phones: contact.phones,
            emails: contact.emails,
            links: contact.links,
          },
        },
        tx,
      );
      return { success: true };
    });
  }
  async getPlanning(user: PlanningActor, objectId: string) {
    const object = await this.context(user, objectId);
    const settings = await this.prisma.objectPlanningSettings.findUnique({
      where: { objectId },
    });
    const { month } = moscowMonthWindow();
    const actual = object.capabilities.canViewOperationalSections
      ? await this.actualAmount(this.prisma, objectId)
      : null;
    return {
      version: settings?.version ?? 0,
      month,
      monthlyBudget:
        object.capabilities.canViewOperationalSections &&
        settings?.monthlyBudget !== null &&
        settings?.monthlyBudget !== undefined
          ? Number(settings.monthlyBudget)
          : null,
      actualAmount: actual === null ? null : Number(actual),
      excessAmount:
        actual !== null &&
        settings?.monthlyBudget !== null &&
        settings?.monthlyBudget !== undefined
          ? Math.max(0, Number(actual.minus(settings.monthlyBudget)))
          : null,
      automaticSeasons: settings?.automaticSeasons ?? false,
      summerStartsOn: settings?.summerStartsOn ?? null,
      winterStartsOn: settings?.winterStartsOn ?? null,
      activeSeason:
        settings?.automaticSeasons &&
        settings.summerStartsOn &&
        settings.winterStartsOn
          ? annualSeason(settings.summerStartsOn, settings.winterStartsOn)
          : object.seasonMode,
      capabilities: {
        canEditBudget: this.canEditBudget(user),
        canEditSeasons: object.capabilities.canManageCompensationRates,
        canViewBudget: object.capabilities.canViewOperationalSections,
      },
    };
  }
  async savePlanning(
    user: PlanningActor,
    objectId: string,
    payload: SaveObjectPlanningDto,
  ) {
    if (
      payload.monthlyBudget === undefined &&
      payload.automaticSeasons === undefined &&
      payload.summerStartsOn === undefined &&
      payload.winterStartsOn === undefined
    )
      throw new BadRequestException("Выберите настройки для изменения");
    const object = await this.context(user, objectId, true);
    if (payload.monthlyBudget !== undefined && !this.canEditBudget(user))
      throw new ForbiddenException("Изменение бюджета недоступно");
    if (
      (payload.automaticSeasons !== undefined ||
        payload.summerStartsOn !== undefined ||
        payload.winterStartsOn !== undefined) &&
      !object.capabilities.canManageCompensationRates
    )
      throw new ForbiddenException("Изменение сезонов недоступно");
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "objects" WHERE "id" = ${objectId} FOR UPDATE`;
      const old = await tx.objectPlanningSettings.findUnique({
        where: { objectId },
      });
      if ((old?.version ?? 0) !== payload.expectedVersion)
        throw new ConflictException("Настройки изменены. Обновите данные.");
      const data = {
        monthlyBudget:
          payload.monthlyBudget === null
            ? null
            : payload.monthlyBudget === undefined
              ? old?.monthlyBudget
              : new Prisma.Decimal(payload.monthlyBudget),
        automaticSeasons:
          payload.automaticSeasons ?? old?.automaticSeasons ?? false,
        summerStartsOn: payload.summerStartsOn ?? old?.summerStartsOn,
        winterStartsOn: payload.winterStartsOn ?? old?.winterStartsOn,
      };
      if (
        data.automaticSeasons &&
        (!data.summerStartsOn || !data.winterStartsOn)
      )
        throw new BadRequestException("Укажите даты начала лета и зимы");
      if (
        (data.summerStartsOn && !validAnnualDate(data.summerStartsOn)) ||
        (data.winterStartsOn && !validAnnualDate(data.winterStartsOn)) ||
        (data.summerStartsOn && data.summerStartsOn === data.winterStartsOn)
      )
        throw new BadRequestException(
          "Укажите разные даты начала сезонов; 29 февраля не поддерживается",
        );
      await tx.objectPlanningSettings.upsert({
        where: { objectId },
        create: { objectId, ...data },
        update: { ...data, version: { increment: 1 } },
      });
      await tx.objectAuditLog.create({
        data: {
          objectId,
          actorUserId: user.id,
          actionCode: "object.planning.updated",
          payload: {
            automaticSeasons: data.automaticSeasons,
            summerStartsOn: data.summerStartsOn ?? null,
            winterStartsOn: data.winterStartsOn ?? null,
          },
        },
      });
      await this.audit.writeAuditEvent(
        {
          entityType: "object",
          entityId: objectId,
          actorUserId: user.id,
          action: "object.planning.updated",
          oldValues: old
            ? (JSON.parse(JSON.stringify(old)) as Prisma.InputJsonValue)
            : null,
          newValues: JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue,
        },
        tx,
      );
    });
    await this.applySeason(objectId, new Date(), payload.automaticSeasons === false);
    await this.evaluateBudget(objectId);
    // The alert is persisted before delivery. A transport failure must not turn
    // an already saved configuration into an apparent failed save.
    await this.deliverBudgetAlerts().catch((error: unknown) =>
      this.logger.error(
        "Budget alert delivery deferred to maintenance",
        error instanceof Error ? error.stack : undefined,
      ),
    );
    return this.getPlanning(user, objectId);
  }
  private async actualAmount(
    database: Pick<Prisma.TransactionClient, "inventoryMovement">,
    objectId: string,
    now = new Date(),
  ) {
    const { start, end } = moscowMonthWindow(now);
    const rows = await database.inventoryMovement.groupBy({
      by: ["movementType"],
      where: {
        status: "applied",
        movementType: {
          in: ["issue_to_object", "issue_to_one_time_order", "return"],
        },
        createdAt: { gte: start, lt: end },
        AND: [
          {
            OR: [
              { requiresApprovalBridge: false },
              { approvalBridgeResolvedAt: { not: null } },
            ],
          },
          {
            OR: [
              { relatedObjectId: objectId },
              {
                relatedObjectId: null,
                relatedOneTimeOrder: { linkedObjectId: objectId },
              },
            ],
          },
        ],
      },
      _sum: { totalAmountSnapshot: true },
    });
    return rows.reduce(
      (sum, row) =>
        row.movementType === "return"
          ? sum.minus(row._sum?.totalAmountSnapshot ?? 0)
          : sum.plus(row._sum?.totalAmountSnapshot ?? 0),
      new Prisma.Decimal(0),
    );
  }
  async evaluateBudget(
    objectId: string,
    now = new Date(),
    transaction?: Prisma.TransactionClient,
  ) {
    const { month } = moscowMonthWindow(now);
    const evaluate = async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT "id" FROM "objects" WHERE "id" = ${objectId} FOR UPDATE`;
      const settings = await tx.objectPlanningSettings.findUnique({
        where: { objectId },
      });
      if (
        settings?.monthlyBudget === null ||
        settings?.monthlyBudget === undefined
      )
        return;
      const actual = await this.actualAmount(tx, objectId, now);
      const excess = Prisma.Decimal.max(
        0,
        actual.minus(settings.monthlyBudget),
      );
      const old = await tx.objectBudgetPeriod.findUnique({
        where: { objectId_month: { objectId, month } },
      });
      if (
        old &&
        old.actualAmount.equals(actual) &&
        old.excessAmount.equals(excess)
      )
        return;
      const revision = (old?.revision ?? 0) + 1;
      await tx.objectBudgetPeriod.upsert({
        where: { objectId_month: { objectId, month } },
        create: {
          objectId,
          month,
          actualAmount: actual,
          excessAmount: excess,
          revision,
        },
        update: { actualAmount: actual, excessAmount: excess, revision },
      });
      if (!excess.gt(old?.excessAmount ?? 0)) return;
      const object = await tx.object.findUniqueOrThrow({
        where: { id: objectId },
        select: { name: true },
      });
      const alert = await tx.objectBudgetAlert.create({
        data: {
          objectId,
          month,
          revision,
          planAmount: settings.monthlyBudget,
          actualAmount: actual,
          excessAmount: excess,
        },
      });
      const recipients = await this.notifications.listActiveUserIdsByRoles(
        [...LEADERSHIP_OBJECT_ROLE_CODES],
        tx,
      );
      for (const recipientUserId of recipients)
        await this.notifications.create(
          {
            recipientUserId,
            type: "object.budget_exceeded",
            title: `Превышен бюджет расходников: ${object.name}`,
            body: this.budgetText(
              object.name,
              month,
              settings.monthlyBudget,
              actual,
              excess,
            ),
            entityType: "object",
            entityId: objectId,
            targetUrl: `/objects/${objectId}#planning`,
            dedupeKey: `object-budget:${alert.id}`,
          },
          tx,
        );
    };
    if (transaction) await evaluate(transaction);
    else await this.prisma.$transaction(evaluate);
  }
  private budgetText(
    name: string,
    month: string,
    plan: Prisma.Decimal,
    actual: Prisma.Decimal,
    excess: Prisma.Decimal,
  ) {
    return `${name} · ${month}. План: ${plan.toFixed(2)} ₽; расход: ${actual.toFixed(2)} ₽; превышение: ${excess.toFixed(2)} ₽.`;
  }
  async deliverBudgetAlerts() {
    const alerts = await this.prisma.objectBudgetAlert.findMany({
      where: { chatDeliveredAt: null },
      include: { object: { select: { name: true } } },
      take: 100,
      orderBy: { createdAt: "asc" },
    });
    for (const alert of alerts) {
      await this.chats.createSystemMessage(
        "leadership",
        this.budgetText(
          alert.object.name,
          alert.month,
          alert.planAmount,
          alert.actualAmount,
          alert.excessAmount,
        ),
        {
          objectId: alert.objectId,
          targetUrl: `/objects/${alert.objectId}#planning`,
          budgetAlertId: alert.id,
        },
        null,
        `object-budget:${alert.id}`,
      );
      await this.prisma.objectBudgetAlert.update({
        where: { id: alert.id },
        data: { chatDeliveredAt: new Date() },
      });
    }
  }
  async applySeason(objectId: string, now = new Date(), restoreDefault = false) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "objects" WHERE "id" = ${objectId} FOR UPDATE`;
      const settings = await tx.objectPlanningSettings.findUnique({
        where: { objectId },
      });
      if (
        !restoreDefault && (!settings?.automaticSeasons ||
        !settings.summerStartsOn ||
        !settings.winterStartsOn)
      )
        return;
      const object = await tx.object.findUnique({ where: { id: objectId } });
      if (!object || object.deletedAt || (!restoreDefault && object.status !== "active")) return;
      const season = !settings?.automaticSeasons ? null : annualSeason(
        settings!.summerStartsOn!,
        settings!.winterStartsOn!,
        now,
      );
      if (object.seasonMode === season) return;
      const profile = seasonalCompensation(object, season);
      await tx.object.update({
        where: { id: objectId },
        data: {
          seasonMode: season,
          ...profile,
          ...(!object.baseCompensationProfile
            ? {
                baseCompensationProfile: {
                  ...baseCompensation(object),
                  paymentScheduleCycleStartDate:
                    baseCompensation(object)
                      .paymentScheduleCycleStartDate?.toISOString()
                      .slice(0, 10) ?? null,
                },
              }
            : {}),
        },
      });
      await this.audit.writeAuditEvent(
        {
          entityType: "object",
          entityId: objectId,
          action: "object.season.activated",
          oldValues: { seasonMode: object.seasonMode },
          newValues: {
            seasonMode: season,
            effectiveOn: moscowDateKey(now),
            ...profile,
            paymentScheduleCycleStartDate:
              profile.paymentScheduleCycleStartDate?.toISOString() ?? null,
          },
        },
        tx,
      );
    });
  }
  async runMaintenance() {
    if (this.running) return;
    this.running = true;
    try {
      const settings = await this.prisma.objectPlanningSettings.findMany({
        where: { object: { deletedAt: null } },
        select: { objectId: true },
      });
      for (const row of settings) {
        await this.applySeason(row.objectId);
        await this.evaluateBudget(row.objectId);
      }
      await this.deliverBudgetAlerts();
    } finally {
      this.running = false;
    }
  }
}
