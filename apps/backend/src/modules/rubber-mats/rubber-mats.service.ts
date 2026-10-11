import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
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

  async register(user: RubberMatUser, payload: RegisterRubberMatDto) {
    this.assertRegistryManager(user);
    const id = randomUUID();
    const mat = await this.prisma.$transaction(async (tx) => {
      const created = await tx.rubberMat.create({
        data: {
          id,
          objectId: null,
          zone: null,
          lengthCm: new Prisma.Decimal(payload.lengthCm),
          widthCm: new Prisma.Decimal(payload.widthCm),
          thicknessMm: payload.thicknessMm === undefined ? null : new Prisma.Decimal(payload.thicknessMm),
          inventoryCode: payload.inventoryCode?.trim() || null,
          notes: payload.notes?.trim() || null,
          createdByUserId: user.id,
          condition: 'good',
        },
        select: matSelect,
      });
      await tx.rubberMatEvent.create({
        data: { rubberMatId: id, action: 'registered', toCondition: 'good', note: payload.note.trim(), actorUserId: user.id },
      });
      return created;
    });
    return this.present(mat);
  }

  async assign(user: RubberMatUser, objectId: string, matId: string, zone: string, note: string) {
    await this.assertObjectAccess(user, objectId);
    const existing = await this.prisma.rubberMat.findUnique({ where: { id: matId } });
    if (!existing) throw new NotFoundException('Ковёр не найден в реестре');
    if (existing.objectId !== null) throw new BadRequestException('Ковёр уже закреплён за объектом');
    if (existing.condition === 'retired') throw new BadRequestException('Списанный ковёр нельзя назначить');
    const trimmedZone = zone.trim();
    const mat = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.rubberMat.update({ where: { id: matId }, data: { objectId, zone: trimmedZone, installedAt: new Date() }, select: matSelect });
      await tx.rubberMatEvent.create({
        data: { rubberMatId: matId, action: 'assigned', toObjectId: objectId, fromCondition: existing.condition, toCondition: existing.condition, toZone: trimmedZone, note: note.trim(), actorUserId: user.id },
      });
      return updated;
    });
    return this.present(mat);
  }

  async returnToStock(user: RubberMatUser, objectId: string, matId: string, note: string) {
    await this.assertObjectAccess(user, objectId);
    const existing = await this.prisma.rubberMat.findFirst({ where: { id: matId, objectId } });
    if (!existing) throw new NotFoundException('Ковёр не найден на объекте');
    if (existing.condition === 'retired') throw new BadRequestException('Списанный ковёр нельзя вернуть в реестр');
    const mat = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.rubberMat.update({ where: { id: matId }, data: { objectId: null, zone: null, installedAt: null }, select: matSelect });
      await tx.rubberMatEvent.create({
        data: { rubberMatId: matId, action: 'returned_to_stock', fromObjectId: objectId, fromCondition: existing.condition, toCondition: existing.condition, fromZone: existing.zone, note: note.trim(), actorUserId: user.id },
      });
      return updated;
    });
    return this.present(mat);
  }

  async update(user: RubberMatUser, objectId: string, matId: string, payload: UpdateRubberMatDto) {
    await this.assertObjectAccess(user, objectId);
    const existing = await this.prisma.rubberMat.findFirst({ where: { id: matId, objectId } });
    if (!existing) throw new NotFoundException('Резиновый ковёр не найден');
    if (existing.condition === 'retired') throw new BadRequestException('Списанный ковёр нельзя редактировать');
    const data: Prisma.RubberMatUpdateInput = {
      ...(payload.zone === undefined ? {} : { zone: payload.zone.trim() }),
      ...(payload.lengthCm === undefined ? {} : { lengthCm: new Prisma.Decimal(payload.lengthCm) }),
      ...(payload.widthCm === undefined ? {} : { widthCm: new Prisma.Decimal(payload.widthCm) }),
      ...(payload.thicknessMm === undefined ? {} : { thicknessMm: payload.thicknessMm === null ? null : new Prisma.Decimal(payload.thicknessMm) }),
      ...(payload.condition === undefined ? {} : { condition: payload.condition }),
      ...(payload.notes === undefined ? {} : { notes: payload.notes?.trim() || null }),
    };
    const nextZone = payload.zone?.trim() ?? existing.zone;
    const nextCondition = payload.condition ?? existing.condition;
    const action = nextCondition === 'retired' ? 'retired'
      : nextCondition !== existing.condition ? 'condition_changed' : 'serviced';
    const mat = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.rubberMat.update({ where: { id: matId }, data, select: matSelect });
      await tx.rubberMatEvent.create({
        data: {
          rubberMatId: matId,
          action,
          fromObjectId: objectId,
          toObjectId: objectId,
          fromCondition: existing.condition,
          toCondition: nextCondition,
          fromZone: existing.zone,
          toZone: nextZone,
          note: payload.note.trim(),
          actorUserId: user.id,
        },
      });
      return updated;
    });
    return this.present(mat);
  }

  async move(user: RubberMatUser, sourceObjectId: string, matId: string, targetObjectId: string, zone: string, note: string) {
    await this.assertObjectAccess(user, sourceObjectId);
    await this.assertObjectAccess(user, targetObjectId);
    const existing = await this.prisma.rubberMat.findFirst({ where: { id: matId, objectId: sourceObjectId } });
    if (!existing) throw new NotFoundException('Резиновый ковёр не найден на исходном объекте');
    if (existing.condition === 'retired') throw new BadRequestException('Списанный ковёр нельзя перемещать');
    const trimmedZone = zone.trim();
    const trimmedNote = note.trim();
    const mat = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.rubberMat.update({
        where: { id: matId },
        data: { objectId: targetObjectId, zone: trimmedZone },
        select: matSelect,
      });
      await tx.rubberMatEvent.create({
        data: {
          rubberMatId: matId,
          action: 'moved',
          fromObjectId: sourceObjectId,
          toObjectId: targetObjectId,
          fromCondition: existing.condition,
          toCondition: existing.condition,
          fromZone: existing.zone,
          toZone: trimmedZone,
          note: trimmedNote,
          actorUserId: user.id,
        },
      });
      return updated;
    });
    return this.present(mat);
  }

  async service(user: RubberMatUser, objectId: string, matId: string, note: string) {
    await this.assertObjectAccess(user, objectId);
    const existing = await this.prisma.rubberMat.findFirst({ where: { id: matId, objectId } });
    if (!existing) throw new NotFoundException('Резиновый ковёр не найден');
    if (existing.condition === 'retired') throw new BadRequestException('Списанный ковёр нельзя обслуживать');
    await this.prisma.rubberMatEvent.create({
      data: {
        rubberMatId: matId,
        action: 'serviced',
        fromObjectId: objectId,
        toObjectId: objectId,
        fromCondition: existing.condition,
        toCondition: existing.condition,
        fromZone: existing.zone,
        toZone: existing.zone,
        note: note.trim(),
        actorUserId: user.id,
      },
    });
    return this.getHistory(user, objectId, matId);
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
    const exists = await this.prisma.rubberMatEvent.findFirst({ where: objectHistoryScope, select: { id: true } });
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
