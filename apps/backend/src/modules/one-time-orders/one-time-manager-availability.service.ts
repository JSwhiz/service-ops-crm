import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  ONE_TIME_MANAGER_AVAILABILITY_APPROVAL_SOURCE_ENTITY_TYPE,
  ONE_TIME_MANAGER_AVAILABILITY_APPROVAL_TYPE,
} from '../approvals/constants/approval.constants';
import { PrismaService } from '../prisma/prisma.service';

import {
  CreateOneTimeManagerAvailabilityDirectDto,
  CreateOneTimeManagerAvailabilityRequestDto,
} from './dto/create-one-time-manager-availability.dto';
import { OneTimeManagerAvailabilityResponseDto } from './dto/one-time-manager-availability-response.dto';
import {
  ApproveOneTimeManagerAvailabilityDto,
  RejectOneTimeManagerAvailabilityDto,
} from './dto/resolve-one-time-manager-availability.dto';
import { UpdateOneTimeManagerAvailabilityDto } from './dto/update-one-time-manager-availability.dto';
import {
  canBeOneTimeOrderManager,
  hasOneTimeOrderPermission,
  ONE_TIME_ORDER_CALENDAR_APPROVE_PERMISSION,
  ONE_TIME_ORDER_CALENDAR_MANAGE_PERMISSION,
} from './utils/one-time-order-access.util';
import {
  formatAvailabilityDate,
  normalizeAvailabilityDateRange,
} from './utils/one-time-manager-availability-date.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
}

interface AvailabilityRecord {
  id: string;
  userId: string;
  entryType: string;
  startDate: Date;
  endDate: Date;
  status: string;
  requestComment: string | null;
  resolutionComment: string | null;
  requestedByUserId: string;
  resolvedByUserId: string | null;
  resolvedAt: Date | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: UserSummary;
  requestedBy: UserSummary;
  resolvedBy: UserSummary | null;
  cancelledBy: UserSummary | null;
}

interface UserSummary {
  id: string;
  login: string;
  fullName: string;
}

@Injectable()
export class OneTimeManagerAvailabilityService {
  private readonly logger = new Logger(OneTimeManagerAvailabilityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createOwnRequest(
    currentUser: CurrentAuthUser,
    payload: CreateOneTimeManagerAvailabilityRequestDto,
  ): Promise<OneTimeManagerAvailabilityResponseDto> {
    await this.assertEligibleManager(currentUser.id);
    const range = normalizeAvailabilityDateRange(payload.startDate, payload.endDate);
    const requestComment = payload.comment?.trim() || null;

    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockAvailabilityUser(tx, currentUser.id);
      await this.assertNoExactPendingDuplicate(tx, {
        userId: currentUser.id,
        entryType: payload.entryType,
        startDate: range.startDate,
        endDate: range.endDate,
      });
      const availability = (await tx.oneTimeManagerAvailability.create({
        data: {
          userId: currentUser.id,
          entryType: payload.entryType,
          startDate: range.startDate,
          endDate: range.endDate,
          status: 'pending',
          requestComment,
          requestedByUserId: currentUser.id,
        },
        include: this.availabilityInclude(),
      })) as AvailabilityRecord;
      const approvalRequest = await tx.approvalRequest.create({
        data: {
          approvalType: ONE_TIME_MANAGER_AVAILABILITY_APPROVAL_TYPE,
          sourceEntityType:
            ONE_TIME_MANAGER_AVAILABILITY_APPROVAL_SOURCE_ENTITY_TYPE,
          sourceEntityId: availability.id,
          createdByUserId: currentUser.id,
          payloadSnapshot: {
            summaryTitle: 'Запрос доступности менеджера',
            summarySubtitle: `${currentUser.fullName} · ${payload.startDate} — ${payload.endDate}`,
            userId: currentUser.id,
            entryType: payload.entryType,
            startDate: payload.startDate,
            endDate: payload.endDate,
          },
        },
      });

      await this.writeDomainAudit(tx, availability.id, currentUser.id, 'requested', {
        userId: currentUser.id,
        entryType: payload.entryType,
        startDate: payload.startDate,
        endDate: payload.endDate,
      });
      await this.writeApprovalAudit(tx, approvalRequest.id, currentUser.id, 'created', {
        sourceEntityId: availability.id,
      });

      return { availability, approvalRequestId: approvalRequest.id };
    });

    return this.mapAvailability(result.availability, result.approvalRequestId);
  }

  async listOwnRequests(
    currentUser: CurrentAuthUser,
  ): Promise<OneTimeManagerAvailabilityResponseDto[]> {
    const entries = (await this.prisma.oneTimeManagerAvailability.findMany({
      where: { userId: currentUser.id },
      include: this.availabilityInclude(),
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    })) as AvailabilityRecord[];
    const approvalRequestIds = await this.findApprovalRequestIds(
      entries.map((entry) => entry.id),
    );

    return entries.map((entry) =>
      this.mapAvailability(entry, approvalRequestIds.get(entry.id) ?? null),
    );
  }

  async createDirect(
    currentUser: CurrentAuthUser,
    payload: CreateOneTimeManagerAvailabilityDirectDto,
  ): Promise<OneTimeManagerAvailabilityResponseDto> {
    this.assertCanManage(currentUser);
    await this.assertEligibleManager(payload.userId);
    const range = normalizeAvailabilityDateRange(payload.startDate, payload.endDate);
    const requestComment = payload.comment?.trim() || null;

    const availability = await this.prisma.$transaction(async (tx) => {
      await this.lockAvailabilityUser(tx, payload.userId);
      await this.assertNoApprovedOverlap(
        tx,
        payload.userId,
        range.startDate,
        range.endDate,
      );
      const created = (await tx.oneTimeManagerAvailability.create({
        data: {
          userId: payload.userId,
          entryType: payload.entryType,
          startDate: range.startDate,
          endDate: range.endDate,
          status: 'approved',
          requestComment,
          requestedByUserId: currentUser.id,
          resolvedByUserId: currentUser.id,
          resolvedAt: new Date(),
        },
        include: this.availabilityInclude(),
      })) as AvailabilityRecord;

      await this.writeDomainAudit(
        tx,
        created.id,
        currentUser.id,
        'direct_created',
        {
          userId: payload.userId,
          entryType: payload.entryType,
          startDate: payload.startDate,
          endDate: payload.endDate,
        },
      );
      return created;
    });

    return this.mapAvailability(availability, null);
  }

  async approveAvailability(
    currentUser: CurrentAuthUser,
    availabilityId: string,
    payload: ApproveOneTimeManagerAvailabilityDto,
  ): Promise<OneTimeManagerAvailabilityResponseDto> {
    this.assertCanApprove(currentUser);
    const approvalRequest = await this.getPendingApprovalRequest(availabilityId);
    const comment = payload.comment?.trim() || null;

    const availability = await this.prisma.$transaction(async (tx) => {
      await this.lockPendingApprovalRequest(tx, approvalRequest.id);
      const approved = await this.applyApprovalDecision(tx, {
        availabilityId,
        decision: 'approve',
        actorUserId: currentUser.id,
        comment,
      });
      const approvalUpdate = await tx.approvalRequest.updateMany({
        where: { id: approvalRequest.id, status: 'pending' },
        data: {
          status: 'approved',
          resolvedByUserId: currentUser.id,
          resolvedAt: new Date(),
          decisionComment: comment,
        },
      });
      if (approvalUpdate.count !== 1) {
        throw new ConflictException('Availability approval state has changed');
      }
      await this.writeApprovalAudit(
        tx,
        approvalRequest.id,
        currentUser.id,
        'approved',
        { sourceEntityId: availabilityId, decisionComment: comment },
      );
      return approved;
    });

    return this.mapAvailability(availability, approvalRequest.id);
  }

  async rejectAvailability(
    currentUser: CurrentAuthUser,
    availabilityId: string,
    payload: RejectOneTimeManagerAvailabilityDto,
  ): Promise<OneTimeManagerAvailabilityResponseDto> {
    this.assertCanApprove(currentUser);
    const comment = payload.comment.trim();

    if (!comment) {
      throw new BadRequestException('Availability rejection comment is required');
    }

    const approvalRequest = await this.getPendingApprovalRequest(availabilityId);
    const availability = await this.prisma.$transaction(async (tx) => {
      await this.lockPendingApprovalRequest(tx, approvalRequest.id);
      const rejected = await this.applyApprovalDecision(tx, {
        availabilityId,
        decision: 'reject',
        actorUserId: currentUser.id,
        comment,
      });
      const approvalUpdate = await tx.approvalRequest.updateMany({
        where: { id: approvalRequest.id, status: 'pending' },
        data: {
          status: 'rejected',
          resolvedByUserId: currentUser.id,
          resolvedAt: new Date(),
          decisionComment: comment,
        },
      });
      if (approvalUpdate.count !== 1) {
        throw new ConflictException('Availability approval state has changed');
      }
      await this.writeApprovalAudit(
        tx,
        approvalRequest.id,
        currentUser.id,
        'rejected',
        { sourceEntityId: availabilityId, decisionComment: comment },
      );
      return rejected;
    });

    return this.mapAvailability(availability, approvalRequest.id);
  }

  async cancelAvailability(
    currentUser: CurrentAuthUser,
    availabilityId: string,
  ): Promise<OneTimeManagerAvailabilityResponseDto> {
    const current = await this.getAvailability(availabilityId);
    if (
      current.userId === currentUser.id &&
      current.status !== 'pending'
    ) {
      throw new ConflictException('Manager availability state has changed');
    }
    const canCancelOwnPending =
      current.status === 'pending' && current.userId === currentUser.id;
    const canCancelApproved =
      current.status === 'approved' && this.canManage(currentUser);

    if (!canCancelOwnPending && !canCancelApproved) {
      throw new ForbiddenException('Availability cancellation denied');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const pendingApproval =
        current.status === 'pending'
          ? await tx.approvalRequest.findFirst({
              where: {
                approvalType: ONE_TIME_MANAGER_AVAILABILITY_APPROVAL_TYPE,
                sourceEntityType:
                  ONE_TIME_MANAGER_AVAILABILITY_APPROVAL_SOURCE_ENTITY_TYPE,
                sourceEntityId: availabilityId,
              },
              select: { id: true },
              orderBy: { createdAt: 'desc' },
            })
          : null;
      if (current.status === 'pending' && !pendingApproval) {
        throw new ConflictException('Pending availability approval was not found');
      }
      if (pendingApproval) {
        await this.lockPendingApprovalRequest(tx, pendingApproval.id);
      }
      const updateResult = await tx.oneTimeManagerAvailability.updateMany({
        where: { id: availabilityId, status: current.status },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledByUserId: currentUser.id,
        },
      });

      if (updateResult.count !== 1) {
        throw new ConflictException('Manager availability state has changed');
      }

      const cancelled = (await tx.oneTimeManagerAvailability.findUniqueOrThrow({
        where: { id: availabilityId },
        include: this.availabilityInclude(),
      })) as AvailabilityRecord;
      if (pendingApproval) {
        const approvalUpdate = await tx.approvalRequest.updateMany({
          where: { id: pendingApproval.id, status: 'pending' },
          data: {
            status: 'cancelled',
            cancelledByUserId: currentUser.id,
            cancelledAt: new Date(),
          },
        });
        if (approvalUpdate.count !== 1) {
          throw new ConflictException('Availability approval state has changed');
        }
        await this.writeApprovalAudit(
          tx,
          pendingApproval.id,
          currentUser.id,
          'cancelled',
          { sourceEntityId: availabilityId },
        );
      }

      await this.writeDomainAudit(
        tx,
        availabilityId,
        currentUser.id,
        'cancelled',
        { previousStatus: current.status },
      );
      return {
        availability: cancelled,
        approvalRequestId: pendingApproval?.id ?? null,
      };
    });

    return this.mapAvailability(
      result.availability,
      result.approvalRequestId,
    );
  }

  async updateApprovedAvailability(
    currentUser: CurrentAuthUser,
    availabilityId: string,
    payload: UpdateOneTimeManagerAvailabilityDto,
  ): Promise<OneTimeManagerAvailabilityResponseDto> {
    this.assertCanManage(currentUser);
    const current = await this.getAvailability(availabilityId);

    if (current.status !== 'approved') {
      throw new ConflictException('Only approved availability can be edited');
    }

    const startDateValue = payload.startDate ?? formatAvailabilityDate(current.startDate);
    const endDateValue = payload.endDate ?? formatAvailabilityDate(current.endDate);
    const range = normalizeAvailabilityDateRange(startDateValue, endDateValue);

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockAvailabilityUser(tx, current.userId);
      await this.assertNoApprovedOverlap(
        tx,
        current.userId,
        range.startDate,
        range.endDate,
        availabilityId,
      );
      const updateResult = await tx.oneTimeManagerAvailability.updateMany({
        where: { id: availabilityId, status: 'approved' },
        data: {
          entryType: payload.entryType ?? current.entryType,
          startDate: range.startDate,
          endDate: range.endDate,
          ...(payload.comment === undefined
            ? {}
            : { requestComment: payload.comment.trim() || null }),
        },
      });

      if (updateResult.count !== 1) {
        throw new ConflictException('Manager availability state has changed');
      }

      const next = (await tx.oneTimeManagerAvailability.findUniqueOrThrow({
        where: { id: availabilityId },
        include: this.availabilityInclude(),
      })) as AvailabilityRecord;
      await this.writeDomainAudit(tx, availabilityId, currentUser.id, 'updated', {
        entryType: next.entryType,
        startDate: startDateValue,
        endDate: endDateValue,
      });
      return next;
    });

    const approvalRequestId = await this.findLatestApprovalRequestId(availabilityId);
    return this.mapAvailability(updated, approvalRequestId);
  }

  async applyApprovalDecision(
    tx: Prisma.TransactionClient,
    params: {
      availabilityId: string;
      decision: 'approve' | 'reject' | 'cancel';
      actorUserId: string;
      comment?: string | null;
    },
  ): Promise<AvailabilityRecord> {
    const current = (await tx.oneTimeManagerAvailability.findUnique({
      where: { id: params.availabilityId },
      include: this.availabilityInclude(),
    })) as AvailabilityRecord | null;

    if (!current) {
      throw new NotFoundException('Manager availability not found');
    }

    if (current.status !== 'pending') {
      this.logApprovalConflict({
        availabilityId: params.availabilityId,
        actorUserId: params.actorUserId,
        reason: 'availability_not_pending',
      });
      throw new ConflictException('Only pending availability can be resolved');
    }

    if (params.decision === 'approve') {
      await this.lockAvailabilityUser(tx, current.userId);
      await this.assertNoApprovedOverlap(
        tx,
        current.userId,
        current.startDate,
        current.endDate,
        current.id,
      );
    }

    const resolvedAt = new Date();
    const nextStatus =
      params.decision === 'approve'
        ? 'approved'
        : params.decision === 'reject'
          ? 'rejected'
          : 'cancelled';
    const updateResult = await tx.oneTimeManagerAvailability.updateMany({
      where: { id: params.availabilityId, status: 'pending' },
      data:
        params.decision === 'cancel'
          ? {
              status: nextStatus,
              cancelledAt: resolvedAt,
              cancelledByUserId: params.actorUserId,
            }
          : {
              status: nextStatus,
              resolutionComment: params.comment?.trim() || null,
              resolvedByUserId: params.actorUserId,
              resolvedAt,
            },
    });
    if (updateResult.count !== 1) {
      this.logApprovalConflict({
        availabilityId: params.availabilityId,
        actorUserId: params.actorUserId,
        reason: 'conditional_availability_update_lost',
      });
      throw new ConflictException('Manager availability state has changed');
    }

    const updated = (await tx.oneTimeManagerAvailability.findUniqueOrThrow({
      where: { id: params.availabilityId },
      include: this.availabilityInclude(),
    })) as AvailabilityRecord;
    await this.writeDomainAudit(
      tx,
      params.availabilityId,
      params.actorUserId,
      nextStatus,
      { decisionComment: params.comment?.trim() || null },
    );
    return updated;
  }

  private async assertEligibleManager(userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true, deletedAt: null },
      select: {
        roles: { select: { role: { select: { code: true } } } },
        oneTimeOrderAssignments: {
          where: {
            assignmentRoleCode: 'one_time_manager',
            isActive: true,
          },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (
      !user ||
      (!canBeOneTimeOrderManager(
        user.roles.map((item) => item.role.code),
      ) &&
        user.oneTimeOrderAssignments.length === 0)
    ) {
      throw new ForbiddenException('User is not an eligible one-time order manager');
    }
  }

  private assertCanManage(currentUser: CurrentAuthUser): void {
    if (!this.canManage(currentUser)) {
      throw new ForbiddenException('Manager availability management denied');
    }
  }

  private canManage(currentUser: CurrentAuthUser): boolean {
    return hasOneTimeOrderPermission(
      currentUser.permissionCodes,
      ONE_TIME_ORDER_CALENDAR_MANAGE_PERMISSION,
    );
  }

  private assertCanApprove(currentUser: CurrentAuthUser): void {
    if (
      !hasOneTimeOrderPermission(
        currentUser.permissionCodes,
        ONE_TIME_ORDER_CALENDAR_APPROVE_PERMISSION,
      )
    ) {
      throw new ForbiddenException('Manager availability approval denied');
    }
  }

  private async getAvailability(id: string): Promise<AvailabilityRecord> {
    const availability = (await this.prisma.oneTimeManagerAvailability.findUnique({
      where: { id },
      include: this.availabilityInclude(),
    })) as AvailabilityRecord | null;

    if (!availability) {
      throw new NotFoundException('Manager availability not found');
    }

    return availability;
  }

  private async getPendingApprovalRequest(availabilityId: string) {
    const request = await this.prisma.approvalRequest.findFirst({
      where: {
        approvalType: ONE_TIME_MANAGER_AVAILABILITY_APPROVAL_TYPE,
        sourceEntityType:
          ONE_TIME_MANAGER_AVAILABILITY_APPROVAL_SOURCE_ENTITY_TYPE,
        sourceEntityId: availabilityId,
        status: 'pending',
      },
      select: { id: true },
    });

    if (!request) {
      this.logApprovalConflict({
        availabilityId,
        reason: 'pending_approval_missing',
      });
      throw new ConflictException('Pending availability approval was not found');
    }

    return request;
  }

  private async findApprovalRequestIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const requests = await this.prisma.approvalRequest.findMany({
      where: {
        approvalType: ONE_TIME_MANAGER_AVAILABILITY_APPROVAL_TYPE,
        sourceEntityType:
          ONE_TIME_MANAGER_AVAILABILITY_APPROVAL_SOURCE_ENTITY_TYPE,
        sourceEntityId: { in: ids },
      },
      select: { id: true, sourceEntityId: true },
      orderBy: { createdAt: 'desc' },
    });
    const result = new Map<string, string>();
    for (const request of requests) {
      if (!result.has(request.sourceEntityId)) {
        result.set(request.sourceEntityId, request.id);
      }
    }
    return result;
  }

  private async findLatestApprovalRequestId(
    availabilityId: string,
  ): Promise<string | null> {
    const ids = await this.findApprovalRequestIds([availabilityId]);
    return ids.get(availabilityId) ?? null;
  }

  private async lockAvailabilityUser(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))::text`;
  }

  private async lockPendingApprovalRequest(
    tx: Prisma.TransactionClient,
    approvalRequestId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT "id", "status"
      FROM "approval_requests"
      WHERE "id" = ${approvalRequestId}
      FOR UPDATE
    `;

    if (rows[0]?.status !== 'pending') {
      this.logApprovalConflict({
        approvalRequestId,
        reason: 'approval_not_pending',
      });
      throw new ConflictException('Availability approval state has changed');
    }
  }

  private async assertNoExactPendingDuplicate(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      entryType: string;
      startDate: Date;
      endDate: Date;
    },
  ): Promise<void> {
    const duplicate = await tx.oneTimeManagerAvailability.findFirst({
      where: {
        ...input,
        status: 'pending',
      },
      select: { id: true },
    });

    if (duplicate) {
      this.logger.warn(
        JSON.stringify({
          event: 'one_time_order.availability_duplicate_request',
          userId: input.userId,
          entryType: input.entryType,
          startDate: formatAvailabilityDate(input.startDate),
          endDate: formatAvailabilityDate(input.endDate),
          existingAvailabilityId: duplicate.id,
        }),
      );
      throw new ConflictException(
        'Duplicate pending manager availability request',
      );
    }
  }

  private async assertNoApprovedOverlap(
    tx: Prisma.TransactionClient,
    userId: string,
    startDate: Date,
    endDate: Date,
    excludeId?: string,
  ): Promise<void> {
    const conflict = await tx.oneTimeManagerAvailability.findFirst({
      where: {
        userId,
        status: 'approved',
        startDate: { lte: endDate },
        endDate: { gte: startDate },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });

    if (conflict) {
      throw new ConflictException('Approved manager availability overlaps existing entry');
    }
  }

  private availabilityInclude() {
    const select = { id: true, login: true, fullName: true } as const;
    return {
      user: { select },
      requestedBy: { select },
      resolvedBy: { select },
      cancelledBy: { select },
    } as const;
  }

  private logApprovalConflict(input: {
    availabilityId?: string;
    approvalRequestId?: string;
    actorUserId?: string;
    reason: string;
  }): void {
    this.logger.warn(
      JSON.stringify({
        event: 'one_time_order.availability_approval_conflict',
        ...input,
      }),
    );
  }

  private mapAvailability(
    availability: AvailabilityRecord,
    approvalRequestId: string | null,
  ): OneTimeManagerAvailabilityResponseDto {
    const durationDays =
      Math.floor(
        (availability.endDate.getTime() - availability.startDate.getTime()) /
          (24 * 60 * 60 * 1000),
      ) + 1;
    return {
      id: availability.id,
      userId: availability.userId,
      entryType: availability.entryType,
      startDate: formatAvailabilityDate(availability.startDate),
      endDate: formatAvailabilityDate(availability.endDate),
      durationDays,
      status: availability.status,
      requestComment: availability.requestComment,
      resolutionComment: availability.resolutionComment,
      requestedAt: availability.createdAt.toISOString(),
      resolvedAt: availability.resolvedAt?.toISOString() ?? null,
      cancelledAt: availability.cancelledAt?.toISOString() ?? null,
      createdAt: availability.createdAt.toISOString(),
      updatedAt: availability.updatedAt.toISOString(),
      approvalRequestId,
      user: availability.user,
      requestedBy: availability.requestedBy,
      resolvedBy: availability.resolvedBy,
      cancelledBy: availability.cancelledBy,
    };
  }

  private async writeDomainAudit(
    tx: Prisma.TransactionClient,
    entityId: string,
    actorUserId: string,
    action: string,
    newValues: Record<string, Prisma.InputJsonValue | null>,
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        entityType: 'one_time_manager_availability',
        entityId,
        actorUserId,
        action: `one_time_manager_availability.${action}`,
        newValues,
      },
    });
  }

  private async writeApprovalAudit(
    tx: Prisma.TransactionClient,
    entityId: string,
    actorUserId: string,
    action: string,
    newValues: Record<string, Prisma.InputJsonValue | null>,
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        entityType: 'approval_request',
        entityId,
        actorUserId,
        action: `approval.request.${action}`,
        newValues: {
          approvalType: ONE_TIME_MANAGER_AVAILABILITY_APPROVAL_TYPE,
          sourceEntityType:
            ONE_TIME_MANAGER_AVAILABILITY_APPROVAL_SOURCE_ENTITY_TYPE,
          ...newValues,
        },
      },
    });
  }
}
