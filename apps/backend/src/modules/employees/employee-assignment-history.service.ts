import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EmployeeAssignmentHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async openObjectAssignmentHistory(params: {
    employeeId: string;
    objectId: string;
    startedAt: Date;
    actorUserId: string;
  }): Promise<void> {
    const existing = await this.prisma.employeeObjectAssignmentHistory.findFirst({
      where: {
        employeeId: params.employeeId,
        objectId: params.objectId,
        endedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      return;
    }

    await this.prisma.employeeObjectAssignmentHistory.create({
      data: {
        employeeId: params.employeeId,
        objectId: params.objectId,
        startedAt: params.startedAt,
        createdByUserId: params.actorUserId,
      },
    });
  }

  async closeObjectAssignmentHistory(params: {
    employeeId: string;
    objectId: string;
    endedAt: Date;
    actorUserId: string;
  }): Promise<void> {
    const existing = await this.prisma.employeeObjectAssignmentHistory.findFirst({
      where: {
        employeeId: params.employeeId,
        objectId: params.objectId,
        endedAt: null,
      },
      orderBy: {
        startedAt: 'desc',
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      return;
    }

    await this.prisma.employeeObjectAssignmentHistory.update({
      where: {
        id: existing.id,
      },
      data: {
        endedAt: params.endedAt,
        closedByUserId: params.actorUserId,
      },
    });
  }
}
