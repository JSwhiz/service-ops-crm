import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { usedObjectDelegations } from '../user-substitutions/object-delegation.context';

import {
  AuditHistoryPage,
  ListAuditHistoryQueryDto,
} from './dto/list-audit-history-query.dto';

const historyInclude = {
  actor: { select: { id: true, login: true, fullName: true } },
} as const;

export type AuditHistoryEvent = Prisma.AuditEventGetPayload<{
  include: typeof historyInclude;
}>;

type AuditDatabaseClient = Pick<Prisma.TransactionClient, 'auditEvent'>;

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
  }, database: AuditDatabaseClient = this.prisma): Promise<void> {
    const delegations = usedObjectDelegations();
    if (delegations.length) {
      params = { ...params, metadata: { ...(params.metadata && typeof params.metadata === 'object' && !Array.isArray(params.metadata) ? params.metadata : {}), delegations } };
    }
    await database.auditEvent.create({
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

  // Callers must authorize the entity before querying either rows or facets.
  async listAuditEventsPage(
    entityType: 'counterparty' | 'one_time_order',
    entityId: string,
    query: ListAuditHistoryQueryDto,
  ): Promise<AuditHistoryPage<AuditHistoryEvent>> {
    const from = query.dateFrom ? this.historyDate(query.dateFrom) : undefined;
    const until = query.dateTo ? this.historyDate(query.dateTo, true) : undefined;
    if (from && until && from >= until) {
      throw new BadRequestException('History date range is invalid');
    }

    const scope: Prisma.AuditEventWhereInput = { entityType, entityId };
    const where: Prisma.AuditEventWhereInput = {
      ...scope,
      ...(query.eventType ? { action: query.eventType } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(from || until
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(until ? { lt: until } : {}),
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { action: { contains: query.q, mode: 'insensitive' } },
              { actor: { fullName: { contains: query.q, mode: 'insensitive' } } },
              { actor: { login: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const actorSelect = { id: true, login: true, fullName: true } as const;
    const facetLimit = 100;
    const [total, items, eventTypes, actors, selectedActor] = await this.prisma.$transaction([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({
        where,
        include: historyInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.auditEvent.groupBy({
        by: ['action'],
        where: scope,
        orderBy: { action: 'asc' },
        take: facetLimit + 1,
      }),
      this.prisma.user.findMany({
        where: {
          auditEvents: { some: scope },
          ...(query.actorSearch
            ? {
                OR: [
                  { fullName: { contains: query.actorSearch, mode: 'insensitive' } },
                  { login: { contains: query.actorSearch, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        select: actorSelect,
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        take: facetLimit + 1,
      }),
      this.prisma.user.findFirst({
        where: {
          id: { in: query.actorUserId ? [query.actorUserId] : [] },
          auditEvents: { some: scope },
        },
        select: actorSelect,
      }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

    const actorOptions = actors.slice(0, facetLimit);
    const addSelectedActor = selectedActor &&
      !actorOptions.some((actor) => actor.id === selectedActor.id);
    const actorsHasMore = actors.length > facetLimit ||
      Boolean(addSelectedActor && actors.length >= facetLimit);
    if (selectedActor && addSelectedActor) {
      actorOptions.unshift(selectedActor);
      actorOptions.splice(facetLimit);
    }
    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
      facets: {
        actors: actorOptions,
        eventTypes: eventTypes.slice(0, facetLimit).map((event) => event.action),
        actorsHasMore,
        eventTypesHasMore: eventTypes.length > facetLimit,
      },
    };
  }

  private historyDate(value: string, nextDay = false): Date {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day!));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month! - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new BadRequestException('History date is invalid');
    }
    if (nextDay) date.setUTCDate(date.getUTCDate() + 1);
    return new Date(`${date.toISOString().slice(0, 10)}T00:00:00+03:00`);
  }

  async writeObjectAuditLog(params: {
    objectId: string;
    actorUserId: string;
    actionCode: string;
    payload?: Prisma.InputJsonValue | null;
  }): Promise<void> {
    const delegations = usedObjectDelegations();
    if (delegations.length) {
      params = { ...params, payload: { ...(params.payload && typeof params.payload === 'object' && !Array.isArray(params.payload) ? params.payload : {}), delegations } };
    }
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
