import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { CheckOneTimeOrderConflictsDto } from './dto/check-one-time-order-conflicts.dto';
import {
  OneTimeOrderConflictResponseDto,
  OneTimeOrderScheduleConflictDto,
} from './dto/one-time-order-conflict-response.dto';
import {
  canAccessOneTimeOrders,
  canBeOneTimeOrderManager,
  hasOneTimeOrderPermission,
  ONE_TIME_ORDER_CALENDAR_APPROVE_PERMISSION,
  ONE_TIME_ORDER_CALENDAR_MANAGE_PERMISSION,
} from './utils/one-time-order-access.util';
import {
  formatBusinessDate,
  normalizeOneTimeOrderDateRange,
} from './utils/one-time-order-date-range.util';

interface CurrentAuthUser {
  id: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
}

type DatabaseClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class OneTimeOrderConflictService {
  constructor(private readonly prisma: PrismaService) {}

  async checkConflicts(
    currentUser: CurrentAuthUser,
    payload: CheckOneTimeOrderConflictsDto,
    options?: {
      db?: DatabaseClient;
      lockManagerSchedules?: boolean;
    },
  ): Promise<OneTimeOrderConflictResponseDto> {
    await this.assertCanCheck(currentUser);
    const db = options?.db ?? this.prisma;
    const managerUserIds = [...new Set(payload.managerUserIds)].sort();
    const range = normalizeOneTimeOrderDateRange({
      executionStartDate: payload.executionStartDate,
      executionEndDate: payload.executionEndDate,
    });
    const startDate = range.executionStartDate!;
    const endDate = range.executionEndDate!;

    if (options?.lockManagerSchedules) {
      for (const userId of managerUserIds) {
        await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))::text`;
      }
    }

    const users = await db.user.findMany({
      where: {
        id: { in: managerUserIds },
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        login: true,
        fullName: true,
        roles: { select: { role: { select: { code: true } } } },
        oneTimeOrderAssignments: {
          where: {
            assignmentRoleCode: 'one_time_manager',
            isActive: true,
          },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (
      users.length !== managerUserIds.length ||
      users.some(
        (user) =>
          !canBeOneTimeOrderManager(
            user.roles.map((item) => item.role.code),
          ) && user.oneTimeOrderAssignments.length === 0,
      )
    ) {
      throw new ForbiddenException(
        'One or more users cannot be scheduled as one-time order managers',
      );
    }

    const elevatedPendingAccess = this.hasElevatedAccess(currentUser);
    const [orders, availabilityEntries] = await Promise.all([
      db.oneTimeOrder.findMany({
        where: {
          id: payload.excludeOrderId ? { not: payload.excludeOrderId } : undefined,
          status: { not: 'cancelled' },
          executionStartDate: { lte: endDate },
          executionEndDate: { gte: startDate },
          assignments: {
            some: {
              userId: { in: managerUserIds },
              assignmentRoleCode: 'one_time_manager',
              isActive: true,
            },
          },
        },
        select: {
          id: true,
          title: true,
          status: true,
          executionStartDate: true,
          executionEndDate: true,
          assignments: {
            where: {
              userId: { in: managerUserIds },
              assignmentRoleCode: 'one_time_manager',
              isActive: true,
            },
            select: { userId: true },
          },
        },
      }),
      db.oneTimeManagerAvailability.findMany({
        where: {
          userId: { in: managerUserIds },
          startDate: { lte: endDate },
          endDate: { gte: startDate },
          OR: [
            { status: 'approved' },
            {
              status: 'pending',
              ...(elevatedPendingAccess ? {} : { userId: currentUser.id }),
            },
          ],
        },
        select: {
          id: true,
          userId: true,
          entryType: true,
          status: true,
          startDate: true,
          endDate: true,
        },
      }),
    ]);
    const usersById = new Map(
      users.map((user) => [
        user.id,
        { id: user.id, login: user.login, fullName: user.fullName },
      ]),
    );
    const conflicts: OneTimeOrderScheduleConflictDto[] = [];

    for (const order of orders) {
      const overlapDates = this.listOverlapDates(
        startDate,
        endDate,
        order.executionStartDate!,
        order.executionEndDate!,
      );
      for (const assignment of order.assignments) {
        for (const date of overlapDates) {
          conflicts.push({
            date,
            user: usersById.get(assignment.userId)!,
            type: 'existing_order',
            relatedOrder: {
              id: order.id,
              title: order.title,
              status: order.status,
              executionStartDate: formatBusinessDate(order.executionStartDate)!,
              executionEndDate: formatBusinessDate(order.executionEndDate)!,
            },
          });
        }
      }
    }

    for (const entry of availabilityEntries) {
      const type =
        entry.status === 'pending'
          ? 'pending_availability_request'
          : (entry.entryType as 'day_off' | 'vacation' | 'sick_leave');
      for (const date of this.listOverlapDates(
        startDate,
        endDate,
        entry.startDate,
        entry.endDate,
      )) {
        conflicts.push({
          date,
          user: usersById.get(entry.userId)!,
          type,
        });
      }
    }

    conflicts.sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.user.fullName.localeCompare(right.user.fullName, 'ru') ||
        left.type.localeCompare(right.type),
    );

    return {
      hasConflicts: conflicts.some(
        (conflict) => conflict.type !== 'pending_availability_request',
      ),
      conflicts,
    };
  }

  private async assertCanCheck(currentUser: CurrentAuthUser): Promise<void> {
    const roleCodes = currentUser.roleCodes ?? [currentUser.roleCode];
    const hasAssignment = await this.prisma.oneTimeOrderAssignment.findFirst({
      where: {
        userId: currentUser.id,
        assignmentRoleCode: 'one_time_manager',
        isActive: true,
      },
      select: { id: true },
    });
    if (
      !canAccessOneTimeOrders(roleCodes, currentUser.permissionCodes) &&
      !hasAssignment &&
      !this.hasElevatedAccess(currentUser)
    ) {
      throw new ForbiddenException('Schedule conflict check access denied');
    }
  }

  private hasElevatedAccess(currentUser: CurrentAuthUser): boolean {
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

  private listOverlapDates(
    requestedStart: Date,
    requestedEnd: Date,
    relatedStart: Date,
    relatedEnd: Date,
  ): string[] {
    const start = new Date(
      Math.max(requestedStart.getTime(), relatedStart.getTime()),
    );
    const end = new Date(
      Math.min(requestedEnd.getTime(), relatedEnd.getTime()),
    );
    const dates: string[] = [];
    for (
      let cursor = start;
      cursor.getTime() <= end.getTime();
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
    ) {
      dates.push(formatBusinessDate(cursor)!);
    }
    return dates;
  }
}
