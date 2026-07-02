import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AuditService } from '../audit/audit.service';
import {
  INVENTORY_EXCEPTION_CONFIRMATION_TYPE,
  INVENTORY_MOVEMENT_APPROVAL_SOURCE_ENTITY_TYPE,
} from '../approvals/constants/approval.constants';
import {
  canEditObject,
  canOverrideFrozenObject,
  hasWideObjectAccess,
} from '../objects/utils/object-access.util';
import {
  canAccessInventory,
  canCreateInventoryMovement,
} from '../inventory/utils/inventory-access.util';
import { canReviewAccountability } from '../accountability/utils/accountability-access.util';
import { canAccessEquipment } from '../equipment/utils/equipment-access.util';
import {
  canEditOneTimeOrderByScope,
  canViewOneTimeOrderByScope,
} from '../one-time-orders/utils/one-time-order-access.util';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { hasWideTaskAccess } from '../tasks/utils/task-access.util';
import {
  canManageChats,
  hasOperationalChatRole,
  isChatLeadership,
} from '../chats/utils/chat-access.util';

import { FileResponseDto } from './dto/file-response.dto';
import { UploadFileBodyDto } from './dto/upload-file-body.dto';
import {
  FileAttachmentEntityType,
  isAllowedFileAttachmentFieldCode,
  isFileAttachmentEntityType,
} from './constants/file-attachment-policy.constants';

interface CurrentAuthUser {
  id: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
}

interface UploadedFilePayload {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
  ) {}

  async upload(
    currentUser: CurrentAuthUser,
    body: UploadFileBodyDto,
    file: UploadedFilePayload,
  ): Promise<FileResponseDto> {
    const entityType = this.parseEntityType(body.entityType);
    this.assertValidFieldCode(entityType, body.fieldCode ?? null);
    await this.assertEntityWritable(currentUser, entityType, body.entityId);

    const objectKey = this.buildObjectKey(entityType, file.originalname);
    const storageResult = await this.storageService.uploadObject({
      objectKey,
      body: file.buffer,
      contentType: file.mimetype,
      contentLength: file.size,
    });

    const uploadResult = await this.prisma.$transaction(async (tx) => {
      const storedFile = await tx.file.create({
        data: {
          bucket: storageResult.bucket,
          objectKey: storageResult.objectKey,
          originalName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          uploadedByUserId: currentUser.id,
        },
      });

      await tx.fileAttachment.create({
        data: {
          fileId: storedFile.id,
          entityType,
          entityId: body.entityId,
          fieldCode: body.fieldCode ?? null,
          uploadedByUserId: currentUser.id,
        },
      });

      let cancelledApprovalRequestIds: string[] = [];

      if (entityType === 'inventory_movement') {
        const pendingApprovalRequests = await tx.approvalRequest.findMany({
          where: {
            approvalType: INVENTORY_EXCEPTION_CONFIRMATION_TYPE,
            sourceEntityType: INVENTORY_MOVEMENT_APPROVAL_SOURCE_ENTITY_TYPE,
            sourceEntityId: body.entityId,
            status: 'pending',
          },
          select: {
            id: true,
          },
        });

        await tx.inventoryMovement.updateMany({
          where: {
            id: body.entityId,
          },
          data: {
            requiresApprovalBridge: false,
            approvalBridgeType: null,
            approvalBridgeResolvedAt: null,
            approvalBridgeResolvedByUserId: null,
          },
        });

        if (pendingApprovalRequests.length > 0) {
          cancelledApprovalRequestIds = pendingApprovalRequests.map(
            (request) => request.id,
          );

          await tx.approvalRequest.updateMany({
            where: {
              id: {
                in: cancelledApprovalRequestIds,
              },
            },
            data: {
              status: 'cancelled',
              cancelledByUserId: currentUser.id,
              cancelledAt: new Date(),
              decisionComment: 'Evidence attached to inventory movement',
            },
          });
        }
      }

      const createdFile = await tx.file.findUnique({
        where: { id: storedFile.id },
        include: {
          attachments: {
            orderBy: {
              createdAt: 'asc',
            },
          },
        },
      });

      return {
        file: createdFile,
        cancelledApprovalRequestIds,
      };
    });

    if (!uploadResult.file) {
      throw new NotFoundException('Stored file not found after upload');
    }

    for (const approvalRequestId of uploadResult.cancelledApprovalRequestIds) {
      await this.auditService.writeAuditEvent({
        entityType: 'approval_request',
        entityId: approvalRequestId,
        actorUserId: currentUser.id,
        action: 'approval.request.cancelled',
        newValues: {
          approvalType: INVENTORY_EXCEPTION_CONFIRMATION_TYPE,
          sourceEntityType: INVENTORY_MOVEMENT_APPROVAL_SOURCE_ENTITY_TYPE,
          sourceEntityId: body.entityId,
          decisionComment: 'Evidence attached to inventory movement',
        },
      });
    }

    return this.mapFile(uploadResult.file);
  }

  async getById(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<FileResponseDto> {
    const file = await this.prisma.file.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        attachments: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    await this.assertFileReadable(currentUser, file.attachments);

    return this.mapFile(file);
  }

  async listByEntity(params: {
    currentUser: CurrentAuthUser;
    entityType: string;
    entityId: string;
  }): Promise<FileResponseDto[]> {
    const entityType = this.parseEntityType(params.entityType);
    await this.assertEntityReadable(params.currentUser, entityType, params.entityId);

    const attachments = await this.prisma.fileAttachment.findMany({
      where: {
        entityType,
        entityId: params.entityId,
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

    return attachments.map((attachment) => this.mapFile(attachment.file));
  }

  async getContentById(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<{
    body: Buffer;
    mimeType: string;
    sizeBytes: number;
    originalName: string;
  }> {
    const file = await this.prisma.file.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        attachments: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    await this.assertFileReadable(currentUser, file.attachments);

    const storedObject = await this.storageService.downloadObject(file.objectKey);

    return {
      body: storedObject.body,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      originalName: file.originalName,
    };
  }

  private buildObjectKey(
    entityType: FileAttachmentEntityType,
    originalName: string,
  ): string {
    const normalizedFileName = originalName
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9._-]/g, '')
      .toLowerCase();

    return `${entityType}/${randomUUID()}-${normalizedFileName || 'file'}`;
  }

  private buildDownloadUrl(fileId: string): string {
    return `/api/v1/files/${fileId}/content`;
  }

  private parseEntityType(rawEntityType: string): FileAttachmentEntityType {
    if (!isFileAttachmentEntityType(rawEntityType)) {
      throw new BadRequestException('Unsupported file attachment entityType');
    }

    return rawEntityType;
  }

  private assertValidFieldCode(
    entityType: FileAttachmentEntityType,
    fieldCode: string | null,
  ): void {
    if (!fieldCode) {
      return;
    }

    if (!isAllowedFileAttachmentFieldCode(entityType, fieldCode)) {
      throw new BadRequestException(
        `fieldCode is not supported for entityType ${entityType}`,
      );
    }
  }

  private async assertFileReadable(
    currentUser: CurrentAuthUser,
    attachments: Array<{
      entityType: string;
      entityId: string;
    }>,
  ): Promise<void> {
    for (const attachment of attachments) {
      const entityType = this.parseEntityType(attachment.entityType);

      if (
        await this.canReadEntity(currentUser, entityType, attachment.entityId)
      ) {
        return;
      }
    }

    throw new ForbiddenException('Access to file denied');
  }

  private async assertEntityReadable(
    currentUser: CurrentAuthUser,
    entityType: FileAttachmentEntityType,
    entityId: string,
  ): Promise<void> {
    if (!(await this.canReadEntity(currentUser, entityType, entityId))) {
      throw new ForbiddenException('Access to file attachments denied');
    }
  }

  private async assertEntityWritable(
    currentUser: CurrentAuthUser,
    entityType: FileAttachmentEntityType,
    entityId: string,
  ): Promise<void> {
    if (!(await this.canWriteEntity(currentUser, entityType, entityId))) {
      throw new ForbiddenException('File upload denied for selected entity');
    }
  }

  private async canReadEntity(
    currentUser: CurrentAuthUser,
    entityType: FileAttachmentEntityType,
    entityId: string,
  ): Promise<boolean> {
    switch (entityType) {
      case 'object':
        return this.canReadObject(currentUser, entityId);
      case 'object_arrival_photo':
        return this.canAccessObjectScopedEntity(currentUser, 'objectArrivalPhoto', entityId);
      case 'object_daily_report':
        return this.canAccessObjectScopedEntity(currentUser, 'objectDailyReport', entityId);
      case 'object_comment':
        return this.canAccessObjectScopedEntity(currentUser, 'objectComment', entityId);
      case 'one_time_order_comment':
        return this.canAccessOneTimeOrderScopedEntity(
          currentUser,
          'oneTimeOrderComment',
          entityId,
        );
      case 'one_time_order_daily_report':
        return this.canAccessOneTimeOrderScopedEntity(
          currentUser,
          'oneTimeOrderDailyReport',
          entityId,
        );
      case 'one_time_order_photo':
        return this.canAccessOneTimeOrderScopedEntity(
          currentUser,
          'oneTimeOrderPhoto',
          entityId,
        );
      case 'task':
        return this.canAccessTask(currentUser, entityId);
      case 'one_time_order':
        return this.canAccessOneTimeOrder(currentUser, entityId, 'read');
      case 'inventory_movement':
        return this.canAccessInventoryMovement(currentUser, entityId, 'read');
      case 'equipment_movement':
        return this.canAccessEquipmentMovement(currentUser, entityId, 'read');
      case 'accountability_expense':
        return this.canAccessAccountabilityExpense(currentUser, entityId, 'read');
      case 'chat_message':
        return this.canAccessChatMessage(currentUser, entityId, 'read');
    }
  }

  private async canWriteEntity(
    currentUser: CurrentAuthUser,
    entityType: FileAttachmentEntityType,
    entityId: string,
  ): Promise<boolean> {
    switch (entityType) {
      case 'object':
        return this.canWriteObjectCore(currentUser, entityId);
      case 'object_arrival_photo':
      case 'object_daily_report':
      case 'object_comment':
        return this.canAccessObjectScopedEntity(
          currentUser,
          entityType === 'object_arrival_photo'
            ? 'objectArrivalPhoto'
            : entityType === 'object_daily_report'
              ? 'objectDailyReport'
            : 'objectComment',
          entityId,
        );
      case 'one_time_order_comment':
        return this.canAccessOneTimeOrderScopedEntity(
          currentUser,
          'oneTimeOrderComment',
          entityId,
          'write',
        );
      case 'one_time_order_daily_report':
        return this.canAccessOneTimeOrderScopedEntity(
          currentUser,
          'oneTimeOrderDailyReport',
          entityId,
          'write',
        );
      case 'one_time_order_photo':
        return this.canAccessOneTimeOrderScopedEntity(
          currentUser,
          'oneTimeOrderPhoto',
          entityId,
          'write',
        );
      case 'task':
        return this.canAccessTask(currentUser, entityId);
      case 'one_time_order':
        return this.canAccessOneTimeOrder(currentUser, entityId, 'write');
      case 'inventory_movement':
        return this.canAccessInventoryMovement(currentUser, entityId, 'write');
      case 'equipment_movement':
        return this.canAccessEquipmentMovement(currentUser, entityId, 'write');
      case 'accountability_expense':
        return this.canAccessAccountabilityExpense(currentUser, entityId, 'write');
      case 'chat_message':
        return this.canAccessChatMessage(currentUser, entityId, 'write');
    }
  }

  private async canReadObject(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<boolean> {
    const object = await this.prisma.object.findFirst({
      where: {
        id: objectId,
        deletedAt: null,
      },
      select: {
        createdByUserId: true,
        assignments: {
          where: {
            isActive: true,
          },
          select: {
            userId: true,
          },
        },
      },
    });

    if (!object) {
      throw new NotFoundException('Attachment target object not found');
    }

    const roleCodes = this.getRoleCodes(currentUser);

    return (
      hasWideObjectAccess(roleCodes) ||
      object.createdByUserId === currentUser.id ||
      object.assignments.some((assignment) => assignment.userId === currentUser.id)
    );
  }

  private async canWriteObjectCore(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<boolean> {
    const object = await this.prisma.object.findFirst({
      where: {
        id: objectId,
        deletedAt: null,
      },
      select: {
        status: true,
      },
    });

    if (!object) {
      throw new NotFoundException('Attachment target object not found');
    }

    const roleCodes = this.getRoleCodes(currentUser);

    return (
      canEditObject(roleCodes) ||
      (object.status === 'frozen' && canOverrideFrozenObject(roleCodes))
    );
  }

  private async canAccessObjectScopedEntity(
    currentUser: CurrentAuthUser,
    modelName: 'objectArrivalPhoto' | 'objectDailyReport' | 'objectComment',
    entityId: string,
  ): Promise<boolean> {
    const model = (this.prisma as {
      objectArrivalPhoto: {
        findFirst(args: unknown): Promise<{ objectId: string } | null>;
      };
      objectDailyReport: {
        findFirst(args: unknown): Promise<{ objectId: string } | null>;
      };
      objectComment: {
        findFirst(args: unknown): Promise<{ objectId: string } | null>;
      };
    })[modelName];

    const item = await model.findFirst({
      where: {
        id: entityId,
      },
      select: {
        objectId: true,
      },
    });

    if (!item) {
      throw new NotFoundException('Attachment target entity not found');
    }

    // Bridge baseline: object-scoped file uploads follow the same access gate
    // as current object operations until a finer-grained capability model lands.
    return this.canReadObject(currentUser, item.objectId);
  }

  private async canAccessTask(
    currentUser: CurrentAuthUser,
    taskId: string,
  ): Promise<boolean> {
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
      },
      select: {
        createdByUserId: true,
        object: {
          select: {
            createdByUserId: true,
            assignments: {
              where: {
                isActive: true,
              },
              select: {
                userId: true,
                assignmentRoleCode: true,
              },
            },
          },
        },
        oneTimeOrder: {
          select: {
            createdByUserId: true,
            assignments: {
              where: {
                isActive: true,
              },
              select: {
                userId: true,
                assignmentRoleCode: true,
                isActive: true,
              },
            },
          },
        },
        assignees: {
          select: {
            userId: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Attachment target task not found');
    }

    const roleCodes = this.getRoleCodes(currentUser);

    return (
      hasWideTaskAccess(roleCodes) ||
      task.createdByUserId === currentUser.id ||
      task.assignees.some((assignee) => assignee.userId === currentUser.id) ||
      (!!task.object &&
        (task.object.createdByUserId === currentUser.id ||
          task.object.assignments.some(
            (assignment) => assignment.userId === currentUser.id,
          ))) ||
      (!!task.oneTimeOrder &&
        canViewOneTimeOrderByScope({
          currentUserId: currentUser.id,
          roleCodes,
          order: task.oneTimeOrder,
        }))
    );
  }

  private async canAccessInventoryMovement(
    currentUser: CurrentAuthUser,
    movementId: string,
    mode: 'read' | 'write',
  ): Promise<boolean> {
    const movement = await this.prisma.inventoryMovement.findFirst({
      where: {
        id: movementId,
      },
      select: {
        id: true,
        createdByUserId: true,
        relatedObject: {
          select: {
            createdByUserId: true,
            assignments: {
              where: {
                isActive: true,
              },
              select: {
                userId: true,
              },
            },
          },
        },
        relatedOneTimeOrder: {
          select: {
            createdByUserId: true,
            assignments: {
              where: {
                isActive: true,
              },
              select: {
                userId: true,
                assignmentRoleCode: true,
                isActive: true,
              },
            },
          },
        },
      },
    });

    if (!movement) {
      throw new NotFoundException('Attachment target inventory movement not found');
    }

    const roleCodes = this.getRoleCodes(currentUser);

    if (mode === 'write') {
      return (
        canCreateInventoryMovement(roleCodes) ||
        movement.createdByUserId === currentUser.id
      );
    }

    return (
      canAccessInventory(roleCodes) ||
      movement.createdByUserId === currentUser.id ||
      (!!movement.relatedObject &&
        (movement.relatedObject.createdByUserId === currentUser.id ||
          movement.relatedObject.assignments.some(
            (assignment) => assignment.userId === currentUser.id,
          ))) ||
      (!!movement.relatedOneTimeOrder &&
        canViewOneTimeOrderByScope({
          currentUserId: currentUser.id,
          roleCodes,
          order: movement.relatedOneTimeOrder,
        }))
    );
  }

  private async canAccessEquipmentMovement(
    currentUser: CurrentAuthUser,
    movementId: string,
    mode: 'read' | 'write',
  ): Promise<boolean> {
    const movement = await this.prisma.equipmentMovement.findFirst({
      where: { id: movementId },
      select: {
        createdByUserId: true,
        fromObject: {
          select: {
            createdByUserId: true,
            assignments: {
              where: { isActive: true },
              select: { userId: true },
            },
          },
        },
        toObject: {
          select: {
            createdByUserId: true,
            assignments: {
              where: { isActive: true },
              select: { userId: true },
            },
          },
        },
        fromOneTimeOrder: {
          select: {
            createdByUserId: true,
            assignments: {
              where: { isActive: true },
              select: { userId: true, assignmentRoleCode: true, isActive: true },
            },
          },
        },
        toOneTimeOrder: {
          select: {
            createdByUserId: true,
            assignments: {
              where: { isActive: true },
              select: { userId: true, assignmentRoleCode: true, isActive: true },
            },
          },
        },
      },
    });

    if (!movement) {
      throw new NotFoundException('Attachment target equipment movement not found');
    }

    const roleCodes = this.getRoleCodes(currentUser);
    if (mode === 'write') {
      return (
        canAccessEquipment(roleCodes) ||
        movement.createdByUserId === currentUser.id
      );
    }

    const canReadObjectLike = (object: typeof movement.fromObject) =>
      !!object &&
      (object.createdByUserId === currentUser.id ||
        object.assignments.some(
          (assignment) => assignment.userId === currentUser.id,
        ));

    return (
      canAccessEquipment(roleCodes) ||
      movement.createdByUserId === currentUser.id ||
      canReadObjectLike(movement.fromObject) ||
      canReadObjectLike(movement.toObject) ||
      (!!movement.fromOneTimeOrder &&
        canViewOneTimeOrderByScope({
          currentUserId: currentUser.id,
          roleCodes,
          order: movement.fromOneTimeOrder,
        })) ||
      (!!movement.toOneTimeOrder &&
        canViewOneTimeOrderByScope({
          currentUserId: currentUser.id,
          roleCodes,
          order: movement.toOneTimeOrder,
        }))
    );
  }

  private async canAccessOneTimeOrder(
    currentUser: CurrentAuthUser,
    oneTimeOrderId: string,
    mode: 'read' | 'write',
  ): Promise<boolean> {
    const order = await this.prisma.oneTimeOrder.findFirst({
      where: {
        id: oneTimeOrderId,
      },
      select: {
        createdByUserId: true,
        assignments: {
          where: {
            isActive: true,
          },
          select: {
            userId: true,
            assignmentRoleCode: true,
            isActive: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Attachment target one-time order not found');
    }

    const roleCodes = this.getRoleCodes(currentUser);

    if (mode === 'read') {
      return canViewOneTimeOrderByScope({
        currentUserId: currentUser.id,
        roleCodes,
        order,
      });
    }

    return canEditOneTimeOrderByScope({
      currentUserId: currentUser.id,
      roleCodes,
      order,
    });
  }

  private async canAccessOneTimeOrderScopedEntity(
    currentUser: CurrentAuthUser,
    modelName:
      | 'oneTimeOrderComment'
      | 'oneTimeOrderDailyReport'
      | 'oneTimeOrderPhoto',
    entityId: string,
    mode: 'read' | 'write' = 'read',
  ): Promise<boolean> {
    const model = (this.prisma as unknown as {
      oneTimeOrderComment: {
        findFirst(args: unknown): Promise<{ oneTimeOrderId: string } | null>;
      };
      oneTimeOrderDailyReport: {
        findFirst(args: unknown): Promise<{ oneTimeOrderId: string } | null>;
      };
      oneTimeOrderPhoto: {
        findFirst(args: unknown): Promise<{ oneTimeOrderId: string } | null>;
      };
    })[modelName];

    const item = await model.findFirst({
      where: {
        id: entityId,
      },
      select: {
        oneTimeOrderId: true,
      },
    });

    if (!item) {
      throw new NotFoundException('Attachment target one-time order entity not found');
    }

    return this.canAccessOneTimeOrder(currentUser, item.oneTimeOrderId, mode);
  }

  private async canAccessAccountabilityExpense(
    currentUser: CurrentAuthUser,
    expenseId: string,
    mode: 'read' | 'write',
  ): Promise<boolean> {
    const expense = await this.prisma.accountabilityExpense.findFirst({
      where: {
        id: expenseId,
      },
      select: {
        status: true,
        createdByUserId: true,
        accountabilityAccount: {
          select: {
            userId: true,
            status: true,
          },
        },
      },
    });

    if (!expense) {
      throw new NotFoundException('Attachment target accountability expense not found');
    }

    const isOwner = expense.accountabilityAccount.userId === currentUser.id;

    if (mode === 'write') {
      return (
        isOwner &&
        expense.createdByUserId === currentUser.id &&
        expense.accountabilityAccount.status === 'active' &&
        expense.status === 'draft'
      );
    }

    return (
      isOwner ||
      canReviewAccountability({
        roleCodes: this.getRoleCodes(currentUser),
        permissionCodes: this.getPermissionCodes(currentUser),
      })
    );
  }

  private async canAccessChatMessage(
    currentUser: CurrentAuthUser,
    messageId: string,
    mode: 'read' | 'write',
  ): Promise<boolean> {
    const message = await this.prisma.chatMessage.findFirst({
      where: {
        id: messageId,
      },
      include: {
        chatRoom: true,
      },
    });

    if (!message) {
      throw new NotFoundException('Attachment target chat message not found');
    }

    if (message.deletedAt || message.chatRoom.deletedAt) {
      return false;
    }

    if (mode === 'write') {
      return (
        message.authorUserId === currentUser.id ||
        canManageChats(this.getRoleCodes(currentUser))
      );
    }

    const canAccessRoom = await this.canAccessChatRoom(
      currentUser,
      message.chatRoom,
    );

    if (!canAccessRoom) {
      return false;
    }

    const participant = await this.prisma.chatRoomParticipant.findUnique({
      where: {
        chatRoomId_userId: {
          chatRoomId: message.chatRoomId,
          userId: currentUser.id,
        },
      },
      select: {
        joinedAt: true,
      },
    });

    if (message.chatRoom.visibilityType === 'explicit_members') {
      return !!participant && message.createdAt >= participant.joinedAt;
    }

    return !participant || message.createdAt >= participant.joinedAt;
  }

  private async canAccessChatRoom(
    currentUser: CurrentAuthUser,
    room: {
      id: string;
      visibilityType: string;
    },
  ): Promise<boolean> {
    const roleCodes = this.getRoleCodes(currentUser);

    if (room.visibilityType === 'leadership_only') {
      return isChatLeadership(roleCodes);
    }

    if (room.visibilityType === 'objects_scope') {
      return (
        hasOperationalChatRole(roleCodes) ||
        (await this.hasActiveObjectAssignment(currentUser.id))
      );
    }

    if (room.visibilityType === 'one_time_orders_scope') {
      return (
        hasOperationalChatRole(roleCodes) ||
        (await this.hasActiveOneTimeOrderManagerAssignment(currentUser.id))
      );
    }

    if (room.visibilityType === 'explicit_members') {
      const participant = await this.prisma.chatRoomParticipant.findUnique({
        where: {
          chatRoomId_userId: {
            chatRoomId: room.id,
            userId: currentUser.id,
          },
        },
        select: {
          id: true,
        },
      });

      return !!participant;
    }

    return false;
  }

  private async hasActiveObjectAssignment(userId: string): Promise<boolean> {
    const count = await this.prisma.objectAssignment.count({
      where: {
        userId,
        isActive: true,
      },
    });

    return count > 0;
  }

  private async hasActiveOneTimeOrderManagerAssignment(
    userId: string,
  ): Promise<boolean> {
    const count = await this.prisma.oneTimeOrderAssignment.count({
      where: {
        userId,
        isActive: true,
        assignmentRoleCode: 'one_time_manager',
      },
    });

    return count > 0;
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

  private mapFile(file: {
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
  }): FileResponseDto {
    return {
      id: file.id,
      bucket: file.bucket,
      objectKey: file.objectKey,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      uploadedByUserId: file.uploadedByUserId,
      createdAt: file.createdAt.toISOString(),
      url: this.buildDownloadUrl(file.id),
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
