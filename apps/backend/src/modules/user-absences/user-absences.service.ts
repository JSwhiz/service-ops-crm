import { randomUUID } from 'node:crypto';

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import {
  CreateUserAbsenceDto,
  ListUserAbsencesQueryDto,
  UpdateUserAbsenceDto,
  UserAbsenceListResponseDto,
  UserAbsenceResponseDto,
  UserAbsenceType,
} from './dto/user-absence.dto';

export const USER_ABSENCE_VIEW_ALL_PERMISSION = 'user_absences.view_all';
export const USER_ABSENCE_MANAGE_PERMISSION = 'user_absences.manage';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
}

interface UserAbsenceRow {
  id: string;
  userId: string;
  login: string;
  fullName: string;
  absenceType: UserAbsenceType;
  startDate: Date | string;
  endDate: Date | string;
  comment: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

function hasPermission(user: CurrentAuthUser, code: string): boolean {
  return (user.permissionCodes ?? []).includes(code);
}

function dateOnly(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function ensureRange(startDate: string, endDate: string): void {
  if (startDate > endDate) {
    throw new BadRequestException('Дата начала отсутствия не может быть позже даты окончания');
  }
}

@Injectable()
export class UserAbsencesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: CurrentAuthUser, query: ListUserAbsencesQueryDto): Promise<UserAbsenceListResponseDto> {
    const canViewAll = hasPermission(user, USER_ABSENCE_VIEW_ALL_PERMISSION);
    const canManage = hasPermission(user, USER_ABSENCE_MANAGE_PERMISSION);
    if (query.userId && query.userId !== user.id && !canViewAll) {
      throw new ForbiddenException('Недостаточно прав для просмотра отсутствий другого пользователя');
    }

    const requestedUserId = canViewAll ? query.userId : user.id;
    const rows = await this.prisma.$queryRaw<UserAbsenceRow[]>(Prisma.sql`
      SELECT
        ua."id", ua."userId", u."login", u."fullName", ua."absenceType",
        ua."startDate", ua."endDate", ua."comment", ua."createdByUserId",
        ua."createdAt", ua."updatedAt"
      FROM "user_absences" ua
      JOIN "users" u ON u."id" = ua."userId"
      WHERE u."deletedAt" IS NULL
        ${requestedUserId ? Prisma.sql`AND ua."userId" = ${requestedUserId}` : Prisma.empty}
        ${query.absenceType ? Prisma.sql`AND ua."absenceType" = ${query.absenceType}` : Prisma.empty}
        ${query.from ? Prisma.sql`AND ua."endDate" >= CAST(${query.from} AS DATE)` : Prisma.empty}
        ${query.to ? Prisma.sql`AND ua."startDate" <= CAST(${query.to} AS DATE)` : Prisma.empty}
      ORDER BY ua."startDate" ASC, u."fullName" ASC, ua."id" ASC
    `);

    return {
      items: rows.map((row) => this.map(row)),
      capabilities: { canViewAll, canManage },
    };
  }

  async listManageableUsers(user: CurrentAuthUser): Promise<Array<{ id: string; login: string; fullName: string }>> {
    this.assertManage(user);
    return this.prisma.user.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, login: true, fullName: true },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    });
  }

  async create(user: CurrentAuthUser, payload: CreateUserAbsenceDto): Promise<UserAbsenceResponseDto> {
    this.assertManage(user);
    ensureRange(payload.startDate, payload.endDate);
    await this.assertTargetUser(payload.userId);
    await this.assertNoOverlap(payload.userId, payload.startDate, payload.endDate);

    const id = randomUUID();
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO "user_absences"
        ("id", "userId", "absenceType", "startDate", "endDate", "comment", "createdByUserId", "createdAt", "updatedAt")
      VALUES
        (${id}, ${payload.userId}, ${payload.absenceType}, CAST(${payload.startDate} AS DATE), CAST(${payload.endDate} AS DATE), ${payload.comment?.trim() || null}, ${user.id}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    return this.getById(id);
  }

  async update(user: CurrentAuthUser, id: string, payload: UpdateUserAbsenceDto): Promise<UserAbsenceResponseDto> {
    this.assertManage(user);
    const current = await this.getById(id);
    const startDate = payload.startDate ?? current.startDate;
    const endDate = payload.endDate ?? current.endDate;
    const absenceType = payload.absenceType ?? current.absenceType;
    const comment = Object.prototype.hasOwnProperty.call(payload, 'comment')
      ? payload.comment?.trim() || null
      : current.comment;
    ensureRange(startDate, endDate);
    await this.assertNoOverlap(current.userId, startDate, endDate, id);

    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "user_absences"
      SET "absenceType" = ${absenceType},
          "startDate" = CAST(${startDate} AS DATE),
          "endDate" = CAST(${endDate} AS DATE),
          "comment" = ${comment},
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${id}
    `);
    return this.getById(id);
  }

  async remove(user: CurrentAuthUser, id: string): Promise<{ id: string; deleted: true }> {
    this.assertManage(user);
    await this.getById(id);
    await this.prisma.$executeRaw(Prisma.sql`DELETE FROM "user_absences" WHERE "id" = ${id}`);
    return { id, deleted: true };
  }

  async countTodayForLeadership(date: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(DISTINCT ua."userId")::bigint AS "count"
      FROM "user_absences" ua
      JOIN "users" u ON u."id" = ua."userId"
      WHERE u."isActive" = TRUE
        AND u."deletedAt" IS NULL
        AND ua."startDate" <= CAST(${date} AS DATE)
        AND ua."endDate" >= CAST(${date} AS DATE)
    `);
    return Number(rows[0]?.count ?? 0n);
  }

  async listUpcomingForLeadership(date: string, limit = 5): Promise<UserAbsenceResponseDto[]> {
    const rows = await this.prisma.$queryRaw<UserAbsenceRow[]>(Prisma.sql`
      SELECT
        ua."id", ua."userId", u."login", u."fullName", ua."absenceType",
        ua."startDate", ua."endDate", ua."comment", ua."createdByUserId",
        ua."createdAt", ua."updatedAt"
      FROM "user_absences" ua
      JOIN "users" u ON u."id" = ua."userId"
      WHERE u."isActive" = TRUE
        AND u."deletedAt" IS NULL
        AND ua."endDate" >= CAST(${date} AS DATE)
      ORDER BY
        CASE WHEN ua."startDate" <= CAST(${date} AS DATE) THEN 0 ELSE 1 END ASC,
        ua."startDate" ASC,
        u."fullName" ASC
      LIMIT ${limit}
    `);
    return rows.map((row) => this.map(row));
  }

  private assertManage(user: CurrentAuthUser): void {
    if (!hasPermission(user, USER_ABSENCE_MANAGE_PERMISSION)) {
      throw new ForbiddenException('Недостаточно прав для управления отсутствиями пользователей');
    }
  }

  private async assertTargetUser(userId: string): Promise<void> {
    const exists = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Пользователь не найден');
  }

  private async assertNoOverlap(userId: string, startDate: string, endDate: string, excludeId?: string): Promise<void> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "user_absences"
      WHERE "userId" = ${userId}
        ${excludeId ? Prisma.sql`AND "id" <> ${excludeId}` : Prisma.empty}
        AND "startDate" <= CAST(${endDate} AS DATE)
        AND "endDate" >= CAST(${startDate} AS DATE)
      LIMIT 1
    `);
    if (rows.length) {
      throw new BadRequestException('У пользователя уже есть отсутствие, пересекающееся с выбранным периодом');
    }
  }

  private async getById(id: string): Promise<UserAbsenceResponseDto> {
    const rows = await this.prisma.$queryRaw<UserAbsenceRow[]>(Prisma.sql`
      SELECT
        ua."id", ua."userId", u."login", u."fullName", ua."absenceType",
        ua."startDate", ua."endDate", ua."comment", ua."createdByUserId",
        ua."createdAt", ua."updatedAt"
      FROM "user_absences" ua
      JOIN "users" u ON u."id" = ua."userId"
      WHERE ua."id" = ${id}
      LIMIT 1
    `);
    if (!rows[0]) throw new NotFoundException('Запись об отсутствии не найдена');
    return this.map(rows[0]);
  }

  private map(row: UserAbsenceRow): UserAbsenceResponseDto {
    return {
      id: row.id,
      userId: row.userId,
      user: { id: row.userId, login: row.login, fullName: row.fullName },
      absenceType: row.absenceType,
      startDate: dateOnly(row.startDate),
      endDate: dateOnly(row.endDate),
      comment: row.comment,
      createdByUserId: row.createdByUserId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
