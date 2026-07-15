import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

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

    return {
      month: query.month,
      daysInMonth,
      managers: [...managers.values()]
        .sort((left, right) => left.fullName.localeCompare(right.fullName, 'ru'))
        .map((manager) => {
          const managerOrders = orders.filter((order) =>
            order.assignments.some(
              (assignment) => assignment.userId === manager.id,
            ),
          ).filter((order) => {
            if (!accessibleOrderIds.has(order.id)) {
              return order.status !== 'cancelled';
            }
            if (query.status) return order.status === query.status;
            return query.includeCancelled || order.status !== 'cancelled';
          });
          const managerAvailability = availabilityEntries.filter(
            (entry) => entry.userId === manager.id,
          );
          const days = dates.map((date) => {
            const dayOrders = managerOrders
              .filter(
                (order) =>
                  formatAvailabilityDate(order.executionStartDate!) <= date &&
                  formatAvailabilityDate(order.executionEndDate!) >= date,
              )
              .map((order) =>
                this.mapOrder(order, accessibleOrderIds.has(order.id)),
              );
            const approved = managerAvailability.find(
              (entry) =>
                entry.status === 'approved' &&
                formatAvailabilityDate(entry.startDate) <= date &&
                formatAvailabilityDate(entry.endDate) >= date,
            );
            const pending = managerAvailability.find(
              (entry) =>
                entry.status === 'pending' &&
                formatAvailabilityDate(entry.startDate) <= date &&
                formatAvailabilityDate(entry.endDate) >= date,
            );
            const activeOrderCount = managerOrders.filter(
              (order) =>
                order.status !== 'cancelled' &&
                formatAvailabilityDate(order.executionStartDate!) <= date &&
                formatAvailabilityDate(order.executionEndDate!) >= date,
            ).length;

            return {
              date,
              availability: approved ? this.mapAvailability(approved) : null,
              pendingOwnRequest: pending ? this.mapAvailability(pending) : null,
              orders: dayOrders,
              conflictLevel: this.getConflictLevel(
                activeOrderCount,
                Boolean(approved),
              ),
            };
          });
          const workedDays = days.filter((day) => day.orders.length > 0).length;

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
    entryType: string;
    startDate: Date;
    endDate: Date;
    status: string;
    requestComment: string | null;
  }): CalendarAvailabilityDto {
    return {
      id: entry.id,
      entryType: entry.entryType,
      startDate: formatAvailabilityDate(entry.startDate),
      endDate: formatAvailabilityDate(entry.endDate),
      status: entry.status,
      comment: entry.requestComment,
    };
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
