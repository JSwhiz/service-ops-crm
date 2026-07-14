import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { ChatsService } from '../chats/chats.service';
import { EquipmentScopeResponseDto } from '../equipment/dto/equipment-response.dto';
import { EquipmentService } from '../equipment/equipment.service';
import { FileResponseDto } from '../files/dto/file-response.dto';
import { PrismaService } from '../prisma/prisma.service';
import { TaskResponseDto } from '../tasks/dto/task-response.dto';
import { TasksService } from '../tasks/tasks.service';

import { AssignOneTimeOrderManagerDto } from './dto/assign-one-time-order-manager.dto';
import { ChangeOneTimeOrderStatusDto } from './dto/change-one-time-order-status.dto';
import { CreateOneTimeOrderCommentDto } from './dto/create-one-time-order-comment.dto';
import { CreateOneTimeOrderPhotoDto } from './dto/create-one-time-order-photo.dto';
import { CreateOneTimeOrderDto } from './dto/create-one-time-order.dto';
import { ListOneTimeOrdersQueryDto } from './dto/list-one-time-orders-query.dto';
import { OneTimeOrderAuditLogResponseDto } from './dto/one-time-order-audit-log-response.dto';
import { OneTimeOrderCommentResponseDto } from './dto/one-time-order-comment-response.dto';
import { OneTimeOrderDailyReportResponseDto } from './dto/one-time-order-daily-report-response.dto';
import { OneTimeOrderPhotoResponseDto } from './dto/one-time-order-photo-response.dto';
import { OneTimeOrderResponseDto } from './dto/one-time-order-response.dto';
import { UpsertOneTimeOrderDailyReportDto } from './dto/upsert-one-time-order-daily-report.dto';
import { UpdateOneTimeOrderDto } from './dto/update-one-time-order.dto';
import { UpdateOneTimeOrderReviewDto } from './dto/update-one-time-order-review.dto';
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

@Injectable()
export class OneTimeOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly tasksService: TasksService,
    private readonly equipmentService: EquipmentService,
    private readonly chatsService: ChatsService,
  ) {}

  async listOrders(
    currentUser: CurrentAuthUser,
    query: ListOneTimeOrdersQueryDto,
  ): Promise<OneTimeOrderResponseDto[]> {
    const orders = (await this.prisma.oneTimeOrder.findMany({
      where: {
        ...(await this.buildVisibilityWhere(currentUser)),
        ...(query.status ? { status: query.status } : {}),
        ...(query.search?.trim()
          ? {
              OR: [
                { title: { contains: query.search.trim(), mode: 'insensitive' } },
                {
                  executionAddress: {
                    contains: query.search.trim(),
                    mode: 'insensitive',
                  },
                },
                {
                  contactName: {
                    contains: query.search.trim(),
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
      },
      include: this.getOrderInclude(),
      orderBy: {
        createdAt: 'desc',
      },
    })) as OneTimeOrderView[];

    return orders.map((order) => this.mapOrder(order, currentUser));
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

    const updated = (await this.prisma.oneTimeOrder.update({
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

    const updated = (await this.prisma.oneTimeOrder.update({
      where: { id },
      data: {
        status: payload.status,
      },
      include: this.getOrderInclude(),
    })) as OneTimeOrderView;

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
    await this.getOrderForManagerChange(currentUser, id);
    const [manager] = await this.loadManagerUsers([payload.userId]);

    if (!manager) {
      throw new NotFoundException('Selected one-time order manager not found');
    }

    await this.prisma.oneTimeOrderAssignment.upsert({
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
  ): Promise<OneTimeOrderPhotoResponseDto[]> {
    await this.getOrderById(currentUser, id);

    const items = (await this.prisma.oneTimeOrderPhoto.findMany({
      where: {
        oneTimeOrderId: id,
      },
      include: {
        createdBy: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 100,
    })) as OneTimeOrderPhotoView[];

    const attachmentsMap = await this.listAttachmentsByEntityIds(
      'one_time_order_photo',
      items.map((item) => item.id),
    );

    return items.map((item) =>
      this.mapPhoto(item, attachmentsMap.get(item.id) ?? []),
    );
  }

  async createPhoto(
    currentUser: CurrentAuthUser,
    id: string,
    payload: CreateOneTimeOrderPhotoDto,
  ): Promise<OneTimeOrderPhotoResponseDto> {
    await this.getOrderForWrite(currentUser, id);

    const item = (await this.prisma.oneTimeOrderPhoto.create({
      data: {
        oneTimeOrderId: id,
        photoCategory: payload.category,
        comment: payload.comment?.trim() || null,
        createdByUserId: currentUser.id,
      },
      include: {
        createdBy: true,
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

    return this.mapPhoto(item, []);
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
      attachments,
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
