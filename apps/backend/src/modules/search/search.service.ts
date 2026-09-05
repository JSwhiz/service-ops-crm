import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { canViewCandidates } from '../candidates/utils/candidate-access.util';
import { canViewEmployeesHr } from '../employees/utils/employee-hr-access.util';
import {
  hasHrObjectView,
  hasWideObjectAccess,
} from '../objects/utils/object-access.util';
import {
  buildOneTimeOrderAccessWhere,
  canAccessOneTimeOrders,
} from '../one-time-orders/utils/one-time-order-access.util';
import { PrismaService } from '../prisma/prisma.service';
import { buildTaskAccessWhere } from '../tasks/utils/task-access.util';

import { GlobalSearchQueryDto } from './dto/global-search-query.dto';
import {
  GlobalSearchItemDto,
  GlobalSearchResponseDto,
} from './dto/global-search-response.dto';

interface CurrentAuthUser {
  id: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
}

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    currentUser: CurrentAuthUser,
    query: GlobalSearchQueryDto,
  ): Promise<GlobalSearchResponseDto> {
    const roleCodes = currentUser.roleCodes?.length
      ? currentUser.roleCodes
      : [currentUser.roleCode];
    const permissionCodes = currentUser.permissionCodes ?? [];
    const normalizedQuery = query.q.trim();
    const term = normalizedQuery.replace(/^#/, '').trim();

    if (term.length < 2) {
      return { query: normalizedQuery, items: [] };
    }

    const objectAccessWhere: Prisma.ObjectWhereInput =
      hasWideObjectAccess(roleCodes) || hasHrObjectView(permissionCodes)
        ? {}
        : {
            OR: [
              { createdByUserId: currentUser.id },
              {
                assignments: {
                  some: { userId: currentUser.id, isActive: true },
                },
              },
            ],
          };

    const taskAccessWhere = buildTaskAccessWhere({
      currentUserId: currentUser.id,
      roleCodes,
    });

    const orderAccessWhere = buildOneTimeOrderAccessWhere({
      currentUserId: currentUser.id,
      roleCodes,
      permissionCodes,
    });

    const [objects, tasks, orders, employees, candidates] = await Promise.all([
      this.prisma.object.findMany({
        where: {
          AND: [
            objectAccessWhere,
            { deletedAt: null },
            {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { internalName: { contains: term, mode: 'insensitive' } },
                { address: { contains: term, mode: 'insensitive' } },
              ],
            },
          ],
        },
        select: { id: true, name: true, internalName: true, address: true },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: query.limit,
      }),
      this.prisma.task.findMany({
        where: {
          AND: [
            taskAccessWhere,
            {
              OR: [
                { title: { contains: term, mode: 'insensitive' } },
                { description: { contains: term, mode: 'insensitive' } },
                { object: { name: { contains: term, mode: 'insensitive' } } },
                {
                  oneTimeOrder: {
                    title: { contains: term, mode: 'insensitive' },
                  },
                },
              ],
            },
          ],
        },
        select: {
          id: true,
          title: true,
          object: { select: { name: true } },
          oneTimeOrder: { select: { title: true } },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: query.limit,
      }),
      canAccessOneTimeOrders(roleCodes, permissionCodes)
        ? this.prisma.oneTimeOrder.findMany({
            where: {
              AND: [
                orderAccessWhere,
                {
                  OR: [
                    { title: { contains: term, mode: 'insensitive' } },
                    {
                      executionAddress: {
                        contains: term,
                        mode: 'insensitive',
                      },
                    },
                    { contactName: { contains: term, mode: 'insensitive' } },
                    { contactPhone: { contains: term, mode: 'insensitive' } },
                  ],
                },
              ],
            },
            select: { id: true, title: true, executionAddress: true },
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            take: query.limit,
          })
        : Promise.resolve([]),
      canViewEmployeesHr(permissionCodes)
        ? this.prisma.employee.findMany({
            where: {
              deletedAt: null,
              OR: [
                { fullName: { contains: term, mode: 'insensitive' } },
                { phone: { contains: term, mode: 'insensitive' } },
                { position: { contains: term, mode: 'insensitive' } },
              ],
            },
            select: { id: true, fullName: true, phone: true, position: true },
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            take: query.limit,
          })
        : Promise.resolve([]),
      canViewCandidates(permissionCodes)
        ? this.prisma.candidate.findMany({
            where: {
              deletedAt: null,
              OR: [
                { fullName: { contains: term, mode: 'insensitive' } },
                { phone: { contains: term, mode: 'insensitive' } },
              ],
            },
            select: { id: true, fullName: true, phone: true, status: true },
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            take: query.limit,
          })
        : Promise.resolve([]),
    ]);

    const items: GlobalSearchItemDto[] = [
      ...objects.map((item) => ({
        id: item.id,
        type: 'object' as const,
        label: item.name,
        description: item.address || item.internalName || null,
        href: `/objects/${item.id}`,
      })),
      ...tasks.map((item) => ({
        id: item.id,
        type: 'task' as const,
        label: item.title,
        description:
          item.object?.name ?? item.oneTimeOrder?.title ?? 'Задача',
        href: `/tasks/${item.id}`,
      })),
      ...orders.map((item) => ({
        id: item.id,
        type: 'one_time_order' as const,
        label: item.title,
        description: item.executionAddress || 'Разовый заказ',
        href: `/one-time-orders/${item.id}`,
      })),
      ...employees.map((item) => ({
        id: item.id,
        type: 'employee' as const,
        label: item.fullName,
        description:
          [item.position, item.phone].filter(Boolean).join(' · ') || 'Сотрудник',
        href: `/employees/${item.id}`,
      })),
      ...candidates.map((item) => ({
        id: item.id,
        type: 'candidate' as const,
        label: item.fullName,
        description:
          [item.phone, item.status].filter(Boolean).join(' · ') || 'Кандидат',
        href: `/candidates/${item.id}`,
      })),
    ];

    return { query: normalizedQuery, items };
  }
}
