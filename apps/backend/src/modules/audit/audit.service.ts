import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async writeObjectAuditLog(params: {
    objectId: string;
    actorUserId: string;
    actionCode: string;
    payload?: Prisma.InputJsonValue | null;
  }): Promise<void> {
    await this.prisma.objectAuditLog.create({
      data: {
        objectId: params.objectId,
        actorUserId: params.actorUserId,
        actionCode: params.actionCode,
        ...(params.payload === undefined
          ? {}
          : {
              payload:
                params.payload === null ? Prisma.JsonNull : params.payload,
            }),
      },
    });
  }

  async listObjectAuditLogs(objectId: string) {
    return this.prisma.objectAuditLog.findMany({
      where: { objectId },
      include: {
        actor: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 100,
    });
  }
}
