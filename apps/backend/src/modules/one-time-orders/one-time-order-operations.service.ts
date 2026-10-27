import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  visitPlanDate,
  VisitPlanUser,
} from "../visit-plans/visit-plans.service";
import {
  SaveOrderDeadlineDto,
  SaveOrderEscortsDto,
  SaveOrderServiceLinesDto,
} from "./dto/order-operations.dto";
import { canViewOneTimeOrderByScope } from "./utils/one-time-order-access.util";
import { buildOneTimeOrderCapabilities } from "./utils/one-time-order-capabilities.util";

export const ORDER_ESCORTS_MANAGE = "one_time_order.escorts.manage";
const escortInclude = {
  escort: { select: { id: true, fullName: true } },
  employees: {
    include: { employee: { select: { id: true, fullName: true } } },
  },
  createdBy: { select: { id: true, fullName: true } },
  updatedBy: { select: { id: true, fullName: true } },
};

@Injectable()
export class OneTimeOrderOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async order(
    user: VisitPlanUser,
    id: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const order = await db.oneTimeOrder.findUnique({
      where: { id },
      include: {
        assignments: true,
        serviceLines: { orderBy: { serviceCode: "asc" } },
      },
    });
    if (!order) throw new NotFoundException("Order not found");
    const params = {
      currentUserId: user.id,
      roleCodes: user.roleCodes ?? [user.roleCode],
      permissionCodes: user.permissionCodes,
      order,
    };
    if (!canViewOneTimeOrderByScope(params))
      throw new ForbiddenException("Order access denied");
    return { order, capabilities: buildOneTimeOrderCapabilities(params) };
  }

  private async lockOrder(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT "id" FROM "one_time_orders" WHERE "id" = ${id} FOR UPDATE`;
  }

  async escorts(user: VisitPlanUser, id: string, date: string) {
    await this.order(user, id);
    const items = await this.prisma.oneTimeOrderEscortList.findMany({
      where: { oneTimeOrderId: id, operationDate: visitPlanDate(date) },
      include: escortInclude,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return {
      items,
      canManageOwn:
        user.permissionCodes?.includes(ORDER_ESCORTS_MANAGE) === true,
      currentUserId: user.id,
    };
  }

  async saveEscorts(
    user: VisitPlanUser,
    id: string,
    input: SaveOrderEscortsDto,
  ) {
    if (!user.permissionCodes?.includes(ORDER_ESCORTS_MANAGE))
      throw new ForbiddenException("Personal escort permission required");
    const operationDate = visitPlanDate(input.operationDate);
    return this.prisma.$transaction(async (tx) => {
      await this.lockOrder(tx, id);
      const { order } = await this.order(user, id, tx);
      if (["completed", "cancelled"].includes(order.status))
        throw new ConflictException("Order is closed");
      const selected = await tx.$queryRaw<Array<{ employeeId: string }>>`
        SELECT "employeeId" FROM "one_time_order_employee_assignments"
        WHERE "oneTimeOrderId" = ${id} AND "workCycle" = ${order.workCycle}
          AND "isActive" = true AND "employeeId" IN (${Prisma.join(input.employeeIds)})
      `;
      if (
        new Set(selected.map((row) => row.employeeId)).size !==
        input.employeeIds.length
      )
        throw new BadRequestException(
          "Employees must belong to the current order workforce",
        );
      const where = {
        oneTimeOrderId_escortUserId_operationDate: {
          oneTimeOrderId: id,
          escortUserId: user.id,
          operationDate,
        },
      };
      const existing = await tx.oneTimeOrderEscortList.findUnique({
        where,
        include: escortInclude,
      });
      if ((existing?.version ?? 0) !== input.expectedVersion)
        throw new ConflictException(
          "Escort list changed; reload before saving",
        );
      const saved = existing
        ? await tx.oneTimeOrderEscortList.update({
            where: { id: existing.id },
            data: {
              version: { increment: 1 },
              updatedByUserId: user.id,
              employees: {
                deleteMany: {},
                create: input.employeeIds.map((employeeId) => ({ employeeId })),
              },
            },
            include: escortInclude,
          })
        : await tx.oneTimeOrderEscortList.create({
            data: {
              oneTimeOrderId: id,
              escortUserId: user.id,
              operationDate,
              createdByUserId: user.id,
              updatedByUserId: user.id,
              employees: {
                create: input.employeeIds.map((employeeId) => ({ employeeId })),
              },
            },
            include: escortInclude,
          });
      await this.audit.writeAuditEvent(
        {
          entityType: "one_time_order",
          entityId: id,
          actorUserId: user.id,
          action: "one_time_order.escorts_saved",
          oldValues: {
            employeeIds: existing?.employees.map((row) => row.employeeId) ?? [],
            version: existing?.version ?? 0,
          },
          newValues: {
            listId: saved.id,
            escortUserId: user.id,
            operationDate: input.operationDate,
            employeeIds: input.employeeIds,
            version: saved.version,
          },
        },
        tx,
      );
      return saved;
    });
  }

  async serviceLines(user: VisitPlanUser, id: string) {
    const { order, capabilities } = await this.order(user, id);
    return {
      lines: order.serviceLines,
      version: order.serviceLinesVersion,
      agreedSum: order.agreedSum,
      allocatedTotal: order.serviceLines.reduce(
        (sum, line) => sum + line.amount,
        0,
      ),
      isReconciled:
        order.serviceLines.length > 0 &&
        order.agreedSum !== null &&
        order.serviceLines.reduce((sum, line) => sum + line.amount, 0) ===
          order.agreedSum,
      canEdit:
        capabilities.canEditFinancialFields &&
        !["completed", "cancelled"].includes(order.status),
    };
  }

  async saveServiceLines(
    user: VisitPlanUser,
    id: string,
    input: SaveOrderServiceLinesDto,
  ) {
    if (
      input.lines.length !== 2 ||
      new Set(input.lines.map((line) => line.serviceCode)).size !== 2
    )
      throw new BadRequestException(
        "Specify cleaning and drycleaning separately",
      );
    await this.prisma.$transaction(async (tx) => {
      await this.lockOrder(tx, id);
      const { order, capabilities } = await this.order(user, id, tx);
      if (!capabilities.canEditFinancialFields)
        throw new ForbiddenException("Financial edit denied");
      if (["completed", "cancelled"].includes(order.status))
        throw new ConflictException("Closed service totals cannot be changed");
      if (order.serviceLinesVersion !== input.expectedVersion)
        throw new ConflictException(
          "Service lines changed; reload before saving",
        );
      const agreedSum = input.agreedSum ?? order.agreedSum;
      if (
        agreedSum === null ||
        input.lines.reduce((sum, line) => sum + line.amount, 0) !==
          agreedSum
      )
        throw new BadRequestException(
          "Explicit service totals must match agreed order total",
        );
      for (const line of input.lines) {
        await tx.oneTimeOrderServiceLine.upsert({
          where: {
            oneTimeOrderId_serviceCode: {
              oneTimeOrderId: id,
              serviceCode: line.serviceCode,
            },
          },
          create: {
            oneTimeOrderId: id,
            ...line,
            createdByUserId: user.id,
            updatedByUserId: user.id,
          },
          update: { amount: line.amount, updatedByUserId: user.id },
        });
      }
      await tx.oneTimeOrder.update({
        where: { id },
        data: { agreedSum, serviceLinesVersion: { increment: 1 } },
      });
      await this.audit.writeAuditEvent(
        {
          entityType: "one_time_order",
          entityId: id,
          actorUserId: user.id,
          action: "one_time_order.service_lines_saved",
          oldValues: {
            total: order.agreedSum,
            lines: order.serviceLines.map(({ serviceCode, amount }) => ({
              serviceCode,
              amount,
            })),
          },
          newValues: {
            lines: input.lines.map(({ serviceCode, amount }) => ({
              serviceCode,
              amount,
            })),
            total: agreedSum,
          },
        },
        tx,
      );
    });
    return this.serviceLines(user, id);
  }

  async getDeadline(user: VisitPlanUser, id: string) {
    const { order, capabilities } = await this.order(user, id);
    return {
      deadlineAt: order.deadlineAt,
      updatedAt: order.updatedAt,
      canEdit:
        capabilities.canEditOperationalFields &&
        !["completed", "cancelled"].includes(order.status),
    };
  }

  async saveDeadline(
    user: VisitPlanUser,
    id: string,
    input: SaveOrderDeadlineDto,
  ) {
    if (input.deadlineAt === undefined)
      throw new BadRequestException("Explicit deadline or null required");
    await this.prisma.$transaction(async (tx) => {
      await this.lockOrder(tx, id);
      const { order, capabilities } = await this.order(user, id, tx);
      if (!capabilities.canEditOperationalFields)
        throw new ForbiddenException("Order edit denied");
      if (["completed", "cancelled"].includes(order.status))
        throw new ConflictException("Order is closed");
      if (
        order.updatedAt.getTime() !==
        new Date(input.expectedUpdatedAt).getTime()
      )
        throw new ConflictException("Order changed; reload before saving");
      const deadlineAt = input.deadlineAt ? new Date(input.deadlineAt) : null;
      await tx.oneTimeOrder.update({ where: { id }, data: { deadlineAt } });
      await this.audit.writeAuditEvent(
        {
          entityType: "one_time_order",
          entityId: id,
          actorUserId: user.id,
          action: "one_time_order.deadline_saved",
          oldValues: { deadlineAt: order.deadlineAt?.toISOString() ?? null },
          newValues: { deadlineAt: deadlineAt?.toISOString() ?? null },
        },
        tx,
      );
    });
    return this.getDeadline(user, id);
  }
}
