import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { buildObjectCapabilities } from './utils/object-capabilities.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
}

export interface ObjectRegistrySignal {
  objectId: string;
  attendanceSubmitted: boolean;
  dailyReportSubmitted: boolean;
}

function moscowDayRange(now = new Date()): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value ?? 0);
  const month = Number(parts.find((part) => part.type === 'month')?.value ?? 0);
  const day = Number(parts.find((part) => part.type === 'day')?.value ?? 0);
  const start = new Date(Date.UTC(year, month - 1, day, -3, 0, 0));
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

@Injectable()
export class ObjectRegistrySignalsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(currentUser: CurrentAuthUser, requestedIds: string[]): Promise<ObjectRegistrySignal[]> {
    const ids = [...new Set(requestedIds.filter(Boolean))].slice(0, 50);
    if (!ids.length) return [];

    const objects = await this.prisma.object.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: {
        id: true,
        status: true,
        createdByUserId: true,
        assignments: {
          where: { isActive: true },
          select: { userId: true, assignmentRoleCode: true },
        },
      },
    });

    const roleCodes = currentUser.roleCodes?.length ? currentUser.roleCodes : [currentUser.roleCode];
    const permissionCodes = currentUser.permissionCodes ?? [];
    const visibleIds = objects
      .filter((object) => buildObjectCapabilities({
        currentUserId: currentUser.id,
        roleCodes,
        permissionCodes,
        objectStatus: object.status,
        createdByUserId: object.createdByUserId,
        assignments: object.assignments.map((assignment) => ({
          userId: assignment.userId,
          roleCode: assignment.assignmentRoleCode,
        })),
      }).canViewOperationalSections)
      .map((object) => object.id);

    if (!visibleIds.length) return [];

    const { start, end } = moscowDayRange();
    const [reports, attendanceSubmissions] = await Promise.all([
      this.prisma.objectDailyReport.findMany({
        where: { objectId: { in: visibleIds }, reportDate: { gte: start, lt: end } },
        select: { objectId: true },
      }),
      this.prisma.objectAuditLog.findMany({
        where: {
          objectId: { in: visibleIds },
          actionCode: 'attendance.submitted',
          createdAt: { gte: start, lt: end },
        },
        select: { objectId: true },
        distinct: ['objectId'],
      }),
    ]);

    const reportIds = new Set(reports.map((item) => item.objectId));
    const attendanceIds = new Set(attendanceSubmissions.map((item) => item.objectId));

    return visibleIds.map((objectId) => ({
      objectId,
      attendanceSubmitted: attendanceIds.has(objectId),
      dailyReportSubmitted: reportIds.has(objectId),
    }));
  }
}
