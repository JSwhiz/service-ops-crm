import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { buildTaskAccessWhere } from '../tasks/utils/task-access.util';
import {
  createSimpleXlsxWorkbook,
  type XlsxCell,
} from '../timesheets/utils/simple-xlsx.util';

import { ListOneTimeOrderCalendarQueryDto } from './dto/list-one-time-order-calendar-query.dto';
import {
  CalendarAvailabilityDto,
  CalendarOrderDto,
  OneTimeOrderCalendarResponseDto,
} from './dto/one-time-order-calendar-response.dto';
import {
  buildOneTimeOrderAccessWhere,
  canAccessOneTimeOrders,
  canBeOneTimeOrderManager,
  hasOneTimeOrderPermission,
  ONE_TIME_ORDER_CALENDAR_APPROVE_PERMISSION,
  ONE_TIME_ORDER_CALENDAR_MANAGE_PERMISSION,
  ONE_TIME_ORDER_MANAGER_ROLE_CODES,
} from './utils/one-time-order-access.util';
import { formatAvailabilityDate } from './utils/one-time-manager-availability-date.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
}

interface CalendarManager {
  id: string;
  login: string;
  fullName: string;
  isActive: boolean;
  deletedAt: Date | null;
}

@Injectable()
export class OneTimeOrderCalendarService {
  private readonly logger = new Logger(OneTimeOrderCalendarService.name);

  constructor(private readonly prisma: PrismaService) {}

  async exportCalendar(
    currentUser: CurrentAuthUser,
    query: ListOneTimeOrderCalendarQueryDto,
  ): Promise<{ fileName: string; buffer: Buffer }> {
    const calendar = await this.getCalendar(currentUser, query);
    const accessibleOrders = await this.loadAccessibleExportOrders(
      currentUser,
      query,
    );
    const calendarRows: XlsxCell[][] = [
      [{ value: `Календарь разовых заказов · ${query.month}`, styleId: 1 }],
      [],
      [
        { value: 'Менеджер', styleId: 1 },
        ...Array.from({ length: calendar.daysInMonth }, (_unused, index) => ({
          value: index + 1,
          styleId: 1,
        })),
        { value: 'Отработано дней', styleId: 1 },
        { value: 'Заказов', styleId: 1 },
        { value: 'Выполнено', styleId: 1 },
        { value: 'Отменено', styleId: 1 },
      ],
      ...calendar.managers.map((manager) => [
        `${manager.user.fullName} (${manager.user.login})`,
        ...manager.days.map((day) => this.mapCalendarDayToXlsx(day)),
        manager.workedDays,
        manager.orderCount,
        manager.completedOrderCount,
        manager.cancelledOrderCount,
      ]),
      [],
      [{ value: 'Легенда', styleId: 1 }],
      [
        { value: 'Заказ', styleId: 4 },
        { value: 'Несколько заказов', styleId: 7 },
        { value: 'Конфликт', styleId: 8 },
        { value: 'Отменённый заказ', styleId: 9 },
      ],
      [
        { value: 'Выходной', styleId: 3 },
        { value: 'Отпуск', styleId: 6 },
        { value: 'Больничный', styleId: 5 },
      ],
      [
        { value: 'Ожидает подтверждения', styleId: 2 },
        { value: 'Скрытый заказ: Занят', styleId: 4 },
      ],
    ];
    const orderRows: XlsxCell[][] = [
      [
        { value: 'Название', styleId: 1 },
        { value: 'Дата начала', styleId: 1 },
        { value: 'Дата окончания', styleId: 1 },
        { value: 'Длительность', styleId: 1 },
        { value: 'Статус', styleId: 1 },
        { value: 'Адрес', styleId: 1 },
        { value: 'Связанный объект', styleId: 1 },
        { value: 'Менеджеры', styleId: 1 },
        { value: 'Контакт', styleId: 1 },
        { value: 'Телефон', styleId: 1 },
        { value: 'Оценка', styleId: 1 },
        { value: 'Отзыв', styleId: 1 },
        { value: 'Прогресс ТЗ', styleId: 1 },
        { value: 'Доступные задачи', styleId: 1 },
      ],
      ...accessibleOrders.map((order) => [
        order.title,
        formatAvailabilityDate(order.executionStartDate!),
        formatAvailabilityDate(order.executionEndDate!),
        this.getDurationDays(order.executionStartDate!, order.executionEndDate!),
        this.getOrderStatusLabel(order.status),
        order.executionAddress,
        order.linkedObject?.name ?? '',
        order.assignments
          .map((assignment) => assignment.user.fullName)
          .join(', '),
        order.contactName,
        order.contactPhone ?? '',
        order.reviewRating ?? '',
        order.reviewText ?? '',
        `${order.specificationItems.filter((item) => item.isCompleted).length}/${order.specificationItems.length}`,
        order.accessibleTaskCount,
      ]),
    ];

    this.logger.log(
      JSON.stringify({
        event: 'one_time_order.calendar_exported',
        actorUserId: currentUser.id,
        month: query.month,
        managerUserId: query.managerUserId ?? null,
        status: query.status ?? null,
        includeCancelled: query.includeCancelled === true,
        managerCount: calendar.managers.length,
        orderCount: accessibleOrders.length,
      }),
    );

    return {
      fileName: `one-time-orders-calendar-${query.month}.xlsx`,
      buffer: createSimpleXlsxWorkbook([
        {
          name: 'Календарь',
          rows: calendarRows,
          columnWidths: [34, ...Array(calendar.daysInMonth).fill(13), 15, 12, 12, 12],
          freeze: { rows: 3, columns: 1 },
          rowHeights: Object.fromEntries(
            calendar.managers.map((_manager, index) => [index + 4, 42]),
          ),
          pageSetup: {
            orientation: 'landscape',
            fitToWidth: 1,
            fitToHeight: 0,
          },
        },
        {
          name: 'Заказы',
          rows: orderRows,
          columnWidths: [32, 13, 13, 12, 14, 28, 24, 28, 24, 18, 10, 36, 14, 16],
          freeze: { rows: 1, columns: 1 },
          pageSetup: {
            orientation: 'landscape',
            fitToWidth: 1,
            fitToHeight: 0,
          },
        },
      ]),
    };
  }

  async getCalendar(
    currentUser: CurrentAuthUser,
    query: ListOneTimeOrderCalendarQueryDto,
  ): Promise<OneTimeOrderCalendarResponseDto> {
    await this.assertCanViewCalendar(currentUser);
    const { monthStart, monthEnd, daysInMonth } = this.parseMonth(query.month);
    const elevatedPendingAccess = this.hasElevatedCalendarAccess(currentUser);
    const accessWhere = buildOneTimeOrderAccessWhere({
      currentUserId: currentUser.id,
      roleCodes: this.getRoleCodes(currentUser),
      permissionCodes: currentUser.permissionCodes,
    });
    const orderStatusWhere =
      query.includeCancelled || query.status === 'cancelled'
        ? {}
        : { status: { not: 'cancelled' } };

    const [eligibleUsers, orders] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          roles: {
            some: { role: { code: { in: [...ONE_TIME_ORDER_MANAGER_ROLE_CODES] } } },
          },
          ...(query.managerUserId ? { id: query.managerUserId } : {}),
        },
        select: {
          id: true,
          login: true,
          fullName: true,
          isActive: true,
          deletedAt: true,
        },
      }),
      this.prisma.oneTimeOrder.findMany({
        where: {
          executionStartDate: { lte: monthEnd },
          executionEndDate: { gte: monthStart },
          ...orderStatusWhere,
          assignments: {
            some: {
              assignmentRoleCode: 'one_time_manager',
              isActive: true,
              ...(query.managerUserId ? { userId: query.managerUserId } : {}),
            },
          },
        },
        select: {
          id: true,
          title: true,
          status: true,
          executionStartDate: true,
          executionEndDate: true,
          executionAddress: true,
          linkedObject: { select: { id: true, name: true } },
          assignments: {
            where: {
              assignmentRoleCode: 'one_time_manager',
              isActive: true,
              user: { isActive: true, deletedAt: null },
            },
            select: {
              userId: true,
              user: {
                select: {
                  id: true,
                  login: true,
                  fullName: true,
                  isActive: true,
                  deletedAt: true,
                },
              },
            },
          },
        },
        orderBy: [{ executionStartDate: 'asc' }, { id: 'asc' }],
      }),
    ]);

    const accessibleOrderIds = new Set(
      orders.length === 0
        ? []
        : (
            await this.prisma.oneTimeOrder.findMany({
              where: {
                AND: [
                  { id: { in: orders.map((order) => order.id) } },
                  accessWhere,
                ],
              },
              select: { id: true },
            })
          ).map((order) => order.id),
    );

    const managers = new Map<string, CalendarManager>();
    for (const user of eligibleUsers) managers.set(user.id, user);
    for (const order of orders) {
      for (const assignment of order.assignments) {
        if (
          !query.managerUserId ||
          assignment.userId === query.managerUserId
        ) {
          managers.set(assignment.userId, assignment.user);
        }
      }
    }
    const managerIds = [...managers.keys()];
    const availabilityEntries =
      managerIds.length === 0
        ? []
        : await this.prisma.oneTimeManagerAvailability.findMany({
            where: {
              userId: { in: managerIds },
              startDate: { lte: monthEnd },
              endDate: { gte: monthStart },
              OR: [
                { status: 'approved' },
                {
                  status: 'pending',
                  ...(elevatedPendingAccess
                    ? {}
                    : { userId: currentUser.id }),
                },
              ],
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          });
    const dates = Array.from({ length: daysInMonth }, (_, index) =>
      formatAvailabilityDate(
        new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), index + 1)),
      ),
    );
    const ordersByManagerId = new Map<string, typeof orders>();
    const availabilityByManagerId = new Map<
      string,
      typeof availabilityEntries
    >();

    for (const order of orders) {
      for (const assignment of order.assignments) {
        const managerOrders = ordersByManagerId.get(assignment.userId) ?? [];
        managerOrders.push(order);
        ordersByManagerId.set(assignment.userId, managerOrders);
      }
    }
    for (const entry of availabilityEntries) {
      const managerAvailability = availabilityByManagerId.get(entry.userId) ?? [];
      managerAvailability.push(entry);
      availabilityByManagerId.set(entry.userId, managerAvailability);
    }

    return {
      month: query.month,
      daysInMonth,
      managers: [...managers.values()]
        .sort((left, right) => left.fullName.localeCompare(right.fullName, 'ru'))
        .map((manager) => {
          const managerOrders = (ordersByManagerId.get(manager.id) ?? []).filter((order) => {
            if (!accessibleOrderIds.has(order.id)) {
              return order.status !== 'cancelled';
            }
            if (query.status) return order.status === query.status;
            return query.includeCancelled || order.status !== 'cancelled';
          });
          const managerAvailability =
            availabilityByManagerId.get(manager.id) ?? [];
          const ordersByDate = new Map<string, typeof managerOrders>();
          const approvedAvailabilityByDate = new Map<
            string,
            (typeof managerAvailability)[number]
          >();
          const pendingAvailabilityByDate = new Map<
            string,
            typeof managerAvailability
          >();

          for (const order of managerOrders) {
            const startDate = formatAvailabilityDate(order.executionStartDate!);
            const endDate = formatAvailabilityDate(order.executionEndDate!);
            for (const date of dates) {
              if (date < startDate || date > endDate) continue;
              const dayOrders = ordersByDate.get(date) ?? [];
              dayOrders.push(order);
              ordersByDate.set(date, dayOrders);
            }
          }
          for (const entry of managerAvailability) {
            const startDate = formatAvailabilityDate(entry.startDate);
            const endDate = formatAvailabilityDate(entry.endDate);
            for (const date of dates) {
              if (date < startDate || date > endDate) continue;
              if (entry.status === 'approved') {
                if (!approvedAvailabilityByDate.has(date)) {
                  approvedAvailabilityByDate.set(date, entry);
                }
                continue;
              }
              const pendingRequests = pendingAvailabilityByDate.get(date) ?? [];
              pendingRequests.push(entry);
              pendingAvailabilityByDate.set(date, pendingRequests);
            }
          }
          const days = dates.map((date) => {
            const dayOrderRecords = ordersByDate.get(date) ?? [];
            const dayOrders = dayOrderRecords.map((order) =>
                this.mapOrder(order, accessibleOrderIds.has(order.id)),
            );
            const approved = approvedAvailabilityByDate.get(date);
            const pendingRequests = pendingAvailabilityByDate.get(date) ?? [];
            const activeOrderCount = dayOrderRecords.filter(
              (order) =>
                order.status !== 'cancelled',
            ).length;

            return {
              date,
              availability: approved
                ? this.mapAvailability(approved, currentUser)
                : null,
              pendingRequests: pendingRequests.map((entry) =>
                this.mapAvailability(entry, currentUser),
              ),
              orders: dayOrders,
              conflictLevel: this.getConflictLevel(
                activeOrderCount,
                Boolean(approved),
              ),
            };
          });
          const workedDays = days.filter((day) =>
            (ordersByDate.get(day.date) ?? []).some(
              (order) => order.status !== 'cancelled',
            ),
          ).length;

          return {
            user: {
              id: manager.id,
              login: manager.login,
              fullName: manager.fullName,
            },
            isActive: manager.isActive && manager.deletedAt === null,
            workedDays,
            orderCount: managerOrders.length,
            completedOrderCount: managerOrders.filter(
              (order) =>
                accessibleOrderIds.has(order.id) && order.status === 'completed',
            ).length,
            cancelledOrderCount: managerOrders.filter(
              (order) =>
                accessibleOrderIds.has(order.id) && order.status === 'cancelled',
            ).length,
            days,
          };
        }),
    };
  }

  private async loadAccessibleExportOrders(
    currentUser: CurrentAuthUser,
    query: ListOneTimeOrderCalendarQueryDto,
  ) {
    const { monthStart, monthEnd } = this.parseMonth(query.month);
    const accessWhere = buildOneTimeOrderAccessWhere({
      currentUserId: currentUser.id,
      roleCodes: this.getRoleCodes(currentUser),
      permissionCodes: currentUser.permissionCodes,
    });
    const statusWhere = query.status
      ? { status: query.status }
      : query.includeCancelled
        ? {}
        : { status: { not: 'cancelled' } };
    const orders = await this.prisma.oneTimeOrder.findMany({
      where: {
        AND: [
          accessWhere,
          {
            executionStartDate: { lte: monthEnd },
            executionEndDate: { gte: monthStart },
            ...statusWhere,
            ...(query.managerUserId
              ? {
                  assignments: {
                    some: {
                      userId: query.managerUserId,
                      assignmentRoleCode: 'one_time_manager',
                      isActive: true,
                    },
                  },
                }
              : {}),
          },
        ],
      },
      select: {
        id: true,
        title: true,
        executionStartDate: true,
        executionEndDate: true,
        status: true,
        executionAddress: true,
        contactName: true,
        contactPhone: true,
        reviewRating: true,
        reviewText: true,
        linkedObject: { select: { name: true } },
        assignments: {
          where: {
            assignmentRoleCode: 'one_time_manager',
            isActive: true,
            user: { isActive: true, deletedAt: null },
          },
          select: { user: { select: { fullName: true } } },
        },
        specificationItems: {
          where: { deletedAt: null },
          select: { isCompleted: true },
        },
      },
      orderBy: [{ executionStartDate: 'asc' }, { title: 'asc' }],
    });
    const taskCounts = new Map<string, number>();

    if (orders.length > 0) {
      const tasks = await this.prisma.task.findMany({
        where: {
          AND: [
            buildTaskAccessWhere({
              currentUserId: currentUser.id,
              roleCodes: this.getRoleCodes(currentUser),
            }),
            { oneTimeOrderId: { in: orders.map((order) => order.id) } },
          ],
        },
        select: { oneTimeOrderId: true },
      });

      for (const task of tasks) {
        if (task.oneTimeOrderId) {
          taskCounts.set(
            task.oneTimeOrderId,
            (taskCounts.get(task.oneTimeOrderId) ?? 0) + 1,
          );
        }
      }
    }

    return orders.map((order) => ({
      ...order,
      accessibleTaskCount: taskCounts.get(order.id) ?? 0,
    }));
  }

  private mapCalendarDayToXlsx(
    day: OneTimeOrderCalendarResponseDto['managers'][number]['days'][number],
  ): Exclude<XlsxCell, string | number | null> {
    const parts: string[] = [];
    const orderLabels = day.orders.map((order) => {
      if (!order.relatedOrder) return 'Занят';
      return order.relatedOrder.status === 'cancelled'
        ? `${order.relatedOrder.title} (Отменён)`
        : order.relatedOrder.title;
    });

    if (orderLabels.length > 0) {
      parts.push(orderLabels.join('\n'));
    }
    if (day.availability) {
      parts.push(this.getAvailabilityLabel(day.availability.entryType));
    }
    if (day.pendingRequests.length > 0) {
      parts.push(
        `Ожидает: ${day.pendingRequests.map((item) => this.getAvailabilityLabel(item.entryType)).join(', ')}`,
      );
    }

    let styleId: number | undefined;
    if (day.conflictLevel !== 'none') styleId = 8;
    else if (
      day.orders.length > 0 &&
      day.orders.every((order) => order.relatedOrder?.status === 'cancelled')
    ) styleId = 9;
    else if (day.orders.length > 1) styleId = 7;
    else if (day.availability?.entryType === 'sick_leave') styleId = 5;
    else if (day.availability?.entryType === 'vacation') styleId = 6;
    else if (day.availability?.entryType === 'day_off') styleId = 3;
    else if (day.orders.length > 0) styleId = 4;
    else if (day.pendingRequests.length > 0) styleId = 2;
    else if (this.isWeekend(day.date)) styleId = 3;

    return { value: parts.join('\n'), styleId };
  }

  private getAvailabilityLabel(entryType: string): string {
    return (
      {
        day_off: 'Выходной',
        vacation: 'Отпуск',
        sick_leave: 'Больничный',
      }[entryType] ?? entryType
    );
  }

  private getOrderStatusLabel(status: string): string {
    return (
      {
        new: 'Новый',
        planned: 'Запланирован',
        in_progress: 'В работе',
        completed: 'Выполнен',
        cancelled: 'Отменён',
      }[status] ?? status
    );
  }

  private getDurationDays(startDate: Date, endDate: Date): number {
    return (
      Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1
    );
  }

  private isWeekend(date: string): boolean {
    const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    return day === 0 || day === 6;
  }

  private async assertCanViewCalendar(currentUser: CurrentAuthUser): Promise<void> {
    const roleCodes = currentUser.roleCodes ?? [currentUser.roleCode];
    const hasActiveAssignment = await this.prisma.oneTimeOrderAssignment.findFirst({
      where: {
        userId: currentUser.id,
        assignmentRoleCode: 'one_time_manager',
        isActive: true,
      },
      select: { id: true },
    });

    if (
      !canAccessOneTimeOrders(roleCodes, currentUser.permissionCodes) &&
      !canBeOneTimeOrderManager(roleCodes) &&
      !hasActiveAssignment &&
      !this.hasElevatedCalendarAccess(currentUser)
    ) {
      throw new ForbiddenException('One-time order calendar access denied');
    }
  }

  private hasElevatedCalendarAccess(currentUser: CurrentAuthUser): boolean {
    return (
      hasOneTimeOrderPermission(
        currentUser.permissionCodes,
        ONE_TIME_ORDER_CALENDAR_MANAGE_PERMISSION,
      ) ||
      hasOneTimeOrderPermission(
        currentUser.permissionCodes,
        ONE_TIME_ORDER_CALENDAR_APPROVE_PERMISSION,
      )
    );
  }

  private parseMonth(month: string): {
    monthStart: Date;
    monthEnd: Date;
    daysInMonth: number;
  } {
    const [year, monthNumber] = month.split('-').map(Number);
    if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
      throw new BadRequestException('Calendar month is invalid');
    }
    const monthStart = new Date(Date.UTC(year, monthNumber - 1, 1));
    const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const monthEnd = new Date(Date.UTC(year, monthNumber - 1, daysInMonth));
    return { monthStart, monthEnd, daysInMonth };
  }

  private mapOrder(order: {
    id: string;
    title: string;
    status: string;
    executionStartDate: Date | null;
    executionEndDate: Date | null;
    executionAddress: string;
    linkedObject: { id: string; name: string } | null;
    assignments: Array<{
      user: { id: string; login: string; fullName: string };
    }>;
  }, canViewDetails: boolean): CalendarOrderDto {
    if (!canViewDetails) {
      return {
        type: 'existing_order',
        detailsRestricted: true,
        relatedOrder: null,
      };
    }

    return {
      type: 'existing_order',
      detailsRestricted: false,
      relatedOrder: {
        id: order.id,
        title: order.title,
        status: order.status,
        executionStartDate: formatAvailabilityDate(order.executionStartDate!),
        executionEndDate: formatAvailabilityDate(order.executionEndDate!),
        executionAddress: order.executionAddress,
        linkedObject: order.linkedObject,
        managers: order.assignments.map((assignment) => assignment.user),
      },
    };
  }

  private getRoleCodes(currentUser: CurrentAuthUser): string[] {
    return currentUser.roleCodes?.length
      ? currentUser.roleCodes
      : [currentUser.roleCode];
  }

  private mapAvailability(entry: {
    id: string;
    userId: string;
    entryType: string;
    startDate: Date;
    endDate: Date;
    status: string;
    requestComment: string | null;
  }, currentUser: CurrentAuthUser): CalendarAvailabilityDto {
    return {
      id: entry.id,
      entryType: entry.entryType,
      startDate: formatAvailabilityDate(entry.startDate),
      endDate: formatAvailabilityDate(entry.endDate),
      status: entry.status,
      comment: this.canViewAvailabilityComments(currentUser, entry.userId)
        ? entry.requestComment
        : null,
    };
  }

  private canViewAvailabilityComments(
    currentUser: CurrentAuthUser,
    ownerUserId: string,
  ): boolean {
    const roleCodes = this.getRoleCodes(currentUser);

    return (
      currentUser.id === ownerUserId ||
      roleCodes.includes('hr') ||
      hasOneTimeOrderPermission(
        currentUser.permissionCodes,
        ONE_TIME_ORDER_CALENDAR_MANAGE_PERMISSION,
      ) ||
      hasOneTimeOrderPermission(
        currentUser.permissionCodes,
        ONE_TIME_ORDER_CALENDAR_APPROVE_PERMISSION,
      )
    );
  }

  private getConflictLevel(
    activeOrderCount: number,
    hasAvailability: boolean,
  ):
    | 'none'
    | 'multiple_orders'
    | 'approved_availability'
    | 'multiple_orders_and_availability' {
    if (activeOrderCount > 1 && hasAvailability) {
      return 'multiple_orders_and_availability';
    }
    if (activeOrderCount > 1) return 'multiple_orders';
    if (activeOrderCount > 0 && hasAvailability) return 'approved_availability';
    return 'none';
  }
}
