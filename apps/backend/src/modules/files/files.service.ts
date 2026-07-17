import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
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
import {
  canReviewAccountability,
  canViewOwnAccountability,
} from '../accountability/utils/accountability-access.util';
import { canAccessEquipment } from '../equipment/utils/equipment-access.util';
import {
  buildOneTimeOrderAccessWhere,
  canEditOneTimeOrderByScope,
  canViewOneTimeOrderByScope,
} from '../one-time-orders/utils/one-time-order-access.util';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { buildTaskAccessWhere } from '../tasks/utils/task-access.util';
import {
  canManageChats,
  hasOperationalChatRole,
  isChatLeadership,
} from '../chats/utils/chat-access.util';

import { SafeFileResponseDto } from './dto/safe-file-response.dto';
import { FileViewResponseDto } from './dto/file-view-response.dto';
import { UploadFileBodyDto } from './dto/upload-file-body.dto';
import {
  FileAttachmentEntityType,
  isAllowedFileAttachmentFieldCode,
  isFileAttachmentEntityType,
} from './constants/file-attachment-policy.constants';
import {
  IMAGE_THUMBNAIL_DERIVATIVE,
  INLINE_IMAGE_MIME_TYPES,
  INLINE_TEXT_MIME_TYPES,
  OFFICE_MIME_TYPES,
  PDF_PREVIEW_DERIVATIVE,
  getFilePreviewType,
  type FilePreviewStatus,
} from './constants/file-preview.constants';
import { FilePreviewService } from './file-preview.service';
import { mapSafeFileResponse } from './utils/safe-file-response.mapper';

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
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
    private readonly filePreviewService: FilePreviewService,
  ) {}

  async upload(
    currentUser: CurrentAuthUser,
    body: UploadFileBodyDto,
    file: UploadedFilePayload,
  ): Promise<SafeFileResponseDto> {
    const entityType = this.parseEntityType(body.entityType);
    this.assertValidFieldCode(entityType, body.fieldCode ?? null);
    await this.assertEntityWritable(currentUser, entityType, body.entityId);

    const verifiedMimeType = this.detectMimeType(file.buffer, file.mimetype);
    const objectKey = this.buildObjectKey(entityType, file.originalname);
    const storageResult = await this.storageService.uploadObject({
      objectKey,
      body: file.buffer,
      contentType: verifiedMimeType,
      contentLength: file.size,
    });

    const uploadResult = await this.prisma.$transaction(async (tx) => {
      const storedFile = await tx.file.create({
        data: {
          bucket: storageResult.bucket,
          objectKey: storageResult.objectKey,
          originalName: file.originalname,
          mimeType: verifiedMimeType,
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

    await this.filePreviewService.ensurePreview(uploadResult.file).catch((error) => {
      this.logger.warn(
        `Unable to enqueue preview for file ${uploadResult.file?.id ?? 'unknown'}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    });

    return mapSafeFileResponse(uploadResult.file);
  }

  async getViewById(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<FileViewResponseDto> {
    const file = await this.getReadableFile(currentUser, id);
    const derivative = await this.filePreviewService.ensurePreview(file);

    return this.mapFileView(file, derivative);
  }

  async retryPreview(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<FileViewResponseDto> {
    const file = await this.getReadableFile(currentUser, id);
    await this.filePreviewService.retryPreview(file);

    return this.getViewById(currentUser, id);
  }

  async getThumbnailById(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<{
    body: Buffer;
    mimeType: string;
    sizeBytes: number;
    originalName: string;
  }> {
    const file = await this.getReadableFile(currentUser, id);
    const derivative = file.derivatives.find(
      (item) => item.derivativeType === IMAGE_THUMBNAIL_DERIVATIVE,
    );

    if (!derivative || derivative.status !== 'ready' || !derivative.objectKey) {
      await this.filePreviewService.ensurePreview(file);
      throw new ConflictException('File thumbnail is not ready');
    }

    const storedObject = await this.storageService.downloadObject(
      derivative.objectKey,
    );

    return {
      body: storedObject.body,
      mimeType: derivative.mimeType ?? 'image/webp',
      sizeBytes: derivative.sizeBytes ?? storedObject.body.length,
      originalName: `${file.originalName}.webp`,
    };
  }

  async getPreviewContentById(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<{
    body: Buffer;
    mimeType: string;
    sizeBytes: number;
    originalName: string;
    isTruncated: boolean;
  }> {
    const file = await this.getReadableFile(currentUser, id);

    if (
      INLINE_IMAGE_MIME_TYPES.has(file.mimeType) ||
      file.mimeType === 'application/pdf'
    ) {
      const storedObject = await this.storageService.downloadObject(file.objectKey);
      return {
        body: storedObject.body,
        mimeType: file.mimeType,
        sizeBytes: storedObject.body.length,
        originalName: file.originalName,
        isTruncated: false,
      };
    }

    if (INLINE_TEXT_MIME_TYPES.has(file.mimeType)) {
      const storedObject = await this.storageService.downloadObject(file.objectKey);
      const maximumPreviewBytes = 512 * 1024;
      const body = storedObject.body.subarray(0, maximumPreviewBytes);
      return {
        body,
        mimeType: 'text/plain; charset=utf-8',
        sizeBytes: body.length,
        originalName: file.originalName,
        isTruncated: storedObject.body.length > body.length,
      };
    }

    if (OFFICE_MIME_TYPES.has(file.mimeType)) {
      const derivative = file.derivatives.find(
        (item) => item.derivativeType === PDF_PREVIEW_DERIVATIVE,
      );

      if (!derivative || derivative.status !== 'ready' || !derivative.objectKey) {
        await this.filePreviewService.ensurePreview(file);
        throw new ConflictException('File preview is not ready');
      }

      const storedObject = await this.storageService.downloadObject(
        derivative.objectKey,
      );
      return {
        body: storedObject.body,
        mimeType: 'application/pdf',
        sizeBytes: derivative.sizeBytes ?? storedObject.body.length,
        originalName: `${file.originalName}.pdf`,
        isTruncated: false,
      };
    }

    throw new UnsupportedMediaTypeException('File preview is not supported');
  }

  async getById(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<SafeFileResponseDto> {
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

    return mapSafeFileResponse(file);
  }

  async listByEntity(params: {
    currentUser: CurrentAuthUser;
    entityType: string;
    entityId: string;
  }): Promise<SafeFileResponseDto[]> {
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
        file: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return attachments.map((attachment) =>
      mapSafeFileResponse(attachment.file),
    );
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

  private async getReadableFile(currentUser: CurrentAuthUser, id: string) {
    const file = await this.prisma.file.findFirst({
      where: { id, deletedAt: null },
      include: {
        attachments: {
          orderBy: { createdAt: 'asc' },
        },
        derivatives: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    await this.assertFileReadable(currentUser, file.attachments);

    return file;
  }

  private mapFileView(
    file: Awaited<ReturnType<FilesService['getReadableFile']>>,
    derivative: {
      derivativeType: string;
      status: string;
      objectKey: string | null;
      errorMessage: string | null;
    } | null,
  ): FileViewResponseDto {
    const previewType = getFilePreviewType(file.mimeType);
    const usesDerivative =
      INLINE_IMAGE_MIME_TYPES.has(file.mimeType) ||
      OFFICE_MIME_TYPES.has(file.mimeType);
    const previewStatus: FilePreviewStatus = usesDerivative
      ? this.parsePreviewStatus(derivative?.status)
      : previewType === 'unsupported'
        ? 'failed'
        : 'ready';
    const isReady = previewStatus === 'ready';

    return {
      id: file.id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      previewType,
      previewStatus,
      thumbnailUrl:
        isReady && INLINE_IMAGE_MIME_TYPES.has(file.mimeType)
          ? `/api/v1/files/${file.id}/thumbnail`
          : null,
      inlineContentUrl:
        isReady && previewType !== 'unsupported'
          ? `/api/v1/files/${file.id}/preview/content`
          : null,
      downloadUrl: `/api/v1/files/${file.id}/content?download=1`,
      errorMessage:
        previewType === 'unsupported'
          ? 'Предпросмотр недоступен для этого формата'
          : derivative?.errorMessage ?? null,
    };
  }

  private parsePreviewStatus(status: string | undefined): FilePreviewStatus {
    if (
      status === 'pending' ||
      status === 'processing' ||
      status === 'ready' ||
      status === 'failed'
    ) {
      return status;
    }

    return 'pending';
  }

  private detectMimeType(buffer: Buffer, claimedMimeType: string): string {
    if (buffer.subarray(0, 4).equals(Buffer.from([0x25, 0x50, 0x44, 0x46]))) {
      return 'application/pdf';
    }

    if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
      return 'image/jpeg';
    }

    if (
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
      return 'image/png';
    }

    const header = buffer.subarray(0, 16).toString('ascii');

    if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) {
      return 'image/gif';
    }

    if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
      return 'image/webp';
    }

    if (header.slice(4, 12).includes('ftypavif')) {
      return 'image/avif';
    }

    const trimmedText = buffer.subarray(0, 1024).toString('utf8').trimStart();
    const lowerText = trimmedText.toLowerCase();

    if (lowerText.startsWith('<svg') || lowerText.startsWith('<?xml') && lowerText.includes('<svg')) {
      return 'image/svg+xml';
    }

    if (
      lowerText.startsWith('<!doctype html') ||
      lowerText.startsWith('<html')
    ) {
      return 'text/html';
    }

    const isZip = buffer.subarray(0, 2).toString('ascii') === 'PK';
    const isCompoundDocument = buffer
      .subarray(0, 8)
      .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));

    if (
      OFFICE_MIME_TYPES.has(claimedMimeType) &&
      (isZip || isCompoundDocument)
    ) {
      return claimedMimeType;
    }

    if (
      INLINE_TEXT_MIME_TYPES.has(claimedMimeType) &&
      !buffer.subarray(0, 4096).includes(0)
    ) {
      return claimedMimeType;
    }

    return 'application/octet-stream';
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
        return this.canAccessOneTimeOrderPhoto(currentUser, entityId, 'read');
      case 'one_time_order_specification_item':
        return this.canAccessOneTimeOrderSpecificationItem(
          currentUser,
          entityId,
          'read',
        );
      case 'task':
        return this.canAccessTask(currentUser, entityId);
      case 'task_assignee_completion':
        return this.canAccessTaskCompletion(currentUser, entityId, 'read');
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
        return this.canAccessOneTimeOrderPhoto(currentUser, entityId, 'write');
      case 'one_time_order_specification_item':
        return this.canAccessOneTimeOrderSpecificationItem(
          currentUser,
          entityId,
          'write',
        );
      case 'task':
        return this.canAccessTask(currentUser, entityId);
      case 'task_assignee_completion':
        return this.canAccessTaskCompletion(currentUser, entityId, 'write');
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
        AND: [
          { id: taskId },
          buildTaskAccessWhere({
            currentUserId: currentUser.id,
            roleCodes: this.getRoleCodes(currentUser),
          }),
        ],
      },
      select: { id: true },
    });

    if (!task) {
      return false;
    }

    return true;
  }

  private async canAccessTaskCompletion(
    currentUser: CurrentAuthUser,
    completionId: string,
    mode: 'read' | 'write',
  ): Promise<boolean> {
    const completion = await this.prisma.taskAssigneeCompletion.findUnique({
      where: { id: completionId },
      select: {
        status: true,
        workCycle: true,
        taskAssignee: {
          select: {
            userId: true,
            isActive: true,
            task: {
              select: {
                id: true,
                status: true,
                workCycle: true,
              },
            },
          },
        },
      },
    });

    if (!completion) {
      throw new NotFoundException('Task completion not found');
    }

    if (mode === 'read') {
      return this.canAccessTask(currentUser, completion.taskAssignee.task.id);
    }

    const attachmentCount = await this.prisma.fileAttachment.count({
      where: {
        entityType: 'task_assignee_completion',
        entityId: completionId,
      },
    });

    return (
      completion.status === 'draft' &&
      completion.workCycle === completion.taskAssignee.task.workCycle &&
      completion.taskAssignee.isActive &&
      completion.taskAssignee.userId === currentUser.id &&
      completion.taskAssignee.task.status === 'in_progress' &&
      attachmentCount < 10
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
          permissionCodes: this.getPermissionCodes(currentUser),
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
          permissionCodes: this.getPermissionCodes(currentUser),
          order: movement.fromOneTimeOrder,
        })) ||
      (!!movement.toOneTimeOrder &&
        canViewOneTimeOrderByScope({
          currentUserId: currentUser.id,
          roleCodes,
          permissionCodes: this.getPermissionCodes(currentUser),
          order: movement.toOneTimeOrder,
        }))
    );
  }

  private async canAccessOneTimeOrder(
    currentUser: CurrentAuthUser,
    oneTimeOrderId: string,
    mode: 'read' | 'write',
  ): Promise<boolean> {
    const roleCodes = this.getRoleCodes(currentUser);
    const order = await this.prisma.oneTimeOrder.findFirst({
      where: {
        AND: [
          { id: oneTimeOrderId },
          ...(mode === 'read'
            ? [
                buildOneTimeOrderAccessWhere({
                  currentUserId: currentUser.id,
                  roleCodes,
                  permissionCodes: this.getPermissionCodes(currentUser),
                }),
              ]
            : []),
        ],
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
      return false;
    }

    if (mode === 'read') {
      return true;
    }

    return canEditOneTimeOrderByScope({
      currentUserId: currentUser.id,
      roleCodes,
      permissionCodes: this.getPermissionCodes(currentUser),
      order,
    });
  }

  private async canAccessOneTimeOrderSpecificationItem(
    currentUser: CurrentAuthUser,
    entityId: string,
    mode: 'read' | 'write',
  ): Promise<boolean> {
    const item = await this.prisma.oneTimeOrderSpecificationItem.findFirst({
      where: {
        id: entityId,
        deletedAt: null,
      },
      select: {
        oneTimeOrderId: true,
        oneTimeOrder: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundException(
        'Attachment target one-time order specification item not found',
      );
    }

    if (
      mode === 'write' &&
      (item.oneTimeOrder.status === 'completed' ||
        item.oneTimeOrder.status === 'cancelled')
    ) {
      return false;
    }

    return this.canAccessOneTimeOrder(
      currentUser,
      item.oneTimeOrderId,
      mode,
    );
  }

  private async canAccessOneTimeOrderPhoto(
    currentUser: CurrentAuthUser,
    entityId: string,
    mode: 'read' | 'write',
  ): Promise<boolean> {
    const photo = await this.prisma.oneTimeOrderPhoto.findFirst({
      where: { id: entityId },
      select: {
        oneTimeOrderId: true,
        deletedAt: true,
      },
    });

    if (!photo) {
      throw new NotFoundException('Attachment target one-time order photo not found');
    }

    if (photo.deletedAt) {
      return false;
    }

    return this.canAccessOneTimeOrder(
      currentUser,
      photo.oneTimeOrderId,
      mode,
    );
  }

  private async canAccessOneTimeOrderScopedEntity(
    currentUser: CurrentAuthUser,
    modelName:
      | 'oneTimeOrderComment'
      | 'oneTimeOrderDailyReport',
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
    const ownerCanAccess =
      isOwner &&
      (await this.canCurrentUserViewOwnAccountability(currentUser));

    if (mode === 'write') {
      return (
        ownerCanAccess &&
        expense.createdByUserId === currentUser.id &&
        expense.accountabilityAccount.status === 'active' &&
        expense.status === 'draft'
      );
    }

    return (
      ownerCanAccess ||
      canReviewAccountability({
        roleCodes: this.getRoleCodes(currentUser),
        permissionCodes: this.getPermissionCodes(currentUser),
      })
    );
  }

  private async canCurrentUserViewOwnAccountability(
    currentUser: CurrentAuthUser,
  ): Promise<boolean> {
    const roleCodes = this.getRoleCodes(currentUser);

    if (canViewOwnAccountability({ roleCodes })) {
      return true;
    }

    const [activeAssignment, historicalReceipt] = await Promise.all([
      this.prisma.oneTimeOrderAssignment.findFirst({
        where: {
          userId: currentUser.id,
          assignmentRoleCode: 'one_time_manager',
          isActive: true,
        },
        select: { id: true },
      }),
      this.prisma.accountabilityFunding.findFirst({
        where: {
          fundingType: 'one_time_order_receipt',
          accountabilityAccount: { userId: currentUser.id },
        },
        select: { id: true },
      }),
    ]);

    return canViewOwnAccountability({
      roleCodes,
      hasActiveOneTimeManagerAssignment: activeAssignment !== null,
      hasHistoricalOneTimeOrderReceipt: historicalReceipt !== null,
    });
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
        leftAt: true,
      },
    });

    if (message.chatRoom.visibilityType === 'explicit_members') {
      const canReadMessage =
        !!participant &&
        participant.leftAt === null &&
        message.createdAt >= participant.joinedAt;

      if (!canReadMessage) {
        return false;
      }
    } else if (participant && message.createdAt < participant.joinedAt) {
      return false;
    }

    if (mode === 'write') {
      return (
        message.authorUserId === currentUser.id ||
        canManageChats(this.getRoleCodes(currentUser))
      );
    }

    return true;
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
          leftAt: true,
        },
      });

      return !!participant && participant.leftAt === null;
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

}
