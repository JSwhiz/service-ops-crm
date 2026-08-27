import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EmployeeAssignmentHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async openObjectAssignmentHistory(params: {
    employeeId: string;
    objectId: string;
    startedAt: Date;
    actorUserId: string;
    tx?: Prisma.TransactionClient;
  }): Promise<string> {
    const client = params.tx ?? this.prisma;
    const existing = await client.employeeObjectAssignmentHistory.findFirst({
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
      return existing.id;
    }

    const created = await client.employeeObjectAssignmentHistory.create({
      data: {
        employeeId: params.employeeId,
        objectId: params.objectId,
        startedAt: params.startedAt,
        createdByUserId: params.actorUserId,
      },
    });

    return created.id;
  }

  async closeObjectAssignmentHistory(params: {
    employeeId: string;
    objectId: string;
    endedAt: Date;
    actorUserId: string;
    tx?: Prisma.TransactionClient;
  }): Promise<string | null> {
    const client = params.tx ?? this.prisma;
    const existing = await client.employeeObjectAssignmentHistory.findFirst({
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
      return null;
    }

    await client.employeeObjectAssignmentHistory.update({
      where: {
        id: existing.id,
      },
      data: {
        endedAt: params.endedAt,
        closedByUserId: params.actorUserId,
      },
    });

    return existing.id;
  }
}
