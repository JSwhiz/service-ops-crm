import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AccountabilityService } from '../accountability/accountability.service';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { TaskStatus } from '../tasks/types/task-status.type';
import { TasksService } from '../tasks/tasks.service';

import {
  ACCOUNTABILITY_CLOSURE_CONFIRMATION_TYPE,
  ApprovalType,
  INVENTORY_EXCEPTION_CONFIRMATION_TYPE,
  TASK_RESULT_CONFIRMATION_TYPE,
} from './constants/approval.constants';
import { ApprovalRequestResponseDto } from './dto/approval-request-response.dto';
import { ListApprovalRequestsQueryDto } from './dto/list-approval-requests-query.dto';
import {
  ApproveApprovalRequestDto,
  CancelApprovalRequestDto,
  RejectApprovalRequestDto,
} from './dto/resolve-approval-request.dto';
import {
  canResolveApprovalType,
  getResolvableApprovalTypes,
} from './utils/approval-capabilities.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
}

type ApprovalRequestRecord = {
  id: string;
  approvalType: string;
  sourceEntityType: string;
  sourceEntityId: string;
  status: string;
  createdByUserId: string;
  resolvedByUserId: string | null;
  cancelledByUserId: string | null;
  decisionComment: string | null;
  payloadSnapshot: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  cancelledAt: Date | null;
  createdBy: {
    id: string;
    login: string;
    fullName: string;
  };
  resolvedBy: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  cancelledBy: {
    id: string;
    login: string;
    fullName: string;
  } | null;
};

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly tasksService: TasksService,
    private readonly inventoryService: InventoryService,
    private readonly accountabilityService: AccountabilityService,
  ) {}

  async listRequests(
    currentUser: CurrentAuthUser,
    query: ListApprovalRequestsQueryDto,
  ): Promise<ApprovalRequestResponseDto[]> {
    const requests = (await this.prisma.approvalRequest.findMany({
      where: {
        ...this.buildVisibilityWhere(currentUser),
        ...(query.status ? { status: query.status } : {}),
        ...(query.approvalType ? { approvalType: query.approvalType } : {}),
        ...(query.sourceEntityType
          ? { sourceEntityType: query.sourceEntityType }
          : {}),
        ...(query.sourceEntityId ? { sourceEntityId: query.sourceEntityId } : {}),
        ...this.buildDateRangeWhere(query),
      },
      include: this.approvalInclude(),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })) as ApprovalRequestRecord[];

    return requests.map((request) => this.mapRequest(request, currentUser));
  }

  async getRequestById(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<ApprovalRequestResponseDto> {
    const request = (await this.prisma.approvalRequest.findFirst({
      where: {
        id,
        ...this.buildVisibilityWhere(currentUser),
      },
      include: this.approvalInclude(),
    })) as ApprovalRequestRecord | null;

    if (!request) {
      throw new NotFoundException('Approval request not found');
    }

    return this.mapRequest(request, currentUser);
  }

  async approveRequest(
    currentUser: CurrentAuthUser,
    requestId: string,
    payload: ApproveApprovalRequestDto,
  ): Promise<ApprovalRequestResponseDto> {
    const comment = payload.comment?.trim() || null;

    const approved = await this.prisma.$transaction(async (tx) => {
      const request = await this.loadRequestForUpdate(tx, requestId);
      this.assertCanApprove(currentUser, request);
      await this.applyApprovalBusinessEffect(tx, request, currentUser);

      return (await tx.approvalRequest.update({
        where: {
          id: requestId,
        },
        data: {
          status: 'approved',
          resolvedByUserId: currentUser.id,
          resolvedAt: new Date(),
          decisionComment: comment,
        },
        include: this.approvalInclude(),
      })) as ApprovalRequestRecord;
    });

    await this.auditService.writeAuditEvent({
      entityType: 'approval_request',
      entityId: approved.id,
      actorUserId: currentUser.id,
      action: 'approval.request.approved',
      newValues: {
        approvalType: approved.approvalType,
        sourceEntityType: approved.sourceEntityType,
        sourceEntityId: approved.sourceEntityId,
        decisionComment: approved.decisionComment,
      },
    });

    return this.mapRequest(approved, currentUser);
  }

  async rejectRequest(
    currentUser: CurrentAuthUser,
    requestId: string,
    payload: RejectApprovalRequestDto,
  ): Promise<ApprovalRequestResponseDto> {
    const comment = payload.comment.trim();

    if (!comment) {
      throw new BadRequestException('Reject comment is required');
    }

    const rejected = await this.prisma.$transaction(async (tx) => {
      const request = await this.loadRequestForUpdate(tx, requestId);
      this.assertCanReject(currentUser, request);
      await this.applyRejectionBusinessEffect(tx, request, currentUser, comment);

      return (await tx.approvalRequest.update({
        where: {
          id: requestId,
        },
        data: {
          status: 'rejected',
          resolvedByUserId: currentUser.id,
          resolvedAt: new Date(),
          decisionComment: comment,
        },
        include: this.approvalInclude(),
      })) as ApprovalRequestRecord;
    });

    await this.auditService.writeAuditEvent({
      entityType: 'approval_request',
      entityId: rejected.id,
      actorUserId: currentUser.id,
      action: 'approval.request.rejected',
      newValues: {
        approvalType: rejected.approvalType,
        sourceEntityType: rejected.sourceEntityType,
        sourceEntityId: rejected.sourceEntityId,
        decisionComment: rejected.decisionComment,
      },
    });

    return this.mapRequest(rejected, currentUser);
  }

  async cancelRequest(
    currentUser: CurrentAuthUser,
    requestId: string,
    payload: CancelApprovalRequestDto,
  ): Promise<ApprovalRequestResponseDto> {
    const comment = payload.comment?.trim() || null;

    const cancelled = await this.prisma.$transaction(async (tx) => {
      const request = await this.loadRequestForUpdate(tx, requestId);
      this.assertCanCancel(currentUser, request);
      await this.applyCancellationBusinessEffect(tx, request, currentUser, comment);

      return (await tx.approvalRequest.update({
        where: {
          id: requestId,
        },
        data: {
          status: 'cancelled',
          cancelledByUserId: currentUser.id,
          cancelledAt: new Date(),
          decisionComment: comment,
        },
        include: this.approvalInclude(),
      })) as ApprovalRequestRecord;
    });

    await this.auditService.writeAuditEvent({
      entityType: 'approval_request',
      entityId: cancelled.id,
      actorUserId: currentUser.id,
      action: 'approval.request.cancelled',
      newValues: {
        approvalType: cancelled.approvalType,
        sourceEntityType: cancelled.sourceEntityType,
        sourceEntityId: cancelled.sourceEntityId,
        decisionComment: cancelled.decisionComment,
      },
    });

    return this.mapRequest(cancelled, currentUser);
  }

  private buildVisibilityWhere(currentUser: CurrentAuthUser): Prisma.ApprovalRequestWhereInput {
    const roleCodes = this.getRoleCodes(currentUser);
    const permissionCodes = this.getPermissionCodes(currentUser);
    const resolvableTypes = getResolvableApprovalTypes({
      roleCodes,
      permissionCodes,
    });

    if (resolvableTypes.length === 0) {
      return {
        createdByUserId: currentUser.id,
      };
    }

    return {
      OR: [
        {
          createdByUserId: currentUser.id,
        },
        {
          approvalType: {
            in: resolvableTypes,
          },
        },
      ],
    };
  }

  private buildDateRangeWhere(
    query: ListApprovalRequestsQueryDto,
  ): Prisma.ApprovalRequestWhereInput {
    const createdAt: Prisma.DateTimeFilter = {};

    if (query.dateFrom) {
      const dateFrom = new Date(query.dateFrom);

      if (!Number.isNaN(dateFrom.getTime())) {
        createdAt.gte = dateFrom;
      }
    }

    if (query.dateTo) {
      const dateTo = new Date(query.dateTo);

      if (!Number.isNaN(dateTo.getTime())) {
        createdAt.lte = dateTo;
      }
    }

    return Object.keys(createdAt).length > 0 ? { createdAt } : {};
  }

  private approvalInclude() {
    return {
      createdBy: {
        select: {
          id: true,
          login: true,
          fullName: true,
        },
      },
      resolvedBy: {
        select: {
          id: true,
          login: true,
          fullName: true,
        },
      },
      cancelledBy: {
        select: {
          id: true,
          login: true,
          fullName: true,
        },
      },
    } as const;
  }

  private async loadRequestForUpdate(
    tx: Prisma.TransactionClient,
    requestId: string,
  ): Promise<ApprovalRequestRecord> {
    const request = (await tx.approvalRequest.findUnique({
      where: {
        id: requestId,
      },
      include: this.approvalInclude(),
    })) as ApprovalRequestRecord | null;

    if (!request) {
      throw new NotFoundException('Approval request not found');
    }

    if (request.status !== 'pending') {
      throw new ConflictException('Only pending approval request can be resolved');
    }

    return request;
  }

  private assertCanApprove(
    currentUser: CurrentAuthUser,
    request: ApprovalRequestRecord,
  ): void {
    if (
      !canResolveApprovalType({
        approvalType: request.approvalType as ApprovalType,
        roleCodes: this.getRoleCodes(currentUser),
        permissionCodes: this.getPermissionCodes(currentUser),
      })
    ) {
      throw new ForbiddenException('Approval resolve access denied');
    }
  }

  private assertCanReject(
    currentUser: CurrentAuthUser,
    request: ApprovalRequestRecord,
  ): void {
    this.assertCanApprove(currentUser, request);

    if (request.approvalType === INVENTORY_EXCEPTION_CONFIRMATION_TYPE) {
      throw new ForbiddenException(
        'Inventory exception reject flow is not available in this MVP pass',
      );
    }
  }

  private assertCanCancel(
    currentUser: CurrentAuthUser,
    request: ApprovalRequestRecord,
  ): void {
    if (
      request.approvalType !== TASK_RESULT_CONFIRMATION_TYPE ||
      request.createdByUserId !== currentUser.id
    ) {
      throw new ForbiddenException('Approval cancellation denied');
    }
  }

  private async applyApprovalBusinessEffect(
    tx: Prisma.TransactionClient,
    request: ApprovalRequestRecord,
    currentUser: CurrentAuthUser,
  ): Promise<void> {
    switch (request.approvalType) {
      case TASK_RESULT_CONFIRMATION_TYPE:
        await this.tasksService.applyTaskResultApprovalDecision(tx, {
          taskId: request.sourceEntityId,
          nextStatus: 'closed',
        });
        return;
      case INVENTORY_EXCEPTION_CONFIRMATION_TYPE:
        await this.inventoryService.applyInventoryExceptionApprovalDecision(tx, {
          movementId: request.sourceEntityId,
          actorUserId: currentUser.id,
        });
        return;
      case ACCOUNTABILITY_CLOSURE_CONFIRMATION_TYPE:
        await this.accountabilityService.applyClosureApprovalDecision(tx, {
          closureId: request.sourceEntityId,
          decision: 'approve',
          actorUserId: currentUser.id,
        });
        return;
      default:
        throw new BadRequestException('Approval type is not wired yet');
    }
  }

  private async applyRejectionBusinessEffect(
    tx: Prisma.TransactionClient,
    request: ApprovalRequestRecord,
    currentUser: CurrentAuthUser,
    comment: string,
  ): Promise<void> {
    switch (request.approvalType) {
      case TASK_RESULT_CONFIRMATION_TYPE:
        await this.tasksService.applyTaskResultApprovalDecision(tx, {
          taskId: request.sourceEntityId,
          nextStatus: 'returned_to_work',
        });
        return;
      case ACCOUNTABILITY_CLOSURE_CONFIRMATION_TYPE:
        await this.accountabilityService.applyClosureApprovalDecision(tx, {
          closureId: request.sourceEntityId,
          decision: 'reject',
          actorUserId: currentUser.id,
          comment,
        });
        return;
      default:
        throw new BadRequestException('Approval reject path is not wired yet');
    }
  }

  private async applyCancellationBusinessEffect(
    tx: Prisma.TransactionClient,
    request: ApprovalRequestRecord,
    currentUser: CurrentAuthUser,
    comment: string | null,
  ): Promise<void> {
    void currentUser;
    void comment;

    switch (request.approvalType) {
      case TASK_RESULT_CONFIRMATION_TYPE: {
        const payloadSnapshot = this.normalizePayloadSnapshot(request.payloadSnapshot);
        const fallbackStatus = this.parseTaskStatus(
          payloadSnapshot.returnStatusOnCancel,
        );

        await this.tasksService.applyTaskResultApprovalDecision(tx, {
          taskId: request.sourceEntityId,
          nextStatus: fallbackStatus ?? 'in_progress',
        });
        return;
      }
      default:
        throw new BadRequestException('Approval cancellation is not wired yet');
    }
  }

  private mapRequest(
    request: ApprovalRequestRecord,
    currentUser: CurrentAuthUser,
  ): ApprovalRequestResponseDto {
    const payloadSnapshot = this.normalizePayloadSnapshot(request.payloadSnapshot);
    const canApprove =
      request.status === 'pending' &&
      canResolveApprovalType({
        approvalType: request.approvalType as ApprovalType,
        roleCodes: this.getRoleCodes(currentUser),
        permissionCodes: this.getPermissionCodes(currentUser),
      });
    const canReject =
      canApprove && request.approvalType !== INVENTORY_EXCEPTION_CONFIRMATION_TYPE;
    const canCancel =
      request.status === 'pending' &&
      request.approvalType === TASK_RESULT_CONFIRMATION_TYPE &&
      request.createdByUserId === currentUser.id;

    return {
      id: request.id,
      approvalType: request.approvalType,
      sourceEntityType: request.sourceEntityType,
      sourceEntityId: request.sourceEntityId,
      status: request.status,
      decisionComment: request.decisionComment,
      payloadSnapshot,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      resolvedAt: request.resolvedAt?.toISOString() ?? null,
      cancelledAt: request.cancelledAt?.toISOString() ?? null,
      createdBy: request.createdBy,
      resolvedBy: request.resolvedBy,
      cancelledBy: request.cancelledBy,
      summary: {
        title:
          this.getStringPayloadValue(payloadSnapshot, 'summaryTitle') ??
          request.approvalType,
        subtitle:
          this.getStringPayloadValue(payloadSnapshot, 'summarySubtitle') ?? null,
      },
      capabilities: {
        canApprove,
        canReject,
        canCancel,
      },
    };
  }

  private normalizePayloadSnapshot(
    payloadSnapshot: Prisma.JsonValue,
  ): Record<string, unknown> {
    if (
      payloadSnapshot !== null &&
      typeof payloadSnapshot === 'object' &&
      !Array.isArray(payloadSnapshot)
    ) {
      return payloadSnapshot as Prisma.JsonObject as Record<string, unknown>;
    }

    return {
      value: payloadSnapshot,
    };
  }

  private getStringPayloadValue(
    payloadSnapshot: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = payloadSnapshot[key];
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private parseTaskStatus(value: unknown): TaskStatus | null {
    return typeof value === 'string' &&
      ['assigned', 'in_progress', 'partially_completed', 'returned_to_work', 'awaiting_confirmation', 'closed'].includes(
        value,
      )
      ? (value as TaskStatus)
      : null;
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
}
