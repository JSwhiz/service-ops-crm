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
import {
  RecentSearchRefDto,
  ResolveRecentSearchDto,
} from './dto/resolve-recent-search.dto';

interface CurrentAuthUser {
  id: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
}

interface SearchAccessContext {
  roleCodes: string[];
  permissionCodes: string[];
  objectWhere: Prisma.ObjectWhereInput;
  taskWhere: Prisma.TaskWhereInput;
  orderWhere: Prisma.OneTimeOrderWhereInput;
  canSearchOrders: boolean;
  canSearchEmployees: boolean;
  canSearchCandidates: boolean;
}

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    currentUser: CurrentAuthUser,
    query: GlobalSearchQueryDto,
  ): Promise<GlobalSearchResponseDto> {
    const access = this.buildAccessContext(currentUser);
    const normalizedQuery = query.q.trim();
    const term = normalizedQuery.replace(/^#/, '').trim();

    if (term.length < 2) {
      return { query: normalizedQuery, items: [] };
    }

    const [objects, tasks, orders, employees, candidates] = await Promise.all([
      this.prisma.object.findMany({
        where: {
          AND: [
            access.objectWhere,
            { deletedAt: null },
            {
              OR: [
                { id: { contains: term, mode: 'insensitive' } },
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
            access.taskWhere,
            {
              OR: [
                { id: { contains: term, mode: 'insensitive' } },
                { title: { contains: term, mode: 'insensitive' } },
                { description: { contains: term, mode: 'insensitive' } },
                { object: { is: { name: { contains: term, mode: 'insensitive' } } } },
                {
                  oneTimeOrder: {
                    is: { title: { contains: term, mode: 'insensitive' } },
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
      access.canSearchOrders
        ? this.prisma.oneTimeOrder.findMany({
            where: {
              AND: [
                access.orderWhere,
                {
                  OR: [
                    { id: { contains: term, mode: 'insensitive' } },
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
      access.canSearchEmployees
        ? this.prisma.employee.findMany({
            where: {
              deletedAt: null,
              OR: [
                { id: { contains: term, mode: 'insensitive' } },
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
      access.canSearchCandidates
        ? this.prisma.candidate.findMany({
            where: {
              deletedAt: null,
              OR: [
                { id: { contains: term, mode: 'insensitive' } },
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

    return {
      query: normalizedQuery,
      items: [
        ...objects.map((item) => this.mapObject(item)),
        ...tasks.map((item) => this.mapTask(item)),
        ...orders.map((item) => this.mapOrder(item)),
        ...employees.map((item) => this.mapEmployee(item)),
        ...candidates.map((item) => this.mapCandidate(item)),
      ],
    };
  }

  async resolveRecent(
    currentUser: CurrentAuthUser,
    payload: ResolveRecentSearchDto,
  ): Promise<GlobalSearchItemDto[]> {
    if (payload.refs.length === 0) return [];

    const access = this.buildAccessContext(currentUser);
    const ids = (type: RecentSearchRefDto['type']): string[] =>
      payload.refs.filter((ref) => ref.type === type).map((ref) => ref.id);

    const objectIds = ids('object');
    const taskIds = ids('task');
    const orderIds = ids('one_time_order');
    const employeeIds = ids('employee');
    const candidateIds = ids('candidate');

    const [objects, tasks, orders, employees, candidates] = await Promise.all([
      objectIds.length
        ? this.prisma.object.findMany({
            where: {
              AND: [
                access.objectWhere,
                { id: { in: objectIds }, deletedAt: null },
              ],
            },
            select: { id: true, name: true, internalName: true, address: true },
          })
        : Promise.resolve([]),
      taskIds.length
        ? this.prisma.task.findMany({
            where: { AND: [access.taskWhere, { id: { in: taskIds } }] },
            select: {
              id: true,
              title: true,
              object: { select: { name: true } },
              oneTimeOrder: { select: { title: true } },
            },
          })
        : Promise.resolve([]),
      access.canSearchOrders && orderIds.length
        ? this.prisma.oneTimeOrder.findMany({
            where: { AND: [access.orderWhere, { id: { in: orderIds } }] },
            select: { id: true, title: true, executionAddress: true },
          })
        : Promise.resolve([]),
      access.canSearchEmployees && employeeIds.length
        ? this.prisma.employee.findMany({
            where: { id: { in: employeeIds }, deletedAt: null },
            select: { id: true, fullName: true, phone: true, position: true },
          })
        : Promise.resolve([]),
      access.canSearchCandidates && candidateIds.length
        ? this.prisma.candidate.findMany({
            where: { id: { in: candidateIds }, deletedAt: null },
            select: { id: true, fullName: true, phone: true, status: true },
          })
        : Promise.resolve([]),
    ]);

    const resolved = new Map<string, GlobalSearchItemDto>();
    for (const item of objects) resolved.set(`object:${item.id}`, this.mapObject(item));
    for (const item of tasks) resolved.set(`task:${item.id}`, this.mapTask(item));
    for (const item of orders) resolved.set(`one_time_order:${item.id}`, this.mapOrder(item));
    for (const item of employees) resolved.set(`employee:${item.id}`, this.mapEmployee(item));
    for (const item of candidates) resolved.set(`candidate:${item.id}`, this.mapCandidate(item));

    return payload.refs
      .map((ref) => resolved.get(`${ref.type}:${ref.id}`))
      .filter((item): item is GlobalSearchItemDto => Boolean(item));
  }

  private buildAccessContext(currentUser: CurrentAuthUser): SearchAccessContext {
    const roleCodes = currentUser.roleCodes?.length
      ? currentUser.roleCodes
      : [currentUser.roleCode];
    const permissionCodes = currentUser.permissionCodes ?? [];

    const objectWhere: Prisma.ObjectWhereInput =
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

    return {
      roleCodes,
      permissionCodes,
      objectWhere,
      taskWhere: buildTaskAccessWhere({
        currentUserId: currentUser.id,
        roleCodes,
      }),
      orderWhere: buildOneTimeOrderAccessWhere({
        currentUserId: currentUser.id,
        roleCodes,
        permissionCodes,
      }),
      canSearchOrders: canAccessOneTimeOrders(roleCodes, permissionCodes),
      canSearchEmployees: canViewEmployeesHr(permissionCodes),
      canSearchCandidates: canViewCandidates(permissionCodes),
    };
  }

  private mapObject(item: {
    id: string;
    name: string;
    internalName: string | null;
    address: string;
  }): GlobalSearchItemDto {
    return {
      id: item.id,
      type: 'object',
      label: item.name,
      description: item.address || item.internalName || null,
      href: `/objects/${item.id}`,
    };
  }

  private mapTask(item: {
    id: string;
    title: string;
    object: { name: string } | null;
    oneTimeOrder: { title: string } | null;
  }): GlobalSearchItemDto {
    return {
      id: item.id,
      type: 'task',
      label: item.title,
      description: item.object?.name ?? item.oneTimeOrder?.title ?? 'Задача',
      href: `/tasks/${item.id}`,
    };
  }

  private mapOrder(item: {
    id: string;
    title: string;
    executionAddress: string;
  }): GlobalSearchItemDto {
    return {
      id: item.id,
      type: 'one_time_order',
      label: item.title,
      description: item.executionAddress || 'Разовый заказ',
      href: `/one-time-orders/${item.id}`,
    };
  }

  private mapEmployee(item: {
    id: string;
    fullName: string;
    phone: string | null;
    position: string | null;
  }): GlobalSearchItemDto {
    return {
      id: item.id,
      type: 'employee',
      label: item.fullName,
      description:
        [item.position, item.phone].filter(Boolean).join(' · ') || 'Сотрудник',
      href: `/employees/${item.id}`,
    };
  }

  private mapCandidate(item: {
    id: string;
    fullName: string;
    phone: string | null;
    status: string;
  }): GlobalSearchItemDto {
    return {
      id: item.id,
      type: 'candidate',
      label: item.fullName,
      description:
        [item.phone, item.status].filter(Boolean).join(' · ') || 'Кандидат',
      href: `/candidates/${item.id}`,
    };
  }
}
