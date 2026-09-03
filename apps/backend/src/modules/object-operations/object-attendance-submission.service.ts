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

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfTomorrow(): Date {
  const start = startOfToday();
  const next = new Date(start);
  next.setDate(next.getDate() + 1);
  return next;
}

@Injectable()
export class ObjectAttendanceSubmissionService {
  constructor(private readonly prisma: PrismaService) {}

  async getTodaySubmission(
    objectId: string,
  ): Promise<ObjectAttendanceSubmissionView | null> {
    const item = await this.prisma.objectAuditLog.findFirst({
      where: {
        objectId,
        actionCode: 'attendance.submitted',
        createdAt: {
          gte: startOfToday(),
          lt: startOfTomorrow(),
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
