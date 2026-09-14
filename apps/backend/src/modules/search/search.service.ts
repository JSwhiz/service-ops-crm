import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { canViewCandidates } from '../candidates/utils/candidate-access.util';
import { canViewCounterparties } from '../counterparties/utils/counterparty-access.util';
import { canViewEmployeesHr } from '../employees/utils/employee-hr-access.util';
import { canAccessEquipment } from '../equipment/utils/equipment-access.util';
import { canAccessInventory } from '../inventory/utils/inventory-access.util';
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
  canSearchCounterparties: boolean;
  canSearchInventory: boolean;
  canSearchEquipment: boolean;
}

interface RankedSearchItem {
  item: GlobalSearchItemDto;
  score: number;
  sequence: number;
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

    const candidateTake = Math.min(Math.max(query.limit * 3, query.limit), 24);

    const [
      objects,
      tasks,
      orders,
      employees,
      candidates,
      counterparties,
      inventoryItems,
      equipmentUnits,
    ] = await Promise.all([
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
        take: candidateTake,
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
        take: candidateTake,
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
            select: {
              id: true,
              title: true,
              executionAddress: true,
              contactName: true,
              contactPhone: true,
            },
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            take: candidateTake,
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
            take: candidateTake,
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
            take: candidateTake,
          })
        : Promise.resolve([]),
      access.canSearchCounterparties
        ? this.prisma.counterparty.findMany({
            where: {
              OR: [
                { id: { contains: term, mode: 'insensitive' } },
                { name: { contains: term, mode: 'insensitive' } },
                { legalName: { contains: term, mode: 'insensitive' } },
                { contactName: { contains: term, mode: 'insensitive' } },
                { contactPhone: { contains: term, mode: 'insensitive' } },
                {
                  objects: {
                    some: {
                      AND: [
                        access.objectWhere,
                        { deletedAt: null },
                        { name: { contains: term, mode: 'insensitive' } },
                      ],
                    },
                  },
                },
              ],
            },
            select: {
              id: true,
              name: true,
              legalName: true,
              contactName: true,
              contactPhone: true,
              status: true,
              _count: { select: { objects: true } },
            },
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            take: candidateTake,
          })
        : Promise.resolve([]),
      access.canSearchInventory
        ? this.prisma.inventoryItem.findMany({
            where: {
              OR: [
                { id: { contains: term, mode: 'insensitive' } },
                { name: { contains: term, mode: 'insensitive' } },
                { category: { contains: term, mode: 'insensitive' } },
                { unit: { contains: term, mode: 'insensitive' } },
              ],
            },
            select: {
              id: true,
              name: true,
              category: true,
              unit: true,
              isActive: true,
            },
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            take: candidateTake,
          })
        : Promise.resolve([]),
      access.canSearchEquipment
        ? this.prisma.equipmentUnit.findMany({
            where: {
              OR: [
                { id: { contains: term, mode: 'insensitive' } },
                { inventoryNumber: { contains: term, mode: 'insensitive' } },
                { serialNumber: { contains: term, mode: 'insensitive' } },
                {
                  catalogItem: {
                    is: {
                      OR: [
                        { name: { contains: term, mode: 'insensitive' } },
                        { category: { contains: term, mode: 'insensitive' } },
                        { brand: { contains: term, mode: 'insensitive' } },
                        { model: { contains: term, mode: 'insensitive' } },
                      ],
                    },
                  },
                },
              ],
            },
            select: {
              id: true,
              inventoryNumber: true,
              serialNumber: true,
              status: true,
              catalogItem: {
                select: {
                  name: true,
                  category: true,
                  brand: true,
                  model: true,
                },
              },
              currentObject: { select: { name: true } },
              currentOneTimeOrder: { select: { title: true } },
            },
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            take: candidateTake,
          })
        : Promise.resolve([]),
    ]);

    let sequence = 0;
    const ranked: RankedSearchItem[] = [
      ...objects.map((item) => ({
        item: this.mapObject(item),
        score: this.matchScore(term, [item.id, item.name, item.internalName, item.address]),
        sequence: sequence++,
      })),
      ...tasks.map((item) => ({
        item: this.mapTask(item),
        score: this.matchScore(term, [
          item.id,
          item.title,
          item.object?.name,
          item.oneTimeOrder?.title,
        ]),
        sequence: sequence++,
      })),
      ...orders.map((item) => ({
        item: this.mapOrder(item),
        score: this.matchScore(term, [
          item.id,
          item.title,
          item.executionAddress,
          item.contactName,
          item.contactPhone,
        ]),
        sequence: sequence++,
      })),
      ...employees.map((item) => ({
        item: this.mapEmployee(item),
        score: this.matchScore(term, [item.id, item.fullName, item.phone, item.position]),
        sequence: sequence++,
      })),
      ...candidates.map((item) => ({
        item: this.mapCandidate(item),
        score: this.matchScore(term, [item.id, item.fullName, item.phone, item.status]),
        sequence: sequence++,
      })),
      ...counterparties.map((item) => ({
        item: this.mapCounterparty(item),
        score: this.matchScore(term, [
          item.id,
          item.name,
          item.legalName,
          item.contactName,
          item.contactPhone,
        ]),
        sequence: sequence++,
      })),
      ...inventoryItems.map((item) => ({
        item: this.mapInventoryItem(item),
        score: this.matchScore(term, [item.id, item.name, item.category, item.unit]),
        sequence: sequence++,
      })),
      ...equipmentUnits.map((item) => ({
        item: this.mapEquipmentUnit(item),
        score: this.matchScore(term, [
          item.id,
          item.inventoryNumber,
          item.serialNumber,
          item.catalogItem.name,
          item.catalogItem.category,
          item.catalogItem.brand,
          item.catalogItem.model,
        ]),
        sequence: sequence++,
      })),
    ].sort((left, right) => left.score - right.score || left.sequence - right.sequence);

    const countByType = new Map<GlobalSearchItemDto['type'], number>();
    const items = ranked
      .filter(({ item }) => {
        const current = countByType.get(item.type) ?? 0;
        if (current >= query.limit) return false;
        countByType.set(item.type, current + 1);
        return true;
      })
      .map(({ item }) => item);

    return { query: normalizedQuery, items };
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
    const counterpartyIds = ids('counterparty');
    const inventoryItemIds = ids('inventory_item');
    const equipmentUnitIds = ids('equipment_unit');

    const [
      objects,
      tasks,
      orders,
      employees,
      candidates,
      counterparties,
      inventoryItems,
      equipmentUnits,
    ] = await Promise.all([
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
            select: {
              id: true,
              title: true,
              executionAddress: true,
              contactName: true,
              contactPhone: true,
            },
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
      access.canSearchCounterparties && counterpartyIds.length
        ? this.prisma.counterparty.findMany({
            where: { id: { in: counterpartyIds } },
            select: {
              id: true,
              name: true,
              legalName: true,
              contactName: true,
              contactPhone: true,
              status: true,
              _count: { select: { objects: true } },
            },
          })
        : Promise.resolve([]),
      access.canSearchInventory && inventoryItemIds.length
        ? this.prisma.inventoryItem.findMany({
            where: { id: { in: inventoryItemIds } },
            select: {
              id: true,
              name: true,
              category: true,
              unit: true,
              isActive: true,
            },
          })
        : Promise.resolve([]),
      access.canSearchEquipment && equipmentUnitIds.length
        ? this.prisma.equipmentUnit.findMany({
            where: { id: { in: equipmentUnitIds } },
            select: {
              id: true,
              inventoryNumber: true,
              serialNumber: true,
              status: true,
              catalogItem: {
                select: {
                  name: true,
                  category: true,
                  brand: true,
                  model: true,
                },
              },
              currentObject: { select: { name: true } },
              currentOneTimeOrder: { select: { title: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    const resolved = new Map<string, GlobalSearchItemDto>();
    for (const item of objects) resolved.set(`object:${item.id}`, this.mapObject(item));
    for (const item of tasks) resolved.set(`task:${item.id}`, this.mapTask(item));
    for (const item of orders) resolved.set(`one_time_order:${item.id}`, this.mapOrder(item));
    for (const item of employees) resolved.set(`employee:${item.id}`, this.mapEmployee(item));
    for (const item of candidates) resolved.set(`candidate:${item.id}`, this.mapCandidate(item));
    for (const item of counterparties) resolved.set(`counterparty:${item.id}`, this.mapCounterparty(item));
    for (const item of inventoryItems) resolved.set(`inventory_item:${item.id}`, this.mapInventoryItem(item));
    for (const item of equipmentUnits) resolved.set(`equipment_unit:${item.id}`, this.mapEquipmentUnit(item));

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
      canSearchCounterparties: canViewCounterparties(permissionCodes),
      canSearchInventory: canAccessInventory(roleCodes),
      canSearchEquipment: canAccessEquipment(roleCodes),
    };
  }

  private matchScore(term: string, values: Array<string | null | undefined>): number {
    const needle = term.trim().toLocaleLowerCase('ru');
    let best = 3;

    for (const value of values) {
      if (!value) continue;
      const haystack = value.trim().toLocaleLowerCase('ru');
      if (haystack === needle) return 0;
      if (haystack.startsWith(needle)) best = Math.min(best, 1);
      else if (haystack.includes(needle)) best = Math.min(best, 2);
    }

    return best;
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

  private mapCounterparty(item: {
    id: string;
    name: string;
    legalName: string | null;
    contactName: string | null;
    contactPhone: string | null;
    status: string;
    _count: { objects: number };
  }): GlobalSearchItemDto {
    const objectCount = item._count.objects;
    const objectLabel =
      objectCount === 1
        ? '1 объект'
        : objectCount >= 2 && objectCount <= 4
          ? `${objectCount} объекта`
          : `${objectCount} объектов`;

    return {
      id: item.id,
      type: 'counterparty',
      label: item.name,
      description:
        [
          item.legalName,
          objectLabel,
          item.contactName,
          item.contactPhone,
          item.status === 'archived' ? 'Архив' : null,
        ]
          .filter(Boolean)
          .join(' · ') || 'Контрагент',
      href: `/counterparties/${item.id}`,
    };
  }

  private mapInventoryItem(item: {
    id: string;
    name: string;
    category: string;
    unit: string;
    isActive: boolean;
  }): GlobalSearchItemDto {
    return {
      id: item.id,
      type: 'inventory_item',
      label: item.name,
      description: [
        item.category,
        item.unit,
        item.isActive ? null : 'Архив',
      ].filter(Boolean).join(' · '),
      href: `/inventory/${item.id}`,
    };
  }

  private mapEquipmentUnit(item: {
    id: string;
    inventoryNumber: string;
    serialNumber: string | null;
    status: string;
    catalogItem: {
      name: string;
      category: string;
      brand: string | null;
      model: string | null;
    };
    currentObject: { name: string } | null;
    currentOneTimeOrder: { title: string } | null;
  }): GlobalSearchItemDto {
    const equipmentName = [
      item.catalogItem.brand,
      item.catalogItem.model,
      item.catalogItem.name,
    ].filter(Boolean).join(' ');

    const location =
      item.currentObject?.name ??
      item.currentOneTimeOrder?.title ??
      this.equipmentStatusLabel(item.status);

    return {
      id: item.id,
      type: 'equipment_unit',
      label: equipmentName || item.catalogItem.name,
      description: [
        `№ ${item.inventoryNumber}`,
        item.serialNumber ? `S/N ${item.serialNumber}` : null,
        location,
      ].filter(Boolean).join(' · '),
      href: `/equipment/${item.id}`,
    };
  }

  private equipmentStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      in_storage: 'На складе',
      assigned_to_object: 'На объекте',
      assigned_to_one_time_order: 'На разовом заказе',
      under_repair: 'В ремонте',
      broken: 'Неисправно',
      lost: 'Утеряно',
      written_off: 'Списано',
    };
    return labels[status] ?? status;
  }
}
