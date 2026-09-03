import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { ListOneTimeOrdersQueryDto } from './dto/list-one-time-orders-query.dto';
import { OneTimeOrderAttentionResponseDto } from './dto/one-time-order-attention-response.dto';
import { buildOneTimeOrderAccessWhere } from './utils/one-time-order-access.util';

interface CurrentAuthUser {
  id: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
}

@Injectable()
export class OneTimeOrderAttentionService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    user: CurrentAuthUser,
    query: ListOneTimeOrdersQueryDto,
  ): Promise<OneTimeOrderAttentionResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = (query.q ?? query.search)?.trim();
    const roleCodes = user.roleCodes?.length ? user.roleCodes : [user.roleCode];
    const clauses: Prisma.OneTimeOrderWhereInput[] = [
      buildOneTimeOrderAccessWhere({
        currentUserId: user.id,
        roleCodes,
        permissionCodes: user.permissionCodes,
      }),
      { status: { notIn: ['completed', 'cancelled'] } },
    ];

    if (query.status) clauses.push({ status: query.status });
    if (query.managerUserId) {
      clauses.push({
        assignments: {
          some: {
            userId: query.managerUserId,
            assignmentRoleCode: 'one_time_manager',
            isActive: true,
          },
        },
      });
    }
    if (query.linkedObjectId) clauses.push({ linkedObjectId: query.linkedObjectId });
    if (query.dateFrom) clauses.push({ executionEndDate: { gte: new Date(`${query.dateFrom}T00:00:00.000Z`) } });
    if (query.dateTo) clauses.push({ executionStartDate: { lte: new Date(`${query.dateTo}T00:00:00.000Z`) } });
    if (search) {
      clauses.push({
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { executionAddress: { contains: search, mode: 'insensitive' } },
          { contactName: { contains: search, mode: 'insensitive' } },
          { contactPhone: { contains: search, mode: 'insensitive' } },
          { linkedObject: { name: { contains: search, mode: 'insensitive' } } },
          {
            assignments: {
              some: {
                assignmentRoleCode: 'one_time_manager',
                isActive: true,
                user: {
                  OR: [
                    { fullName: { contains: search, mode: 'insensitive' } },
                    { login: { contains: search, mode: 'insensitive' } },
                  ],
                },
              },
            },
          },
        ],
      });
    }

    const where: Prisma.OneTimeOrderWhereInput = { AND: clauses };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.oneTimeOrder.findMany({
        where,
        select: {
          id: true,
          title: true,
          status: true,
          executionStartDate: true,
          executionEndDate: true,
          executionAddress: true,
          linkedObject: { select: { id: true, name: true } },
          assignments: {
            where: { assignmentRoleCode: 'one_time_manager', isActive: true },
            select: {
              userId: true,
              user: { select: { login: true, fullName: true } },
            },
          },
        },
        orderBy: [{ executionStartDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.oneTimeOrder.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        executionStartDate: row.executionStartDate?.toISOString().slice(0, 10) ?? null,
        executionEndDate: row.executionEndDate?.toISOString().slice(0, 10) ?? null,
        executionAddress: row.executionAddress,
        linkedObject: row.linkedObject,
        managers: row.assignments.map((assignment) => ({
          userId: assignment.userId,
          login: assignment.user.login,
          fullName: assignment.user.fullName,
        })),
      })),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }
}
