import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

export interface ObjectAttendanceSubmissionView {
  submittedAt: string;
  submittedBy: {
    id: string;
    login: string;
    fullName: string;
  };
}

function getMoscowDayRange(now = new Date()): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  // Europe/Moscow is fixed at UTC+03:00. Midnight in Moscow is 21:00 UTC on the previous day.
  const start = new Date(Date.UTC(year, month - 1, day, -3, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

@Injectable()
export class ObjectAttendanceSubmissionService {
  constructor(private readonly prisma: PrismaService) {}

  async getTodaySubmission(
    objectId: string,
  ): Promise<ObjectAttendanceSubmissionView | null> {
    const dayRange = getMoscowDayRange();
    const item = await this.prisma.objectAuditLog.findFirst({
      where: {
        objectId,
        actionCode: 'attendance.submitted',
        createdAt: {
          gte: dayRange.start,
          lt: dayRange.end,
        },
      },
      include: {
        actor: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!item) return null;

    return {
      submittedAt: item.createdAt.toISOString(),
      submittedBy: {
        id: item.actor.id,
        login: item.actor.login,
        fullName: item.actor.fullName,
      },
    };
  }

  async markSubmitted(params: {
    objectId: string;
    actorUserId: string;
    operationDate: string;
    employeeCount: number;
  }): Promise<void> {
    await this.prisma.objectAuditLog.create({
      data: {
        objectId: params.objectId,
        actorUserId: params.actorUserId,
        actionCode: 'attendance.submitted',
        payload: {
          operationDate: params.operationDate,
          employeeCount: params.employeeCount,
        },
      },
    });
  }
}
