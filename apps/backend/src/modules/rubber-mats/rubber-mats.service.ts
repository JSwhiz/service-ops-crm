import {
  GoneException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { canViewObjectByScope, hasWideObjectAccess } from '../objects/utils/object-access.util';
import { delegatedObjectIds } from '../user-substitutions/object-delegation.context';

import { RegisterRubberMatDto, UpdateRubberMatDto } from './dto/rubber-mat.dto';
import { ListRubberMatsQueryDto } from './dto/list-rubber-mats-query.dto';

interface RubberMatUser {
  id: string;
  roleCode: string;
  roleCodes?: string[];
  isActive: boolean;
}

const matSelect = {
  id: true,
  inventoryCode: true,
  objectId: true,
  zone: true,
  lengthCm: true,
  widthCm: true,
  thicknessMm: true,
  condition: true,
  installedAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RubberMatSelect;

@Injectable()
export class RubberMatsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: RubberMatUser, objectId: string) {
    await this.assertObjectAccess(user, objectId);
    const mats = await this.prisma.rubberMat.findMany({
      where: { objectId },
      select: matSelect,
      orderBy: [{ condition: 'asc' }, { zone: 'asc' }, { lengthCm: 'asc' }],
    });
    return mats.map((mat) => this.present(mat));
  }

  async listRegistry(user: RubberMatUser, query: ListRubberMatsQueryDto) {
    if (!user.isActive) throw new ForbiddenException('Активный пользователь обязателен');
    const roleCodes = user.roleCodes ?? [user.roleCode];
    const objectScope: Prisma.ObjectWhereInput = {
      deletedAt: null,
      ...(hasWideObjectAccess(roleCodes)
        ? {}
        : { OR: [
          { id: { in: delegatedObjectIds(user.id, 'view') } },
          { createdByUserId: user.id },
          { assignments: { some: { userId: user.id, isActive: true } } },
        ] }),
    };
    const visibleObjects = await this.prisma.object.findMany({
      where: objectScope,
      select: { id: true },
    });
    const visibleObjectIds = visibleObjects.map((item) => item.id);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.q?.trim();
    const scopeFilter: Prisma.RubberMatWhereInput = {
      OR: [
        { objectId: { in: visibleObjectIds } },
        ...(hasWideObjectAccess(roleCodes) ? [{ objectId: null }] : []),
      ],
    };
    const filters: Prisma.RubberMatWhereInput[] = [scopeFilter];
    if (query.objectId) filters.push({ objectId: { equals: query.objectId } });
    if (search) filters.push({
      OR: [
        { inventoryCode: { contains: search, mode: 'insensitive' } },
        { zone: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { object: { is: { name: { contains: search, mode: 'insensitive' } } } },
        { object: { is: { internalName: { contains: search, mode: 'insensitive' } } } },
        { object: { is: { address: { contains: search, mode: 'insensitive' } } } },
      ],
    });
    const where: Prisma.RubberMatWhereInput = {
      ...(query.condition ? { condition: query.condition } : {}),
      AND: filters,
    };
    const [total, mats] = await this.prisma.$transaction([
      this.prisma.rubberMat.count({ where }),
      this.prisma.rubberMat.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ condition: 'asc' }, { updatedAt: 'desc' }, { id: 'asc' }],
        select: {
          ...matSelect,
          object: { select: { id: true, name: true, internalName: true, address: true } },
        },
      }),
    ]);
    return {
      items: mats.map((mat) => ({ ...this.present(mat), object: mat.object })),
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async listAvailableForObject(user: RubberMatUser, objectId: string) {
    await this.assertObjectAccess(user, objectId);
    const mats = await this.prisma.rubberMat.findMany({
      where: { objectId: null, condition: { not: 'retired' } },
      select: matSelect,
      orderBy: [{ inventoryCode: 'asc' }, { createdAt: 'asc' }],
    });
    return mats.map((mat) => this.present(mat));
  }

  async register(user: RubberMatUser, _payload: RegisterRubberMatDto) {
    void _payload;
    this.assertRegistryManager(user);
    throw new GoneException('Поштучный учёт закрыт. Используйте каталог размеров и количество на объекте');
  }

  async assign(user: RubberMatUser, objectId: string, _matId: string, _zone: string, _note: string) {
    void [_matId, _zone, _note];
    return this.legacyWrite(user, objectId);
  }
  async returnToStock(user: RubberMatUser, objectId: string, _matId: string, _note: string) {
    void [_matId, _note];
    return this.legacyWrite(user, objectId);
  }
  async update(user: RubberMatUser, objectId: string, _matId: string, _payload: UpdateRubberMatDto) {
    void [_matId, _payload];
    return this.legacyWrite(user, objectId);
  }
  async move(user: RubberMatUser, sourceObjectId: string, _matId: string, targetObjectId: string, _zone: string, _note: string) {
    void [_matId, _zone, _note];
    await this.assertObjectAccess(user, sourceObjectId);
    return this.legacyWrite(user, targetObjectId);
  }
  async service(user: RubberMatUser, objectId: string, _matId: string, _note: string) {
    void [_matId, _note];
    return this.legacyWrite(user, objectId);
  }
  private async legacyWrite(user: RubberMatUser, objectId: string) {
    await this.assertObjectAccess(user, objectId);
    throw new GoneException('Поштучный учёт закрыт. Используйте количество по размерам');
  }

  async getHistory(user: RubberMatUser, objectId: string, matId: string) {
    await this.assertObjectAccess(user, objectId);
    const objectHistoryScope: Prisma.RubberMatEventWhereInput = {
      rubberMatId: matId,
      OR: [
        { action: 'registered' },
        { fromObjectId: objectId },
        { toObjectId: objectId },
      ],
    };
    const exists = await this.prisma.rubberMatEvent.findFirst({ where: { rubberMatId: matId, OR: [{ fromObjectId: objectId }, { toObjectId: objectId }] }, select: { id: true } });
    if (!exists) throw new NotFoundException('История ковра для этого объекта не найдена');
    const events = await this.prisma.rubberMatEvent.findMany({
      where: objectHistoryScope,
      include: {
        actor: { select: { id: true, fullName: true } },
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    });
    // Return only this object's part of the asset history. A scoped manager must
    // not learn the identifiers or activity of an unrelated destination object.
    return events.map((event) => ({
      id: event.id,
      action: event.action,
      fromObjectId: event.fromObjectId === objectId ? event.fromObjectId : null,
      toObjectId: event.toObjectId === objectId ? event.toObjectId : null,
      fromCondition: event.fromCondition,
      toCondition: event.toCondition,
      fromZone: event.fromZone,
      toZone: event.toZone,
      note: event.note,
      occurredAt: event.occurredAt,
      actor: event.actor,
    }));
  }

  private async assertObjectAccess(user: RubberMatUser, objectId: string): Promise<void> {
    if (!user.isActive) throw new ForbiddenException('Активный пользователь обязателен');
    const object = await this.prisma.object.findFirst({
      where: { id: objectId, deletedAt: null },
      select: {
        id: true,
        createdByUserId: true,
        assignments: { where: { isActive: true }, select: { userId: true, isActive: true } },
      },
    });
    if (!object) throw new NotFoundException('Объект не найден');
    if (!canViewObjectByScope({
      currentUserId: user.id,
      roleCodes: user.roleCodes ?? [user.roleCode],
      object,
    })) throw new ForbiddenException('Нет доступа к коврам этого объекта');
  }

  private assertRegistryManager(user: RubberMatUser): void {
    if (!user.isActive || !hasWideObjectAccess(user.roleCodes ?? [user.roleCode])) {
      throw new ForbiddenException('Нет доступа к управлению общим реестром ковров');
    }
  }

  private present<T extends {
    lengthCm: Prisma.Decimal;
    widthCm: Prisma.Decimal;
    thicknessMm: Prisma.Decimal | null;
    installedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>(mat: T) {
    return {
      ...mat,
      lengthCm: Number(mat.lengthCm),
      widthCm: Number(mat.widthCm),
      thicknessMm: mat.thicknessMm === null ? null : Number(mat.thicknessMm),
      installedAt: mat.installedAt?.toISOString().slice(0, 10) ?? null,
      createdAt: mat.createdAt.toISOString(),
      updatedAt: mat.updatedAt.toISOString(),
    };
  }
}
