import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { ChatsService } from '../chats/chats.service';
import { EquipmentScopeResponseDto } from '../equipment/dto/equipment-response.dto';
import { EquipmentService } from '../equipment/equipment.service';
import { FileResponseDto } from '../files/dto/file-response.dto';
import { PrismaService } from '../prisma/prisma.service';
import { TaskResponseDto } from '../tasks/dto/task-response.dto';
import { TasksService } from '../tasks/tasks.service';
import { buildTaskAccessWhere } from '../tasks/utils/task-access.util';

import { AssignOneTimeOrderManagerDto } from './dto/assign-one-time-order-manager.dto';
import { ChangeOneTimeOrderStatusDto } from './dto/change-one-time-order-status.dto';
import { CreateOneTimeOrderCommentDto } from './dto/create-one-time-order-comment.dto';
import { CreateOneTimeOrderPhotoDto } from './dto/create-one-time-order-photo.dto';
import { CreateOneTimeOrderDto } from './dto/create-one-time-order.dto';
import { CreateOneTimeOrderSpecificationItemDto } from './dto/create-one-time-order-specification-item.dto';
import { DeleteOneTimeOrderPhotoDto } from './dto/delete-one-time-order-photo.dto';
import { ListOneTimeOrdersQueryDto } from './dto/list-one-time-orders-query.dto';
import { OneTimeOrderAuditLogResponseDto } from './dto/one-time-order-audit-log-response.dto';
import { OneTimeOrderCommentResponseDto } from './dto/one-time-order-comment-response.dto';
import { OneTimeOrderConflictResponseDto } from './dto/one-time-order-conflict-response.dto';
import { OneTimeOrderDailyReportResponseDto } from './dto/one-time-order-daily-report-response.dto';
import {
  OneTimeOrderListItemResponseDto,
  OneTimeOrderListResponseDto,
} from './dto/one-time-order-list-response.dto';
import { OneTimeOrderPhotoResponseDto } from './dto/one-time-order-photo-response.dto';
import { OneTimeOrderResponseDto } from './dto/one-time-order-response.dto';
import { OneTimeOrderSpecificationItemResponseDto } from './dto/one-time-order-specification-item-response.dto';
import { ReorderOneTimeOrderSpecificationItemsDto } from './dto/reorder-one-time-order-specification-items.dto';
import { UpsertOneTimeOrderDailyReportDto } from './dto/upsert-one-time-order-daily-report.dto';
import { UpdateOneTimeOrderDto } from './dto/update-one-time-order.dto';
import { UpdateOneTimeOrderReviewDto } from './dto/update-one-time-order-review.dto';
import { UpdateOneTimeOrderSpecificationItemDto } from './dto/update-one-time-order-specification-item.dto';
import { OneTimeOrderConflictService } from './one-time-order-conflict.service';
import { buildOneTimeOrderCapabilities, canOpenLinkedObjectCard } from './utils/one-time-order-capabilities.util';
import {
  formatBusinessDate,
  getOneTimeOrderDurationDays,
  normalizeOneTimeOrderDateRange,
} from './utils/one-time-order-date-range.util';
import {
  canBeOneTimeOrderManager,
  canCreateOneTimeOrder,
  canManageOneTimeOrderManagers,
  hasWideOneTimeOrderAccess,
} from './utils/one-time-order-access.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
}

interface OneTimeOrderAssignmentView {
  userId: string;
  assignmentRoleCode: string;
  isActive: boolean;
  user: {
    id: string;
    login: string;
    fullName: string;
    roles: Array<{
      role: {
        code: string;
      };
    }>;
  };
}

interface OneTimeOrderView {
  id: string;
  title: string;
  executionAddress: string;
  linkedObjectId: string | null;
  status: string;
  description: string | null;
  executionDate: Date | null;
  executionStartDate: Date | null;
  executionEndDate: Date | null;
  contactName: string;
  contactPhone: string | null;
  agreedSum: number | null;
  financialNotes: string | null;
  expenseNotes: string | null;
  reviewText: string | null;
  reviewRating: number | null;
  reviewUpdatedAt: Date | null;
  reviewUpdatedByUserId: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: {
    id: string;
    login: string;
    fullName: string;
  };
  reviewUpdatedBy: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  linkedObject:
    | {
        id: string;
        name: string;
        createdByUserId: string;
        assignments: Array<{
          userId: string;
          isActive: boolean;
        }>;
      }
    | null;
  assignments: OneTimeOrderAssignmentView[];
}

interface OneTimeOrderListView extends OneTimeOrderView {
  specificationItems: Array<{
    isCompleted: boolean;
  }>;
}

interface OneTimeOrderDailyReportView {
  id: string;
  oneTimeOrderId: string;
  reportDate: Date;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: {
    id: string;
    login: string;
    fullName: string;
  };
}

interface OneTimeOrderPhotoView {
  id: string;
  oneTimeOrderId: string;
  photoCategory: string;
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedByUserId: string | null;
  deleteReason: string | null;
  restoredAt: Date | null;
  restoredByUserId: string | null;
  createdBy: {
    id: string;
    login: string;
    fullName: string;
  };
  deletedBy: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  restoredBy: {
    id: string;
    login: string;
    fullName: string;
  } | null;
}

interface OneTimeOrderSpecificationItemView {
  id: string;
  oneTimeOrderId: string;
  title: string;
  description: string | null;
  sortOrder: number;
  requiresAttachment: boolean;
  isCompleted: boolean;
  completedAt: Date | null;
  completedByUserId: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedByUserId: string | null;
  completedBy: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  createdBy: {
    id: string;
    login: string;
    fullName: string;
  };
}

interface StoredFileView {
  id: string;
  bucket: string;
  objectKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: string | null;
  createdAt: Date;
  attachments: Array<{
    id: string;
    entityType: string;
    entityId: string;
    fieldCode: string | null;
    uploadedByUserId: string | null;
    createdAt: Date;
  }>;
}

type AuditPrimitive = string | number | boolean | null;

interface ScheduleConflictCheckInput {
  executionStartDate: Date | null;
  executionEndDate: Date | null;
  managerUserIds: string[];
  excludeOrderId?: string;
  confirmScheduleConflicts?: boolean;
}

interface ScheduleConflictAuditInput {
  executionStartDate: Date | null;
  executionEndDate: Date | null;
  managerUserIds: string[];
  conflictResult: OneTimeOrderConflictResponseDto | null;
}

@Injectable()
export class OneTimeOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly tasksService: TasksService,
    private readonly equipmentService: EquipmentService,
    private readonly chatsService: ChatsService,
    private readonly oneTimeOrderConflictService: OneTimeOrderConflictService,
  ) {}

  async listOrders(
    currentUser: CurrentAuthUser,
    query: ListOneTimeOrdersQueryDto,
  ): Promise<OneTimeOrderListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'updatedAt';
    const sortDirection = query.sortDirection ?? 'desc';
    const search = (query.q ?? query.search)?.trim();
    const clauses: Prisma.OneTimeOrderWhereInput[] = [
      await this.buildVisibilityWhere(currentUser),
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
    if (query.linkedObjectId) {
      clauses.push({ linkedObjectId: query.linkedObjectId });
    }
    if (query.dateFrom) {
      clauses.push({
        executionEndDate: {
          gte: this.parseRegistryDate(query.dateFrom),
        },
      });
    }
    if (query.dateTo) {
      clauses.push({
        executionStartDate: {
          lte: this.parseRegistryDate(query.dateTo),
        },
      });
    }
    if (search) {
      clauses.push({
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { executionAddress: { contains: search, mode: 'insensitive' } },
          { contactName: { contains: search, mode: 'insensitive' } },
          { contactPhone: { contains: search, mode: 'insensitive' } },
          { reviewText: { contains: search, mode: 'insensitive' } },
          {
            linkedObject: {
              name: { contains: search, mode: 'insensitive' },
            },
          },
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
    const orderBy: Prisma.OneTimeOrderOrderByWithRelationInput[] = [
      { [sortBy]: sortDirection },
      { id: 'desc' },
    ];
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.oneTimeOrder.findMany({
        where,
        include: {
          ...this.getOrderInclude(),
          specificationItems: {
            where: { deletedAt: null },
            select: { isCompleted: true },
          },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.oneTimeOrder.count({ where }),
    ]);
    const orders = rows as OneTimeOrderListView[];
    const orderIds = orders.map((order) => order.id);
    const taskCountRows =
      orderIds.length === 0
        ? []
        : await this.prisma.task.groupBy({
            by: ['oneTimeOrderId'],
            where: {
              AND: [
                { oneTimeOrderId: { in: orderIds } },
                buildTaskAccessWhere({
                  currentUserId: currentUser.id,
                  roleCodes: this.getRoleCodes(currentUser),
                }),
              ],
            },
            _count: { _all: true },
          });
    const taskCountMap = new Map(
      taskCountRows.flatMap((row) =>
        row.oneTimeOrderId ? [[row.oneTimeOrderId, row._count._all] as const] : [],
      ),
    );

    return {
      items: orders.map((order) =>
        this.mapOrderListItem(
          order,
          currentUser,
          taskCountMap.get(order.id) ?? 0,
        ),
      ),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getOrderById(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<OneTimeOrderResponseDto> {
    const order = (await this.prisma.oneTimeOrder.findFirst({
      where: {
        id,
        ...(await this.buildVisibilityWhere(currentUser)),
      },
      include: this.getOrderInclude(),
    })) as OneTimeOrderView | null;

    if (!order) {
      throw new NotFoundException('One-time order not found');
    }

    return this.mapOrder(order, currentUser);
  }

  async createOrder(
    currentUser: CurrentAuthUser,
    payload: CreateOneTimeOrderDto,
  ): Promise<OneTimeOrderResponseDto> {
    const roleCodes = this.getRoleCodes(currentUser);

    if (!canCreateOneTimeOrder(roleCodes, this.getPermissionCodes(currentUser))) {
      throw new ForbiddenException('One-time order creation denied');
    }

    await this.ensureLinkedObjectExists(payload.linkedObjectId ?? null);
    const dateRange = normalizeOneTimeOrderDateRange({
      executionStartDate: payload.executionStartDate,
      executionEndDate: payload.executionEndDate,
      executionDate: payload.executionDate,
    });
    const managerUserIds = Array.from(
      new Set((payload.managerUserIds ?? []).filter(Boolean)),
    );
    const managerUsers = await this.loadManagerUsers(managerUserIds);

    const created = await this.prisma.$transaction(async (tx) => {
      const conflictResult =
        (payload.status ?? 'new') === 'cancelled'
          ? null
          : await this.checkScheduleConflicts(tx, currentUser, {
              executionStartDate: dateRange.executionStartDate,
              executionEndDate: dateRange.executionEndDate,
              managerUserIds,
              confirmScheduleConflicts: payload.confirmScheduleConflicts,
            });
      const order = await tx.oneTimeOrder.create({
        data: {
          title: payload.title.trim(),
          executionAddress: payload.executionAddress.trim(),
          linkedObjectId: payload.linkedObjectId ?? null,
          status: payload.status ?? 'new',
          description: payload.description?.trim() || null,
          executionDate: dateRange.executionStartDate,
          executionStartDate: dateRange.executionStartDate,
          executionEndDate: dateRange.executionEndDate,
          contactName: payload.contactName.trim(),
          contactPhone: payload.contactPhone?.trim() || null,
          agreedSum: payload.agreedSum ?? null,
          financialNotes: payload.financialNotes?.trim() || null,
          expenseNotes: payload.expenseNotes?.trim() || null,
          createdByUserId: currentUser.id,
          assignments: managerUsers.length
            ? {
                create: managerUsers.map((user) => ({
                  userId: user.id,
                  assignmentRoleCode: 'one_time_manager',
                  isActive: true,
                })),
              }
            : undefined,
        },
        include: this.getOrderInclude(),
      });

      await this.writeScheduleConflictOverrideAudit(tx, currentUser, order.id, {
        executionStartDate: dateRange.executionStartDate,
        executionEndDate: dateRange.executionEndDate,
        managerUserIds,
        conflictResult,
      });

      return order as OneTimeOrderView;
    });

    await this.auditService.writeAuditEvent({
      entityType: 'one_time_order',
      entityId: created.id,
      actorUserId: currentUser.id,
      action: 'one_time_order.created',
      newValues: {
        title: created.title,
        status: created.status,
        linkedObjectId: created.linkedObjectId,
      },
    });

    await this.chatsService.createSystemMessage(
      'one_time_orders',
      `Создан разовый заказ: ${created.title}`,
      {
        oneTimeOrderId: created.id,
        status: created.status,
        linkedObjectId: created.linkedObjectId,
      },
      currentUser.id,
    );
    await this.chatsService.createSystemMessage(
      'leadership',
      `Создан разовый заказ: ${created.title}`,
      {
        oneTimeOrderId: created.id,
        status: created.status,
        linkedObjectId: created.linkedObjectId,
      },
      currentUser.id,
    );

    return this.mapOrder(created, currentUser);
  }

  async updateOrder(
    currentUser: CurrentAuthUser,
    id: string,
    payload: UpdateOneTimeOrderDto,
  ): Promise<OneTimeOrderResponseDto> {
    const existing = await this.getOrderForWrite(currentUser, id);
    const capabilities = buildOneTimeOrderCapabilities({
      currentUserId: currentUser.id,
      roleCodes: this.getRoleCodes(currentUser),
      permissionCodes: this.getPermissionCodes(currentUser),
      order: existing,
    });

    const hasOperationalUpdate = [
      payload.title,
      payload.executionAddress,
      payload.description,
      payload.executionDate,
      payload.executionStartDate,
      payload.executionEndDate,
      payload.contactName,
      payload.contactPhone,
    ].some((value) => value !== undefined);
    const hasFinancialUpdate = [
      payload.agreedSum,
      payload.financialNotes,
      payload.expenseNotes,
    ].some((value) => value !== undefined);

    if (hasOperationalUpdate && !capabilities.canEditOperationalFields) {
      throw new ForbiddenException('One-time order operational edit denied');
    }

    if (hasFinancialUpdate && !capabilities.canEditFinancialFields) {
      throw new ForbiddenException('One-time order financial edit denied');
    }

    const isLinkedObjectChanging =
      payload.linkedObjectId !== undefined &&
      payload.linkedObjectId !== existing.linkedObjectId;

    if (isLinkedObjectChanging && !capabilities.canChangeLinkedObject) {
      throw new ForbiddenException('Linked object relinking denied');
    }

    await this.ensureLinkedObjectExists(payload.linkedObjectId ?? undefined);

    const hasDateRangeUpdate =
      payload.executionStartDate !== undefined ||
      payload.executionEndDate !== undefined ||
      payload.executionDate !== undefined;
    const dateRange = hasDateRangeUpdate
      ? normalizeOneTimeOrderDateRange({
          executionStartDate: payload.executionStartDate,
          executionEndDate: payload.executionEndDate,
          executionDate: payload.executionDate,
        })
      : null;

    const nextValues = {
      title: payload.title?.trim(),
      executionAddress: payload.executionAddress?.trim(),
      linkedObjectId:
        payload.linkedObjectId === undefined ? undefined : payload.linkedObjectId,
      description:
        payload.description === undefined ? undefined : payload.description?.trim() || null,
      executionDate: dateRange?.executionStartDate,
      executionStartDate: dateRange?.executionStartDate,
      executionEndDate: dateRange?.executionEndDate,
      contactName: payload.contactName?.trim(),
      contactPhone:
        payload.contactPhone === undefined ? undefined : payload.contactPhone?.trim() || null,
      agreedSum: payload.agreedSum,
      financialNotes:
        payload.financialNotes === undefined
          ? undefined
          : payload.financialNotes?.trim() || null,
      expenseNotes:
        payload.expenseNotes === undefined
          ? undefined
          : payload.expenseNotes?.trim() || null,
    };

    const managerUserIds = existing.assignments
      .filter(
        (assignment) =>
          assignment.assignmentRoleCode === 'one_time_manager' &&
          assignment.isActive,
      )
      .map((assignment) => assignment.userId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const conflictResult =
        hasDateRangeUpdate && existing.status !== 'cancelled'
          ? await this.checkScheduleConflicts(tx, currentUser, {
              executionStartDate: dateRange?.executionStartDate ?? null,
              executionEndDate: dateRange?.executionEndDate ?? null,
              managerUserIds,
              excludeOrderId: id,
              confirmScheduleConflicts: payload.confirmScheduleConflicts,
            })
          : null;
      const order = (await tx.oneTimeOrder.update({
        where: { id },
        data: {
          ...(nextValues.title !== undefined ? { title: nextValues.title } : {}),
          ...(nextValues.executionAddress !== undefined
            ? { executionAddress: nextValues.executionAddress }
            : {}),
          ...(nextValues.linkedObjectId !== undefined
            ? { linkedObjectId: nextValues.linkedObjectId }
            : {}),
          ...(nextValues.description !== undefined
            ? { description: nextValues.description }
            : {}),
          ...(nextValues.executionDate !== undefined
            ? { executionDate: nextValues.executionDate }
            : {}),
          ...(nextValues.executionStartDate !== undefined
            ? { executionStartDate: nextValues.executionStartDate }
            : {}),
          ...(nextValues.executionEndDate !== undefined
            ? { executionEndDate: nextValues.executionEndDate }
            : {}),
          ...(nextValues.contactName !== undefined
            ? { contactName: nextValues.contactName }
            : {}),
          ...(nextValues.contactPhone !== undefined
            ? { contactPhone: nextValues.contactPhone }
            : {}),
          ...(nextValues.agreedSum !== undefined
            ? { agreedSum: nextValues.agreedSum }
            : {}),
          ...(nextValues.financialNotes !== undefined
            ? { financialNotes: nextValues.financialNotes }
            : {}),
          ...(nextValues.expenseNotes !== undefined
            ? { expenseNotes: nextValues.expenseNotes }
            : {}),
        },
        include: this.getOrderInclude(),
      })) as OneTimeOrderView;

      await this.writeScheduleConflictOverrideAudit(tx, currentUser, id, {
        executionStartDate: dateRange?.executionStartDate ?? null,
        executionEndDate: dateRange?.executionEndDate ?? null,
        managerUserIds,
        conflictResult,
      });
      return order;
    });

    const changes = this.buildOrderChanges(existing, updated);

    if (Object.keys(changes).length > 0) {
      await this.auditService.writeAuditEvent({
        entityType: 'one_time_order',
        entityId: updated.id,
        actorUserId: currentUser.id,
        action: 'one_time_order.updated',
        metadata: {
          changes,
        },
      });
    }

    return this.mapOrder(updated, currentUser);
  }

  async updateReview(
    currentUser: CurrentAuthUser,
    id: string,
    payload: UpdateOneTimeOrderReviewDto,
  ): Promise<OneTimeOrderResponseDto> {
    const existing = await this.getOrderForReviewChange(currentUser, id);
    const reviewText = payload.reviewText?.trim() || null;
    const reviewRating = payload.reviewRating ?? null;

    if (reviewText === null && reviewRating === null) {
      throw new BadRequestException(
        'Review text or rating must be provided; use DELETE to clear review',
      );
    }

    const updated = (await this.prisma.oneTimeOrder.update({
      where: { id },
      data: {
        reviewText,
        reviewRating,
        reviewUpdatedAt: new Date(),
        reviewUpdatedByUserId: currentUser.id,
      },
      include: this.getOrderInclude(),
    })) as OneTimeOrderView;

    await this.auditService.writeAuditEvent({
      entityType: 'one_time_order',
      entityId: id,
      actorUserId: currentUser.id,
      action: 'one_time_order.review_updated',
      oldValues: {
        reviewText: existing.reviewText,
        reviewRating: existing.reviewRating,
      },
      newValues: {
        reviewText: updated.reviewText,
        reviewRating: updated.reviewRating,
      },
      metadata: {
        actorUserId: currentUser.id,
      },
    });

    return this.mapOrder(updated, currentUser);
  }

  async clearReview(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<OneTimeOrderResponseDto> {
    const existing = await this.getOrderForReviewChange(currentUser, id);
    const updated = (await this.prisma.oneTimeOrder.update({
      where: { id },
      data: {
        reviewText: null,
        reviewRating: null,
        reviewUpdatedAt: null,
        reviewUpdatedByUserId: null,
      },
      include: this.getOrderInclude(),
    })) as OneTimeOrderView;

    await this.auditService.writeAuditEvent({
      entityType: 'one_time_order',
      entityId: id,
      actorUserId: currentUser.id,
      action: 'one_time_order.review_cleared',
      oldValues: {
        reviewText: existing.reviewText,
        reviewRating: existing.reviewRating,
      },
      newValues: {
        reviewText: null,
        reviewRating: null,
      },
      metadata: {
        actorUserId: currentUser.id,
      },
    });

    return this.mapOrder(updated, currentUser);
  }

  async listSpecificationItems(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<OneTimeOrderSpecificationItemResponseDto[]> {
    await this.getOrderById(currentUser, id);
    const items = (await this.prisma.oneTimeOrderSpecificationItem.findMany({
      where: {
        oneTimeOrderId: id,
        deletedAt: null,
      },
      include: this.getSpecificationItemInclude(),
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })) as OneTimeOrderSpecificationItemView[];
    const attachments = await this.listAttachmentsByEntityIds(
      'one_time_order_specification_item',
      items.map((item) => item.id),
    );

    return items.map((item) =>
      this.mapSpecificationItem(item, attachments.get(item.id) ?? []),
    );
  }

  async createSpecificationItem(
    currentUser: CurrentAuthUser,
    id: string,
    payload: CreateOneTimeOrderSpecificationItemDto,
  ): Promise<OneTimeOrderSpecificationItemResponseDto> {
    await this.getOrderForSpecificationWrite(currentUser, id);
    const title = payload.title.trim();

    if (!title) {
      throw new BadRequestException('Specification item title is required');
    }

    const item = await this.prisma.$transaction(async (transaction) => {
      const lastItem = await transaction.oneTimeOrderSpecificationItem.findFirst({
        where: { oneTimeOrderId: id, deletedAt: null },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });

      return transaction.oneTimeOrderSpecificationItem.create({
        data: {
          oneTimeOrderId: id,
          title,
          description: payload.description?.trim() || null,
          sortOrder: (lastItem?.sortOrder ?? -1) + 1,
          requiresAttachment: payload.requiresAttachment ?? false,
          createdByUserId: currentUser.id,
        },
        include: this.getSpecificationItemInclude(),
      });
    });

    await this.writeSpecificationAudit(
      id,
      currentUser.id,
      'one_time_order.specification_item_created',
      item.id,
      null,
      {
        title: item.title,
        description: item.description,
        requiresAttachment: item.requiresAttachment,
        sortOrder: item.sortOrder,
      },
    );

    return this.mapSpecificationItem(
      item as OneTimeOrderSpecificationItemView,
      [],
    );
  }

  async updateSpecificationItem(
    currentUser: CurrentAuthUser,
    id: string,
    itemId: string,
    payload: UpdateOneTimeOrderSpecificationItemDto,
  ): Promise<OneTimeOrderSpecificationItemResponseDto> {
    await this.getOrderForSpecificationWrite(currentUser, id);
    const existing = await this.getSpecificationItem(id, itemId);
    const title = payload.title === undefined ? existing.title : payload.title.trim();
    const description =
      payload.description === undefined
        ? existing.description
        : payload.description?.trim() || null;
    const requiresAttachment =
      payload.requiresAttachment ?? existing.requiresAttachment;

    if (!title) {
      throw new BadRequestException('Specification item title is required');
    }

    const hasMeaningfulChanges =
      title !== existing.title ||
      description !== existing.description ||
      requiresAttachment !== existing.requiresAttachment;

    if (
      existing.isCompleted &&
      hasMeaningfulChanges &&
      payload.reopenCompleted !== true
    ) {
      throw new ConflictException(
        'Completed specification item must be explicitly reopened before editing',
      );
    }

    const updated = (await this.prisma.oneTimeOrderSpecificationItem.update({
      where: { id: itemId },
      data: {
        title,
        description,
        requiresAttachment,
        ...(existing.isCompleted && hasMeaningfulChanges
          ? {
              isCompleted: false,
              completedAt: null,
              completedByUserId: null,
            }
          : {}),
      },
      include: this.getSpecificationItemInclude(),
    })) as OneTimeOrderSpecificationItemView;

    await this.writeSpecificationAudit(
      id,
      currentUser.id,
      'one_time_order.specification_item_updated',
      itemId,
      this.specificationAuditValues(existing),
      this.specificationAuditValues(updated),
    );

    return this.mapSpecificationItem(
      updated,
      await this.listSpecificationItemAttachments(itemId),
    );
  }

  async deleteSpecificationItem(
    currentUser: CurrentAuthUser,
    id: string,
    itemId: string,
  ): Promise<OneTimeOrderSpecificationItemResponseDto> {
    await this.getOrderForSpecificationWrite(currentUser, id);
    const existing = await this.getSpecificationItem(id, itemId);
    const deleted = (await this.prisma.oneTimeOrderSpecificationItem.update({
      where: { id: itemId },
      data: {
        deletedAt: new Date(),
        deletedByUserId: currentUser.id,
      },
      include: this.getSpecificationItemInclude(),
    })) as OneTimeOrderSpecificationItemView;

    await this.writeSpecificationAudit(
      id,
      currentUser.id,
      'one_time_order.specification_item_deleted',
      itemId,
      this.specificationAuditValues(existing),
      null,
    );

    return this.mapSpecificationItem(
      deleted,
      await this.listSpecificationItemAttachments(itemId),
    );
  }

  async completeSpecificationItem(
    currentUser: CurrentAuthUser,
    id: string,
    itemId: string,
  ): Promise<OneTimeOrderSpecificationItemResponseDto> {
    await this.getOrderForSpecificationWrite(currentUser, id);
    const existing = await this.getSpecificationItem(id, itemId);

    if (existing.requiresAttachment) {
      const attachmentCount = await this.prisma.fileAttachment.count({
        where: {
          entityType: 'one_time_order_specification_item',
          entityId: itemId,
          file: { deletedAt: null },
        },
      });

      if (attachmentCount === 0) {
        throw new ConflictException(
          'Specification item requires at least one attachment',
        );
      }
    }

    const completed = (await this.prisma.oneTimeOrderSpecificationItem.update({
      where: { id: itemId },
      data: {
        isCompleted: true,
        completedAt: new Date(),
        completedByUserId: currentUser.id,
      },
      include: this.getSpecificationItemInclude(),
    })) as OneTimeOrderSpecificationItemView;

    await this.writeSpecificationAudit(
      id,
      currentUser.id,
      'one_time_order.specification_item_completed',
      itemId,
      this.specificationAuditValues(existing),
      this.specificationAuditValues(completed),
    );

    return this.mapSpecificationItem(
      completed,
      await this.listSpecificationItemAttachments(itemId),
    );
  }

  async reopenSpecificationItem(
    currentUser: CurrentAuthUser,
    id: string,
    itemId: string,
  ): Promise<OneTimeOrderSpecificationItemResponseDto> {
    await this.getOrderForSpecificationWrite(currentUser, id);
    const existing = await this.getSpecificationItem(id, itemId);
    const reopened = (await this.prisma.oneTimeOrderSpecificationItem.update({
      where: { id: itemId },
      data: {
        isCompleted: false,
        completedAt: null,
        completedByUserId: null,
      },
      include: this.getSpecificationItemInclude(),
    })) as OneTimeOrderSpecificationItemView;

    await this.writeSpecificationAudit(
      id,
      currentUser.id,
      'one_time_order.specification_item_reopened',
      itemId,
      this.specificationAuditValues(existing),
      this.specificationAuditValues(reopened),
    );

    return this.mapSpecificationItem(
      reopened,
      await this.listSpecificationItemAttachments(itemId),
    );
  }

  async reorderSpecificationItems(
    currentUser: CurrentAuthUser,
    id: string,
    payload: ReorderOneTimeOrderSpecificationItemsDto,
  ): Promise<OneTimeOrderSpecificationItemResponseDto[]> {
    await this.getOrderForSpecificationWrite(currentUser, id);
    const existing = await this.prisma.oneTimeOrderSpecificationItem.findMany({
      where: { oneTimeOrderId: id, deletedAt: null },
      select: { id: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });
    const existingIds = existing.map((item) => item.id).sort();
    const requestedIds = [...payload.itemIds].sort();

    if (
      existingIds.length !== requestedIds.length ||
      existingIds.some((itemId, index) => itemId !== requestedIds[index])
    ) {
      throw new BadRequestException(
        'Reorder payload must contain every active specification item exactly once',
      );
    }

    await this.prisma.$transaction(async (transaction) => {
      for (const [index, itemId] of payload.itemIds.entries()) {
        await transaction.oneTimeOrderSpecificationItem.update({
          where: { id: itemId },
          data: { sortOrder: -index - 1 },
        });
      }

      for (const [index, itemId] of payload.itemIds.entries()) {
        await transaction.oneTimeOrderSpecificationItem.update({
          where: { id: itemId },
          data: { sortOrder: index },
        });
      }
    });

    await this.auditService.writeAuditEvent({
      entityType: 'one_time_order',
      entityId: id,
      actorUserId: currentUser.id,
      action: 'one_time_order.specification_reordered',
      metadata: {
        previousOrder: existing.map((item) => item.id),
        nextOrder: payload.itemIds,
      },
    });

    return this.listSpecificationItems(currentUser, id);
  }

  async changeStatus(
    currentUser: CurrentAuthUser,
    id: string,
    payload: ChangeOneTimeOrderStatusDto,
  ): Promise<OneTimeOrderResponseDto> {
    const existing = await this.getOrderForWrite(currentUser, id);
    const capabilities = buildOneTimeOrderCapabilities({
      currentUserId: currentUser.id,
      roleCodes: this.getRoleCodes(currentUser),
      permissionCodes: this.getPermissionCodes(currentUser),
      order: existing,
    });

    if (!capabilities.canChangeStatus) {
      throw new ForbiddenException('One-time order status change denied');
    }

    if (existing.status === payload.status) {
      return this.mapOrder(existing, currentUser);
    }

    const managerUserIds = existing.assignments
      .filter(
        (assignment) =>
          assignment.assignmentRoleCode === 'one_time_manager' &&
          assignment.isActive,
      )
      .map((assignment) => assignment.userId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const conflictResult =
        existing.status === 'cancelled' && payload.status !== 'cancelled'
          ? await this.checkScheduleConflicts(tx, currentUser, {
              executionStartDate: existing.executionStartDate,
              executionEndDate: existing.executionEndDate,
              managerUserIds,
              excludeOrderId: id,
              confirmScheduleConflicts: payload.confirmScheduleConflicts,
            })
          : null;
      const order = (await tx.oneTimeOrder.update({
        where: { id },
        data: {
          status: payload.status,
        },
        include: this.getOrderInclude(),
      })) as OneTimeOrderView;

      await this.writeScheduleConflictOverrideAudit(tx, currentUser, id, {
        executionStartDate: existing.executionStartDate,
        executionEndDate: existing.executionEndDate,
        managerUserIds,
        conflictResult,
      });
      return order;
    });

    await this.auditService.writeAuditEvent({
      entityType: 'one_time_order',
      entityId: updated.id,
      actorUserId: currentUser.id,
      action: 'one_time_order.status_changed',
      oldValues: {
        status: existing.status,
      },
      newValues: {
        status: updated.status,
      },
    });

    return this.mapOrder(updated, currentUser);
  }

  async assignManager(
    currentUser: CurrentAuthUser,
    id: string,
    payload: AssignOneTimeOrderManagerDto,
  ): Promise<OneTimeOrderResponseDto> {
    const order = await this.getOrderForManagerChange(currentUser, id);
    const [manager] = await this.loadManagerUsers([payload.userId]);

    if (!manager) {
      throw new NotFoundException('Selected one-time order manager not found');
    }

    await this.prisma.$transaction(async (tx) => {
      const conflictResult =
        order.status === 'cancelled'
          ? null
          : await this.checkScheduleConflicts(tx, currentUser, {
              executionStartDate: order.executionStartDate,
              executionEndDate: order.executionEndDate,
              managerUserIds: [manager.id],
              excludeOrderId: id,
              confirmScheduleConflicts: payload.confirmScheduleConflicts,
            });
      await tx.oneTimeOrderAssignment.upsert({
        where: {
          oneTimeOrderId_userId_assignmentRoleCode: {
            oneTimeOrderId: id,
            userId: manager.id,
            assignmentRoleCode: 'one_time_manager',
          },
        },
        update: {
          isActive: true,
        },
        create: {
          oneTimeOrderId: id,
          userId: manager.id,
          assignmentRoleCode: 'one_time_manager',
          isActive: true,
        },
      });
      await this.writeScheduleConflictOverrideAudit(tx, currentUser, id, {
        executionStartDate: order.executionStartDate,
        executionEndDate: order.executionEndDate,
        managerUserIds: [manager.id],
        conflictResult,
      });
    });

    await this.auditService.writeAuditEvent({
      entityType: 'one_time_order',
      entityId: id,
      actorUserId: currentUser.id,
      action: 'one_time_order.manager_added',
      metadata: {
        managerUserId: manager.id,
        managerFullName: manager.fullName,
      },
    });

    return this.getOrderById(currentUser, id);
  }

  async removeManager(
    currentUser: CurrentAuthUser,
    id: string,
    userId: string,
  ): Promise<OneTimeOrderResponseDto> {
    await this.getOrderForManagerChange(currentUser, id);

    const result = await this.prisma.oneTimeOrderAssignment.updateMany({
      where: {
        oneTimeOrderId: id,
        userId,
        assignmentRoleCode: 'one_time_manager',
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });

    if (result.count === 0) {
      throw new NotFoundException('One-time order manager assignment not found');
    }

    await this.auditService.writeAuditEvent({
      entityType: 'one_time_order',
      entityId: id,
      actorUserId: currentUser.id,
      action: 'one_time_order.manager_removed',
      metadata: {
        managerUserId: userId,
      },
    });

    return this.getOrderById(currentUser, id);
  }

  async listComments(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<OneTimeOrderCommentResponseDto[]> {
    await this.getOrderById(currentUser, id);

    const items = await this.prisma.oneTimeOrderComment.findMany({
      where: {
        oneTimeOrderId: id,
      },
      include: {
        createdBy: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
    });

    const attachmentsMap = await this.listAttachmentsByEntityIds(
      'one_time_order_comment',
      items.map((item) => item.id),
    );

    return items.map((item) =>
      this.mapComment(item, attachmentsMap.get(item.id) ?? []),
    );
  }

  async createComment(
    currentUser: CurrentAuthUser,
    id: string,
    payload: CreateOneTimeOrderCommentDto,
  ): Promise<OneTimeOrderCommentResponseDto> {
    const order = await this.getOrderForWrite(currentUser, id);
    const capabilities = buildOneTimeOrderCapabilities({
      currentUserId: currentUser.id,
      roleCodes: this.getRoleCodes(currentUser),
      permissionCodes: this.getPermissionCodes(currentUser),
      order,
    });

    if (!capabilities.canComment) {
      throw new ForbiddenException('One-time order comment creation denied');
    }

    const created = await this.prisma.oneTimeOrderComment.create({
      data: {
        oneTimeOrderId: id,
        content: payload.content.trim(),
        commentType: payload.commentType?.trim() || 'manual',
        createdByUserId: currentUser.id,
      },
      include: {
        createdBy: true,
      },
    });

    await this.auditService.writeAuditEvent({
      entityType: 'one_time_order',
      entityId: id,
      actorUserId: currentUser.id,
      action: 'one_time_order.comment_created',
      metadata: {
        commentId: created.id,
        commentType: created.commentType,
      },
    });

    return this.mapComment(created, []);
  }

  async getTodayDailyReport(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<OneTimeOrderDailyReportResponseDto | null> {
    await this.getOrderById(currentUser, id);

    const item = (await this.prisma.oneTimeOrderDailyReport.findUnique({
      where: {
        oneTimeOrderId_reportDate: {
          oneTimeOrderId: id,
          reportDate: this.startOfToday(),
        },
      },
      include: {
        updatedBy: true,
      },
    })) as OneTimeOrderDailyReportView | null;

    if (!item) {
      return null;
    }

    const attachmentsMap = await this.listAttachmentsByEntityIds(
      'one_time_order_daily_report',
      [item.id],
    );

    return this.mapDailyReport(item, attachmentsMap.get(item.id) ?? []);
  }

  async upsertTodayDailyReport(
    currentUser: CurrentAuthUser,
    id: string,
    payload: UpsertOneTimeOrderDailyReportDto,
  ): Promise<OneTimeOrderDailyReportResponseDto> {
    await this.getOrderForWrite(currentUser, id);

    const item = (await this.prisma.oneTimeOrderDailyReport.upsert({
      where: {
        oneTimeOrderId_reportDate: {
          oneTimeOrderId: id,
          reportDate: this.startOfToday(),
        },
      },
      update: {
        content: payload.content,
        updatedByUserId: currentUser.id,
      },
      create: {
        oneTimeOrderId: id,
        reportDate: this.startOfToday(),
        content: payload.content,
        updatedByUserId: currentUser.id,
      },
      include: {
        updatedBy: true,
      },
    })) as OneTimeOrderDailyReportView;

    await this.auditService.writeAuditEvent({
      entityType: 'one_time_order',
      entityId: id,
      actorUserId: currentUser.id,
      action: 'one_time_order.daily_report_upserted',
      metadata: {
        reportId: item.id,
        reportDate: item.reportDate.toISOString(),
      },
    });

    return this.mapDailyReport(item, []);
  }

  async listPhotos(
    currentUser: CurrentAuthUser,
    id: string,
    includeDeleted = false,
  ): Promise<OneTimeOrderPhotoResponseDto[]> {
    const order = await this.getOrderById(currentUser, id);
    const canIncludeDeleted =
      includeDeleted && order.capabilities.canRestorePhotos;

    const items = (await this.prisma.oneTimeOrderPhoto.findMany({
      where: {
        oneTimeOrderId: id,
        ...(!canIncludeDeleted ? { deletedAt: null } : {}),
      },
      include: {
        createdBy: true,
        deletedBy: true,
        restoredBy: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 100,
    })) as OneTimeOrderPhotoView[];

    const attachmentsMap = await this.listAttachmentsByEntityIds(
      'one_time_order_photo',
      items.filter((item) => !item.deletedAt).map((item) => item.id),
    );

    return items.map((item) =>
      this.mapPhoto(item, attachmentsMap.get(item.id) ?? [], {
        canDelete:
          !item.deletedAt &&
          (order.capabilities.canDeletePhotos ||
            (item.createdBy.id === currentUser.id &&
              order.capabilities.canUploadPhotos)),
        canRestore:
          !!item.deletedAt && order.capabilities.canRestorePhotos,
      }),
    );
  }

  async createPhoto(
    currentUser: CurrentAuthUser,
    id: string,
    payload: CreateOneTimeOrderPhotoDto,
  ): Promise<OneTimeOrderPhotoResponseDto> {
    const order = await this.getOrderForWrite(currentUser, id);
    const capabilities = buildOneTimeOrderCapabilities({
      currentUserId: currentUser.id,
      roleCodes: this.getRoleCodes(currentUser),
      permissionCodes: this.getPermissionCodes(currentUser),
      order,
    });

    if (!capabilities.canUploadPhotos) {
      throw new ForbiddenException('One-time order photo upload denied');
    }

    const item = (await this.prisma.oneTimeOrderPhoto.create({
      data: {
        oneTimeOrderId: id,
        photoCategory: payload.category,
        comment: payload.comment?.trim() || null,
        createdByUserId: currentUser.id,
      },
      include: {
        createdBy: true,
        deletedBy: true,
        restoredBy: true,
      },
    })) as OneTimeOrderPhotoView;

    await this.auditService.writeAuditEvent({
      entityType: 'one_time_order',
      entityId: id,
      actorUserId: currentUser.id,
      action: 'one_time_order.photo_created',
      metadata: {
        photoId: item.id,
        category: item.photoCategory,
      },
    });

    return this.mapPhoto(item, [], {
      canDelete: capabilities.canDeletePhotos || item.createdBy.id === currentUser.id,
      canRestore: false,
    });
  }

  async deletePhoto(
    currentUser: CurrentAuthUser,
    id: string,
    photoId: string,
    payload: DeleteOneTimeOrderPhotoDto,
  ): Promise<OneTimeOrderPhotoResponseDto> {
    const order = await this.getOrderForWrite(currentUser, id);
    const capabilities = buildOneTimeOrderCapabilities({
      currentUserId: currentUser.id,
      roleCodes: this.getRoleCodes(currentUser),
      permissionCodes: this.getPermissionCodes(currentUser),
      order,
    });
    const existing = await this.getPhoto(id, photoId);
    const canDelete =
      capabilities.canDeletePhotos ||
      (existing.createdBy.id === currentUser.id && capabilities.canUploadPhotos);

    if (!canDelete) {
      throw new ForbiddenException('One-time order photo delete denied');
    }

    if (existing.deletedAt) {
      return this.mapPhoto(existing, [], {
        canDelete: false,
        canRestore: capabilities.canRestorePhotos,
      });
    }

    const deleteReason = payload.reason?.trim() || null;
    const item = (await this.prisma.oneTimeOrderPhoto.update({
      where: { id: photoId },
      data: {
        deletedAt: new Date(),
        deletedByUserId: currentUser.id,
        deleteReason,
        restoredAt: null,
        restoredByUserId: null,
      },
      include: {
        createdBy: true,
        deletedBy: true,
        restoredBy: true,
      },
    })) as OneTimeOrderPhotoView;

    await this.auditService.writeAuditEvent({
      entityType: 'one_time_order',
      entityId: id,
      actorUserId: currentUser.id,
      action: 'one_time_order.photo_deleted',
      metadata: {
        photoId,
        deleteReason,
      },
    });

    return this.mapPhoto(item, [], {
      canDelete: false,
      canRestore: capabilities.canRestorePhotos,
    });
  }

  async restorePhoto(
    currentUser: CurrentAuthUser,
    id: string,
    photoId: string,
  ): Promise<OneTimeOrderPhotoResponseDto> {
    const order = await this.getOrderForWrite(currentUser, id);
    const capabilities = buildOneTimeOrderCapabilities({
      currentUserId: currentUser.id,
      roleCodes: this.getRoleCodes(currentUser),
      permissionCodes: this.getPermissionCodes(currentUser),
      order,
    });

    if (!capabilities.canRestorePhotos) {
      throw new ForbiddenException('One-time order photo restore denied');
    }

    const existing = await this.getPhoto(id, photoId);

    if (!existing.deletedAt) {
      const attachments = await this.getPhotoAttachments(photoId);
      return this.mapPhoto(existing, attachments, {
        canDelete: capabilities.canDeletePhotos,
        canRestore: false,
      });
    }

    const item = (await this.prisma.oneTimeOrderPhoto.update({
      where: { id: photoId },
      data: {
        deletedAt: null,
        deletedByUserId: null,
        deleteReason: null,
        restoredAt: new Date(),
        restoredByUserId: currentUser.id,
      },
      include: {
        createdBy: true,
        deletedBy: true,
        restoredBy: true,
      },
    })) as OneTimeOrderPhotoView;

    await this.auditService.writeAuditEvent({
      entityType: 'one_time_order',
      entityId: id,
      actorUserId: currentUser.id,
      action: 'one_time_order.photo_restored',
      metadata: {
        photoId,
        previousDeleteReason: existing.deleteReason,
      },
    });

    return this.mapPhoto(item, await this.getPhotoAttachments(photoId), {
      canDelete: capabilities.canDeletePhotos,
      canRestore: false,
    });
  }

  async listHistory(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<OneTimeOrderAuditLogResponseDto[]> {
    await this.getOrderById(currentUser, id);
    const items = await this.auditService.listAuditEvents('one_time_order', id);

    return items.map((item) => ({
      id: item.id,
      entityType: item.entityType,
      entityId: item.entityId,
      action: item.action,
      createdAt: item.createdAt.toISOString(),
      actor: item.actor
        ? {
            id: item.actor.id,
            login: item.actor.login,
            fullName: item.actor.fullName,
          }
        : null,
      oldValues:
        item.oldValues && typeof item.oldValues === 'object'
          ? (item.oldValues as Record<string, unknown>)
          : null,
      newValues:
        item.newValues && typeof item.newValues === 'object'
          ? (item.newValues as Record<string, unknown>)
          : null,
      metadata:
        item.metadata && typeof item.metadata === 'object'
          ? (item.metadata as Record<string, unknown>)
          : null,
    }));
  }

  async listTasks(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<TaskResponseDto[]> {
    await this.getOrderById(currentUser, id);
    return this.tasksService.listTasksByOneTimeOrder(currentUser, id);
  }

  async listEquipment(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<EquipmentScopeResponseDto> {
    await this.getOrderById(currentUser, id);
    return this.equipmentService.listOneTimeOrderEquipment(currentUser, id);
  }

  private async checkScheduleConflicts(
    tx: Prisma.TransactionClient,
    currentUser: CurrentAuthUser,
    input: ScheduleConflictCheckInput,
  ): Promise<OneTimeOrderConflictResponseDto | null> {
    if (
      !input.executionStartDate ||
      !input.executionEndDate ||
      input.managerUserIds.length === 0
    ) {
      return null;
    }

    const result = await this.oneTimeOrderConflictService.checkConflicts(
      currentUser,
      {
        executionStartDate: formatBusinessDate(input.executionStartDate)!,
        executionEndDate: formatBusinessDate(input.executionEndDate)!,
        managerUserIds: [...new Set(input.managerUserIds)],
        excludeOrderId: input.excludeOrderId,
      },
      {
        db: tx,
        lockManagerSchedules: true,
      },
    );

    if (result.hasConflicts && !input.confirmScheduleConflicts) {
      throw new ConflictException({
        message: 'Schedule conflicts require confirmation',
        hasConflicts: result.hasConflicts,
        conflicts: result.conflicts,
      });
    }

    return result;
  }

  private async writeScheduleConflictOverrideAudit(
    tx: Prisma.TransactionClient,
    currentUser: CurrentAuthUser,
    orderId: string,
    input: ScheduleConflictAuditInput,
  ): Promise<void> {
    if (!input.conflictResult?.hasConflicts) {
      return;
    }

    await tx.auditEvent.create({
      data: {
        entityType: 'one_time_order',
        entityId: orderId,
        actorUserId: currentUser.id,
        action: 'one_time_order.schedule_conflict_overridden',
        metadata: {
          executionStartDate: formatBusinessDate(input.executionStartDate),
          executionEndDate: formatBusinessDate(input.executionEndDate),
          managerUserIds: [...new Set(input.managerUserIds)],
          conflicts: input.conflictResult.conflicts as unknown as Prisma.InputJsonArray,
          actorUserId: currentUser.id,
        } as Prisma.InputJsonObject,
      },
    });
  }

  private async getOrderForWrite(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<OneTimeOrderView> {
    const order = (await this.prisma.oneTimeOrder.findFirst({
      where: { id },
      include: this.getOrderInclude(),
    })) as OneTimeOrderView | null;

    if (!order) {
      throw new NotFoundException('One-time order not found');
    }

    const roleCodes = this.getRoleCodes(currentUser);
    const capabilities = buildOneTimeOrderCapabilities({
      currentUserId: currentUser.id,
      roleCodes,
      permissionCodes: this.getPermissionCodes(currentUser),
      order,
    });

    if (!capabilities.canEdit) {
      throw new ForbiddenException('One-time order edit denied');
    }

    return order;
  }

  private async getPhoto(
    oneTimeOrderId: string,
    photoId: string,
  ): Promise<OneTimeOrderPhotoView> {
    const item = (await this.prisma.oneTimeOrderPhoto.findFirst({
      where: {
        id: photoId,
        oneTimeOrderId,
      },
      include: {
        createdBy: true,
        deletedBy: true,
        restoredBy: true,
      },
    })) as OneTimeOrderPhotoView | null;

    if (!item) {
      throw new NotFoundException('One-time order photo not found');
    }

    return item;
  }

  private async getPhotoAttachments(photoId: string): Promise<FileResponseDto[]> {
    const map = await this.listAttachmentsByEntityIds('one_time_order_photo', [
      photoId,
    ]);
    return map.get(photoId) ?? [];
  }

  private async getOrderForReviewChange(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<OneTimeOrderView> {
    const order = (await this.prisma.oneTimeOrder.findFirst({
      where: {
        id,
        ...(await this.buildVisibilityWhere(currentUser)),
      },
      include: this.getOrderInclude(),
    })) as OneTimeOrderView | null;

    if (!order) {
      throw new NotFoundException('One-time order not found');
    }

    const capabilities = buildOneTimeOrderCapabilities({
      currentUserId: currentUser.id,
      roleCodes: this.getRoleCodes(currentUser),
      permissionCodes: this.getPermissionCodes(currentUser),
      order,
    });

    if (!capabilities.canEditReview) {
      throw new ForbiddenException('One-time order review edit denied');
    }

    return order;
  }

  private async getOrderForSpecificationWrite(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<OneTimeOrderView> {
    const order = await this.getOrderForWrite(currentUser, id);
    const capabilities = buildOneTimeOrderCapabilities({
      currentUserId: currentUser.id,
      roleCodes: this.getRoleCodes(currentUser),
      permissionCodes: this.getPermissionCodes(currentUser),
      order,
    });

    if (!capabilities.canManageSpecification) {
      throw new ForbiddenException('One-time order specification edit denied');
    }

    if (order.status === 'completed' || order.status === 'cancelled') {
      throw new ConflictException(
        'One-time order specification is read-only in the current status',
      );
    }

    return order;
  }

  private async getSpecificationItem(
    oneTimeOrderId: string,
    itemId: string,
  ): Promise<OneTimeOrderSpecificationItemView> {
    const item = (await this.prisma.oneTimeOrderSpecificationItem.findFirst({
      where: {
        id: itemId,
        oneTimeOrderId,
        deletedAt: null,
      },
      include: this.getSpecificationItemInclude(),
    })) as OneTimeOrderSpecificationItemView | null;

    if (!item) {
      throw new NotFoundException('One-time order specification item not found');
    }

    return item;
  }

  private async getOrderForManagerChange(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<OneTimeOrderView> {
    const order = (await this.prisma.oneTimeOrder.findFirst({
      where: { id },
      include: this.getOrderInclude(),
    })) as OneTimeOrderView | null;

    if (!order) {
      throw new NotFoundException('One-time order not found');
    }

    const capabilities = buildOneTimeOrderCapabilities({
      currentUserId: currentUser.id,
      roleCodes: this.getRoleCodes(currentUser),
      permissionCodes: this.getPermissionCodes(currentUser),
      order,
    });

    if (!capabilities.canManageManagers) {
      throw new ForbiddenException('One-time order manager management denied');
    }

    return order;
  }

  private async buildVisibilityWhere(currentUser: CurrentAuthUser) {
    const roleCodes = this.getRoleCodes(currentUser);

    if (
      hasWideOneTimeOrderAccess(roleCodes) ||
      canManageOneTimeOrderManagers(
        roleCodes,
        this.getPermissionCodes(currentUser),
      )
    ) {
      return {};
    }

    return {
      OR: [
        { createdByUserId: currentUser.id },
        {
          assignments: {
            some: {
              userId: currentUser.id,
              isActive: true,
              assignmentRoleCode: 'one_time_manager',
            },
          },
        },
      ],
    };
  }

  private async ensureLinkedObjectExists(
    linkedObjectId: string | null | undefined,
  ): Promise<void> {
    if (!linkedObjectId) {
      return;
    }

    const object = await this.prisma.object.findFirst({
      where: {
        id: linkedObjectId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!object) {
      throw new NotFoundException('Linked object not found');
    }
  }

  private async loadManagerUsers(userIds: string[]) {
    if (userIds.length === 0) {
      return [];
    }

    const users = await this.prisma.user.findMany({
      where: {
        id: { in: userIds },
        deletedAt: null,
        isActive: true,
      },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (users.length !== userIds.length) {
      throw new NotFoundException('One or more selected one-time managers were not found');
    }

    for (const user of users) {
      const roleCodes = user.roles.map((item) => item.role.code);

      if (!canBeOneTimeOrderManager(roleCodes)) {
        throw new ForbiddenException('Selected user cannot be one-time order manager');
      }
    }

    return users;
  }

  private getOrderInclude() {
    return {
      createdBy: {
        select: {
          id: true,
          login: true,
          fullName: true,
        },
      },
      reviewUpdatedBy: {
        select: {
          id: true,
          login: true,
          fullName: true,
        },
      },
      linkedObject: {
        select: {
          id: true,
          name: true,
          createdByUserId: true,
          assignments: {
            where: {
              isActive: true,
            },
            select: {
              userId: true,
              isActive: true,
            },
          },
        },
      },
      assignments: {
        where: {
          isActive: true,
        },
        include: {
          user: {
            include: {
              roles: {
                include: {
                  role: true,
                },
              },
            },
          },
        },
      },
    };
  }

  private getSpecificationItemInclude() {
    return {
      completedBy: {
        select: {
          id: true,
          login: true,
          fullName: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          login: true,
          fullName: true,
        },
      },
    };
  }

  private mapOrderListItem(
    order: OneTimeOrderListView,
    currentUser: CurrentAuthUser,
    accessibleTaskCount: number,
  ): OneTimeOrderListItemResponseDto {
    const roleCodes = this.getRoleCodes(currentUser);
    const executionStartDate =
      order.executionStartDate ?? order.executionDate;
    const executionEndDate = order.executionEndDate ?? executionStartDate;
    const specificationCompleted = order.specificationItems.filter(
      (item) => item.isCompleted,
    ).length;
    const reviewPreview = order.reviewText?.trim() || null;

    return {
      id: order.id,
      title: order.title,
      executionStartDate: formatBusinessDate(executionStartDate),
      executionEndDate: formatBusinessDate(executionEndDate),
      durationDays: getOneTimeOrderDurationDays(
        executionStartDate,
        executionEndDate,
      ),
      status: order.status,
      executionAddress: order.executionAddress,
      linkedObject: order.linkedObject
        ? {
            id: order.linkedObject.id,
            name: order.linkedObject.name,
            canOpenObjectCard: canOpenLinkedObjectCard({
              currentUserId: currentUser.id,
              roleCodes,
              linkedObject: order.linkedObject,
            }),
          }
        : null,
      managers: order.assignments
        .filter(
          (assignment) =>
            assignment.assignmentRoleCode === 'one_time_manager',
        )
        .map((assignment) => ({
          userId: assignment.user.id,
          login: assignment.user.login,
          fullName: assignment.user.fullName,
          roleCode: assignment.user.roles[0]?.role.code ?? 'unknown',
        })),
      contact: {
        name: order.contactName,
        phone: order.contactPhone,
      },
      reviewRating: order.reviewRating,
      reviewPreview:
        reviewPreview && reviewPreview.length > 200
          ? `${reviewPreview.slice(0, 200)}…`
          : reviewPreview,
      specificationProgress: {
        completed: specificationCompleted,
        total: order.specificationItems.length,
      },
      accessibleTaskCount,
      capabilities: buildOneTimeOrderCapabilities({
        currentUserId: currentUser.id,
        roleCodes,
        permissionCodes: this.getPermissionCodes(currentUser),
        order,
      }),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }

  private mapOrder(
    order: OneTimeOrderView,
    currentUser: CurrentAuthUser,
  ): OneTimeOrderResponseDto {
    const roleCodes = this.getRoleCodes(currentUser);
    const capabilities = buildOneTimeOrderCapabilities({
      currentUserId: currentUser.id,
      roleCodes,
      permissionCodes: this.getPermissionCodes(currentUser),
      order,
    });

    const executionStartDate =
      order.executionStartDate ?? order.executionDate;
    const executionEndDate = order.executionEndDate ?? executionStartDate;

    return {
      id: order.id,
      title: order.title,
      executionAddress: order.executionAddress,
      status: order.status,
      description: order.description,
      executionDate: formatBusinessDate(executionStartDate),
      executionStartDate: formatBusinessDate(executionStartDate),
      executionEndDate: formatBusinessDate(executionEndDate),
      durationDays: getOneTimeOrderDurationDays(
        executionStartDate,
        executionEndDate,
      ),
      contactName: order.contactName,
      contactPhone: order.contactPhone,
      agreedSum: order.agreedSum,
      financialNotes: order.financialNotes,
      expenseNotes: order.expenseNotes,
      reviewText: order.reviewText,
      reviewRating: order.reviewRating,
      reviewUpdatedAt: order.reviewUpdatedAt?.toISOString() ?? null,
      reviewUpdatedBy: order.reviewUpdatedBy
        ? {
            id: order.reviewUpdatedBy.id,
            login: order.reviewUpdatedBy.login,
            fullName: order.reviewUpdatedBy.fullName,
          }
        : null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      createdBy: {
        id: order.createdBy.id,
        login: order.createdBy.login,
        fullName: order.createdBy.fullName,
      },
      linkedObject: order.linkedObject
        ? {
            id: order.linkedObject.id,
            name: order.linkedObject.name,
            canOpenObjectCard: canOpenLinkedObjectCard({
              currentUserId: currentUser.id,
              roleCodes,
              linkedObject: order.linkedObject,
            }),
          }
        : null,
      managers: order.assignments
        .filter((assignment) => assignment.assignmentRoleCode === 'one_time_manager')
        .map((assignment) => ({
          userId: assignment.user.id,
          fullName: assignment.user.fullName,
          roleCode: assignment.user.roles[0]?.role.code ?? 'unknown',
        })),
      capabilities,
    };
  }

  private mapSpecificationItem(
    item: OneTimeOrderSpecificationItemView,
    attachments: FileResponseDto[],
  ): OneTimeOrderSpecificationItemResponseDto {
    return {
      id: item.id,
      oneTimeOrderId: item.oneTimeOrderId,
      title: item.title,
      description: item.description,
      sortOrder: item.sortOrder,
      requiresAttachment: item.requiresAttachment,
      isCompleted: item.isCompleted,
      completedAt: item.completedAt?.toISOString() ?? null,
      completedBy: item.completedBy
        ? {
            id: item.completedBy.id,
            login: item.completedBy.login,
            fullName: item.completedBy.fullName,
          }
        : null,
      createdBy: {
        id: item.createdBy.id,
        login: item.createdBy.login,
        fullName: item.createdBy.fullName,
      },
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      attachments,
    };
  }

  private async listSpecificationItemAttachments(
    itemId: string,
  ): Promise<FileResponseDto[]> {
    const attachments = await this.listAttachmentsByEntityIds(
      'one_time_order_specification_item',
      [itemId],
    );

    return attachments.get(itemId) ?? [];
  }

  private specificationAuditValues(
    item: OneTimeOrderSpecificationItemView,
  ): Record<string, string | number | boolean | null> {
    return {
      title: item.title,
      description: item.description,
      sortOrder: item.sortOrder,
      requiresAttachment: item.requiresAttachment,
      isCompleted: item.isCompleted,
      completedAt: item.completedAt?.toISOString() ?? null,
      completedByUserId: item.completedByUserId,
    };
  }

  private async writeSpecificationAudit(
    oneTimeOrderId: string,
    actorUserId: string,
    action: string,
    itemId: string,
    oldValues: Record<string, string | number | boolean | null> | null,
    newValues: Record<string, string | number | boolean | null> | null,
  ): Promise<void> {
    await this.auditService.writeAuditEvent({
      entityType: 'one_time_order',
      entityId: oneTimeOrderId,
      actorUserId,
      action,
      oldValues,
      newValues,
      metadata: {
        specificationItemId: itemId,
      },
    });
  }

  private mapComment(item: {
    id: string;
    oneTimeOrderId: string;
    content: string;
    commentType: string;
    createdAt: Date;
    updatedAt: Date;
    createdBy: {
      id: string;
      login: string;
      fullName: string;
    };
  }, attachments: FileResponseDto[]): OneTimeOrderCommentResponseDto {
    return {
      id: item.id,
      oneTimeOrderId: item.oneTimeOrderId,
      content: item.content,
      commentType: item.commentType,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      createdBy: {
        id: item.createdBy.id,
        login: item.createdBy.login,
        fullName: item.createdBy.fullName,
      },
      attachments,
    };
  }

  private mapDailyReport(
    item: OneTimeOrderDailyReportView,
    attachments: FileResponseDto[],
  ): OneTimeOrderDailyReportResponseDto {
    return {
      id: item.id,
      oneTimeOrderId: item.oneTimeOrderId,
      reportDate: item.reportDate.toISOString(),
      content: item.content,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      updatedBy: {
        id: item.updatedBy.id,
        login: item.updatedBy.login,
        fullName: item.updatedBy.fullName,
      },
      attachments,
    };
  }

  private mapPhoto(
    item: OneTimeOrderPhotoView,
    attachments: FileResponseDto[],
    capabilities: {
      canDelete: boolean;
      canRestore: boolean;
    },
  ): OneTimeOrderPhotoResponseDto {
    return {
      id: item.id,
      oneTimeOrderId: item.oneTimeOrderId,
      category: item.photoCategory,
      comment: item.comment,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      createdBy: {
        id: item.createdBy.id,
        login: item.createdBy.login,
        fullName: item.createdBy.fullName,
      },
      deletedAt: item.deletedAt?.toISOString() ?? null,
      deletedBy: item.deletedBy
        ? {
            id: item.deletedBy.id,
            login: item.deletedBy.login,
            fullName: item.deletedBy.fullName,
          }
        : null,
      deleteReason: item.deleteReason,
      restoredAt: item.restoredAt?.toISOString() ?? null,
      restoredBy: item.restoredBy
        ? {
            id: item.restoredBy.id,
            login: item.restoredBy.login,
            fullName: item.restoredBy.fullName,
          }
        : null,
      capabilities,
      attachments: item.deletedAt ? [] : attachments,
    };
  }

  private buildOrderChanges(
    previous: OneTimeOrderView,
    next: OneTimeOrderView,
  ): Record<
    string,
    {
      oldValue: AuditPrimitive;
      newValue: AuditPrimitive;
    }
  > {
    const fields: Array<keyof Pick<
      OneTimeOrderView,
      | 'title'
      | 'executionAddress'
      | 'status'
      | 'description'
      | 'contactName'
      | 'contactPhone'
      | 'agreedSum'
      | 'financialNotes'
      | 'expenseNotes'
      | 'linkedObjectId'
    >> = [
      'title',
      'executionAddress',
      'status',
      'description',
      'contactName',
      'contactPhone',
      'agreedSum',
      'financialNotes',
      'expenseNotes',
      'linkedObjectId',
    ];
    const changes: Record<
      string,
      {
        oldValue: AuditPrimitive;
        newValue: AuditPrimitive;
      }
    > = {};

    for (const field of fields) {
      if (previous[field] !== next[field]) {
        changes[field] = {
          oldValue: (previous[field] as AuditPrimitive) ?? null,
          newValue: (next[field] as AuditPrimitive) ?? null,
        };
      }
    }

    for (const field of [
      'executionStartDate',
      'executionEndDate',
    ] as const) {
      const previousDate = formatBusinessDate(previous[field]);
      const nextDate = formatBusinessDate(next[field]);

      if (previousDate !== nextDate) {
        changes[field] = {
          oldValue: previousDate,
          newValue: nextDate,
        };
      }
    }

    return changes;
  }

  private getRoleCodes(currentUser: CurrentAuthUser): string[] {
    if (Array.isArray(currentUser.roleCodes) && currentUser.roleCodes.length > 0) {
      return currentUser.roleCodes;
    }

    return currentUser.roleCode ? [currentUser.roleCode] : [];
  }

  private getPermissionCodes(currentUser: CurrentAuthUser): string[] {
    return currentUser.permissionCodes ?? [];
  }

  private parseRegistryDate(value: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day!));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month! - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new BadRequestException('Registry date filter is invalid');
    }

    return date;
  }

  private startOfToday(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  private async listAttachmentsByEntityIds(
    entityType: string,
    entityIds: string[],
  ): Promise<Map<string, FileResponseDto[]>> {
    const map = new Map<string, FileResponseDto[]>();

    if (entityIds.length === 0) {
      return map;
    }

    const rows = await this.prisma.fileAttachment.findMany({
      where: {
        entityType,
        entityId: {
          in: entityIds,
        },
        file: {
          deletedAt: null,
        },
      },
      include: {
        file: {
          include: {
            attachments: {
              orderBy: {
                createdAt: 'asc',
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    for (const row of rows) {
      const items = map.get(row.entityId) ?? [];
      items.push(this.mapFile(row.file as StoredFileView));
      map.set(row.entityId, items);
    }

    return map;
  }

  private mapFile(file: StoredFileView): FileResponseDto {
    return {
      id: file.id,
      bucket: file.bucket,
      objectKey: file.objectKey,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      uploadedByUserId: file.uploadedByUserId,
      createdAt: file.createdAt.toISOString(),
      url: `/api/v1/files/${file.id}/content`,
      attachments: file.attachments.map((attachment) => ({
        id: attachment.id,
        entityType: attachment.entityType,
        entityId: attachment.entityId,
        fieldCode: attachment.fieldCode,
        uploadedByUserId: attachment.uploadedByUserId,
        createdAt: attachment.createdAt.toISOString(),
      })),
    };
  }
}
