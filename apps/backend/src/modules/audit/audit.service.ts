import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async writeAuditEvent(params: {
    entityType: string;
    entityId: string;
    actorUserId?: string | null;
    action: string;
    oldValues?: Prisma.InputJsonValue | null;
    newValues?: Prisma.InputJsonValue | null;
    metadata?: Prisma.InputJsonValue | null;
  }): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        entityType: params.entityType,
        entityId: params.entityId,
        actorUserId: params.actorUserId ?? null,
        action: params.action,
        ...(params.oldValues === undefined
          ? {}
          : {
              oldValues:
                params.oldValues === null ? Prisma.JsonNull : params.oldValues,
            }),
        ...(params.newValues === undefined
          ? {}
          : {
              newValues:
                params.newValues === null ? Prisma.JsonNull : params.newValues,
            }),
        ...(params.metadata === undefined
          ? {}
          : {
              metadata:
                params.metadata === null ? Prisma.JsonNull : params.metadata,
            }),
      },
    });
  }

  async listAuditEvents(entityType: string, entityId: string) {
    return this.prisma.auditEvent.findMany({
      where: {
        entityType,
        entityId,
      },
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

  async writeObjectAuditLog(params: {
    objectId: string;
    actorUserId: string;
    actionCode: string;
    payload?: Prisma.InputJsonValue | null;
  }): Promise<void> {
    await this.writeAuditEvent({
      entityType: 'object',
      entityId: params.objectId,
      actorUserId: params.actorUserId,
      action: params.actionCode,
      metadata: params.payload ?? null,
    });

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
