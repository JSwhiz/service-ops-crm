import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { NotificationsService } from "../notifications/notifications.service";
import { LEADERSHIP_OBJECT_ROLE_CODES } from "../objects/utils/object-access.util";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class OperationalOverdueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OperationalOverdueService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    void this.scheduled();
    this.timer = setInterval(() => void this.scheduled(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async scheduled(): Promise<void> {
    try {
      await this.processOverdue();
    } catch (error) {
      this.logger.error(
        "Operational overdue pass failed",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async processOverdue(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let after = "";
      while (true) {
        const plans = await this.prisma.managerVisitPlan.findMany({
          where: {
            id: { gt: after },
            reportDueAt: { lt: now },
            reportClosedAt: null,
          },
          orderBy: { id: "asc" },
          take: 100,
          select: { id: true },
        });
        for (const { id } of plans) {
          await this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT "id" FROM "manager_visit_plans" WHERE "id" = ${id} FOR UPDATE`;
            const plan = await tx.managerVisitPlan.findUnique({
              where: { id },
              include: {
                manager: {
                  select: { fullName: true, isActive: true, deletedAt: true },
                },
              },
            });
            if (
              !plan?.reportDueAt ||
              plan.reportClosedAt ||
              plan.reportDueAt >= now ||
              !plan.manager.isActive ||
              plan.manager.deletedAt
            )
              return;
            const leaders = await this.notifications.listActiveUserIdsByRoles(
              [...LEADERSHIP_OBJECT_ROLE_CODES],
              tx,
            );
            await this.notifications.createForRecipients(
              {
                recipientUserIds: [plan.managerUserId, ...leaders],
                type: "visit_plan.report_overdue",
                title: `Просрочен дневной отчёт: ${plan.manager.fullName}`,
                entityType: "manager_visit_plan",
                entityId: id,
                targetUrl: `/visit-plans?date=${plan.planDate.toISOString().slice(0, 10)}&managerUserId=${encodeURIComponent(plan.managerUserId)}`,
                dedupeKey: `visit-plan:${id}:report-overdue:${plan.reportDueAt.toISOString()}`,
              },
              tx,
            );
          });
        }
        if (plans.length < 100) break;
        after = plans[plans.length - 1]!.id;
      }
      after = "";
      while (true) {
        const orders = await this.prisma.oneTimeOrder.findMany({
          where: {
            id: { gt: after },
            deadlineAt: { lt: now },
            status: { notIn: ["completed", "cancelled"] },
          },
          orderBy: { id: "asc" },
          take: 100,
          select: { id: true },
        });
        for (const { id } of orders) {
          await this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT "id" FROM "one_time_orders" WHERE "id" = ${id} FOR UPDATE`;
            const order = await tx.oneTimeOrder.findUnique({
              where: { id },
              include: {
                assignments: {
                  where: {
                    isActive: true,
                    assignmentRoleCode: "one_time_manager",
                    user: { isActive: true, deletedAt: null },
                  },
                  include: { user: { select: { fullName: true } } },
                },
              },
            });
            if (
              !order?.deadlineAt ||
              order.deadlineAt >= now ||
              ["completed", "cancelled"].includes(order.status)
            )
              return;
            if (!order.assignments.length) return;
            const leaders = await this.notifications.listActiveUserIdsByRoles(
              [...LEADERSHIP_OBJECT_ROLE_CODES],
              tx,
            );
            await this.notifications.createForRecipients(
              {
                recipientUserIds: [
                  ...order.assignments.map((row) => row.userId),
                  ...leaders,
                ],
                type: "one_time_order.overdue",
                title: `Просрочен заказ: ${order.title}`,
                body: `Менеджеры: ${order.assignments.map((row) => row.user.fullName).join(", ")}`,
                entityType: "one_time_order",
                entityId: id,
                targetUrl: `/one-time-orders/${encodeURIComponent(id)}`,
                dedupeKey: `order:${id}:cycle:${order.workCycle}:overdue:${order.deadlineAt.toISOString()}`,
              },
              tx,
            );
          });
        }
        if (orders.length < 100) break;
        after = orders[orders.length - 1]!.id;
      }
    } finally {
      this.running = false;
    }
  }
}
