import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { canOverrideFrozenObject, canViewObjectByScope, hasWideObjectAccess } from '../objects/utils/object-access.util';
import { delegatedObjectIds, hasDelegatedObjectAction } from '../user-substitutions/object-delegation.context';
import { ListRubberMatsQueryDto } from './dto/list-rubber-mats-query.dto';
import { CreateRubberMatSizeDto, SetRubberMatQuantityDto, UpdateRubberMatCostDto } from './dto/aggregate-rubber-mat.dto';

export interface MatActor { id: string; roleCode: string; roleCodes?: string[]; isActive: boolean }
interface Size { id: string; lengthCm: Prisma.Decimal; widthCm: Prisma.Decimal; replacementCost: Prisma.Decimal | null; version: number }
interface Quantity { quantity: number; version: number }
const CalculationDecimal = Prisma.Decimal.clone({ precision: 40 });

// Decimal arithmetic stays on the server; null prices never become zero.
export function replacementTotals(items: Array<{ quantity: number; replacementCost: Prisma.Decimal | null }>) {
  let known = new CalculationDecimal(0);
  let missing = false;
  for (const item of items) {
    if (item.quantity === 0) continue;
    if (item.replacementCost === null) missing = true;
    else known = known.plus(new CalculationDecimal(item.replacementCost.toString()).mul(item.quantity));
  }
  return { knownReplacementCost: known.toFixed(2), totalReplacementCost: missing ? null : known.toFixed(2) };
}

@Injectable()
export class RubberMatAggregateService {
  constructor(private readonly prisma: PrismaService) {}
  private roles(user: MatActor) { return user.roleCodes?.length ? user.roleCodes : [user.roleCode]; }
  private active(user: MatActor) { if (!user.isActive) throw new ForbiddenException('Активный пользователь обязателен'); }
  private manager(user: MatActor) {
    this.active(user);
    if (!hasWideObjectAccess(this.roles(user))) throw new ForbiddenException('Нет права управления каталогом размеров');
  }
  private async ready(tx: Prisma.TransactionClient) {
    const markers = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "RubberMatAggregateMigration" WHERE id = 'legacy-v1'`;
    if (!markers.length) throw new ServiceUnavailableException('Перенос учёта ковров ещё не завершён');
  }
  private async context(tx: Prisma.TransactionClient, user: MatActor, objectId: string) {
    this.active(user);
    const object = await tx.object.findFirst({ where: { id: objectId, deletedAt: null }, select: {
      id: true, status: true, createdByUserId: true,
      assignments: { where: { isActive: true }, select: { userId: true, isActive: true, assignmentRoleCode: true } },
    } });
    if (!object) throw new NotFoundException('Объект не найден');
    const roles = this.roles(user);
    if (!canViewObjectByScope({ currentUserId: user.id, roleCodes: roles, object })) throw new ForbiddenException('Нет доступа к коврам объекта');
    const operational = hasWideObjectAccess(roles) || object.assignments.some((a) => a.userId === user.id && ['manager', 'responsible'].includes(a.assignmentRoleCode)) || hasDelegatedObjectAction(user.id, objectId, 'operate');
    const canManage = operational && object.status !== 'archived' && (object.status !== 'frozen' || canOverrideFrozenObject(roles));
    return { canManage };
  }
  private present(size: Size) { return { ...size, lengthCm: Number(size.lengthCm), widthCm: Number(size.widthCm), replacementCost: size.replacementCost?.toFixed(2) ?? null }; }

  async catalog(user: MatActor) {
    this.active(user);
    return this.prisma.$transaction(async (tx) => {
      await this.ready(tx);
      const rows = await tx.$queryRaw<Size[]>`SELECT * FROM "RubberMatSize" ORDER BY "lengthCm", "widthCm", id`;
      return { items: rows.map((s) => this.present(s)), canManage: hasWideObjectAccess(this.roles(user)) };
    });
  }
  async registry(user: MatActor, query: ListRubberMatsQueryDto) {
    this.active(user);
    const search = query.q?.trim();
    const where: Prisma.ObjectWhereInput = {
      deletedAt: null,
      ...(query.objectId ? { id: query.objectId } : {}),
      AND: [
        ...(hasWideObjectAccess(this.roles(user)) ? [] : [{ OR: [
          { createdByUserId: user.id }, { assignments: { some: { userId: user.id, isActive: true } } },
          { id: { in: delegatedObjectIds(user.id, 'view') } },
        ] }]),
        ...(search ? [{ OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { internalName: { contains: search, mode: 'insensitive' as const } },
          { address: { contains: search, mode: 'insensitive' as const } },
        ] }] : []),
      ],
    };
    const page = query.page ?? 1, limit = query.limit ?? 20;
    return this.prisma.$transaction(async (tx) => {
      await this.ready(tx);
      const total = await tx.object.count({ where });
      const objects = await tx.object.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit, select: { id: true, name: true, address: true } });
      const quantities = objects.length ? await tx.$queryRaw<Array<{ objectId: string; quantity: number; replacementCost: Prisma.Decimal | null }>>(Prisma.sql`SELECT q."objectId", q.quantity, s."replacementCost" FROM "ObjectRubberMatQuantity" q JOIN "RubberMatSize" s ON s.id = q."sizeId" WHERE q."objectId" IN (${Prisma.join(objects.map((o) => o.id))})`) : [];
      return { items: objects.map((object) => {
        const rows = quantities.filter((q) => q.objectId === object.id);
        return { object, quantity: rows.reduce((sum, row) => sum + row.quantity, 0), ...replacementTotals(rows) };
      }), page, limit, total, totalPages: Math.ceil(total / limit) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async createSize(user: MatActor, payload: CreateRubberMatSizeDto) {
    this.manager(user);
    return this.prisma.$transaction(async (tx) => {
      await this.ready(tx);
      const id = randomUUID();
      const cost = payload.replacementCost ?? null;
      const rows = await tx.$queryRaw<Size[]>`INSERT INTO "RubberMatSize" (id, "lengthCm", "widthCm", "replacementCost", version, "createdAt", "updatedAt") VALUES (${id}, ${payload.lengthCm}, ${payload.widthCm}, ${cost}::numeric, 1, NOW(), NOW()) ON CONFLICT ("lengthCm", "widthCm") DO NOTHING RETURNING *`;
      if (!rows.length) throw new ConflictException('Такой размер уже есть в каталоге');
      await tx.$executeRaw`INSERT INTO "RubberMatSizeChange" (id, "sizeId", version, "beforeCost", "afterCost", "actorUserId", source) VALUES (${randomUUID()}, ${id}, 1, NULL, ${cost}::numeric, ${user.id}, 'user')`;
      return this.present(rows[0]);
    });
  }
  async updateCost(user: MatActor, sizeId: string, payload: UpdateRubberMatCostDto) {
    this.manager(user);
    if (payload.replacementCost === undefined) throw new BadRequestException('Укажите стоимость или явно очистите её');
    return this.prisma.$transaction(async (tx) => {
      await this.ready(tx);
      const [size] = await tx.$queryRaw<Size[]>`SELECT * FROM "RubberMatSize" WHERE id = ${sizeId} FOR UPDATE`;
      if (!size) throw new NotFoundException('Размер не найден');
      if (size.version !== payload.version) throw new ConflictException('Стоимость изменена. Обновите данные');
      const cost = payload.replacementCost ?? null;
      const [updated] = await tx.$queryRaw<Size[]>`UPDATE "RubberMatSize" SET "replacementCost" = ${cost}::numeric, version = version + 1, "updatedAt" = NOW() WHERE id = ${sizeId} RETURNING *`;
      await tx.$executeRaw`INSERT INTO "RubberMatSizeChange" (id, "sizeId", version, "beforeCost", "afterCost", "actorUserId", source) VALUES (${randomUUID()}, ${sizeId}, ${updated.version}, ${size.replacementCost}::numeric, ${cost}::numeric, ${user.id}, 'user')`;
      return this.present(updated);
    });
  }
  async aggregate(user: MatActor, objectId: string) {
    return this.prisma.$transaction(async (tx) => {
      const access = await this.context(tx, user, objectId);
      await this.ready(tx);
      const rows = await tx.$queryRaw<Array<Size & { quantity: number; quantityVersion: number }>>`SELECT s.*, COALESCE(q.quantity, 0)::int AS quantity, COALESCE(q.version, 0)::int AS "quantityVersion" FROM "RubberMatSize" s LEFT JOIN "ObjectRubberMatQuantity" q ON q."sizeId" = s.id AND q."objectId" = ${objectId} ORDER BY s."lengthCm", s."widthCm", s.id`;
      return { ...access, items: rows.map((row) => this.present(row)), ...replacementTotals(rows) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async setQuantity(user: MatActor, objectId: string, sizeId: string, payload: SetRubberMatQuantityDto) {
    return this.prisma.$transaction(async (tx) => {
      // Serializes initial inserts, assignment/status checks and later revisions.
      await tx.$queryRaw`SELECT id FROM objects WHERE id = ${objectId} FOR UPDATE`;
      if (!(await this.context(tx, user, objectId)).canManage) throw new ForbiddenException('Изменение количества недоступно');
      await this.ready(tx);
      const [size] = await tx.$queryRaw<Size[]>`SELECT * FROM "RubberMatSize" WHERE id = ${sizeId} FOR SHARE`;
      if (!size) throw new NotFoundException('Размер не найден');
      const [before] = await tx.$queryRaw<Quantity[]>`SELECT quantity, version FROM "ObjectRubberMatQuantity" WHERE "objectId" = ${objectId} AND "sizeId" = ${sizeId}`;
      if ((before?.version ?? 0) !== payload.version) throw new ConflictException('Количество изменено. Обновите данные');
      const version = payload.version + 1;
      await tx.$executeRaw`INSERT INTO "ObjectRubberMatQuantity" ("objectId", "sizeId", quantity, version, "updatedAt") VALUES (${objectId}, ${sizeId}, ${payload.quantity}, ${version}, NOW()) ON CONFLICT ("objectId", "sizeId") DO UPDATE SET quantity = EXCLUDED.quantity, version = EXCLUDED.version, "updatedAt" = NOW()`;
      await tx.$executeRaw`INSERT INTO "ObjectRubberMatQuantityChange" (id, "objectId", "sizeId", version, "beforeQuantity", "afterQuantity", "replacementCostSnapshot", "actorUserId", source) VALUES (${randomUUID()}, ${objectId}, ${sizeId}, ${version}, ${before?.quantity ?? 0}, ${payload.quantity}, ${size.replacementCost}::numeric, ${user.id}, 'user')`;
      return { quantity: payload.quantity, version };
    });
  }
  async quantityHistory(user: MatActor, objectId: string) {
    await this.context(this.prisma, user, objectId);
    return this.prisma.$queryRaw`SELECT h.*, s."lengthCm"::text, s."widthCm"::text, h."replacementCostSnapshot"::text, u."fullName" AS "actorName" FROM "ObjectRubberMatQuantityChange" h JOIN "RubberMatSize" s ON s.id = h."sizeId" LEFT JOIN users u ON u.id = h."actorUserId" WHERE h."objectId" = ${objectId} ORDER BY h."occurredAt" DESC, h.id DESC`;
  }
  async costHistory(user: MatActor, sizeId: string) {
    this.active(user);
    return this.prisma.$queryRaw`SELECT h.*, h."beforeCost"::text, h."afterCost"::text, u."fullName" AS "actorName" FROM "RubberMatSizeChange" h LEFT JOIN users u ON u.id = h."actorUserId" WHERE h."sizeId" = ${sizeId} ORDER BY h.version DESC`;
  }
}
