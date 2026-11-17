import { projectCommittedWrite, type SavedWithoutAccess } from '../../common/access/project-committed-write';
import { isChatMessageSourceAllowed } from '../../common/access/chat-message-source-access';
import { resolveRoomMembership } from '../chats/utils/chat-membership.util';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { ObjectPlanningService } from '../objects/object-planning.service';
import { ModuleRef } from '@nestjs/core';
import { loadAccessSubject } from '../../common/access/notification-access';
import { lockActorAccessRevision } from '../../common/access/lock-actor-access-revision';
import { canAttachStandaloneInventoryPhoto, canUseLegacyStandaloneInventoryAttachments, isInventoryPhotoDay } from '../inventory/utils/inventory-photo.util';
import { inventoryTransaction } from '../inventory/utils/inventory-transaction.util';

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
  hasActiveOneTimeOrderAssignment,
} from '../one-time-orders/utils/one-time-order-access.util';
import { PrismaService } from '../prisma/prisma.service';
import { hasDelegatedObjectAction, hasDelegatedTaskAction, objectDelegationContext } from '../user-substitutions/object-delegation.context';
import { resolveObjectDelegationGrants } from '../user-substitutions/resolve-object-delegation-grants.util';
import { StorageService } from '../storage/storage.service';
import { buildTaskAccessWhere } from '../tasks/utils/task-access.util';
import { taskVisibilityWhere } from '../tasks/utils/task-policy.util';
import {
  canManageChats,
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
import { resourceAccessTarget } from '../../common/access/resource-access-context';
import { decideAccess, hasModuleDeny, type AccessSubject, type AccessContext } from '../users-access/utils/access-policy.util';

interface CurrentAuthUser extends AccessSubject {
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
    private readonly moduleRef: ModuleRef,
  ) {}

  async upload(
    currentUser: CurrentAuthUser,
    body: UploadFileBodyDto,
    file: UploadedFilePayload,
  ): Promise<SafeFileResponseDto> {
    const entityType = this.parseEntityType(body.entityType);
    if (entityType === 'object_daily_report') {
      throw new BadRequestException('Daily report files must be staged through the report attachment endpoint');
    }
    this.assertValidFieldCode(entityType, body.fieldCode ?? null);
    await this.assertUploadAllowed(currentUser, entityType, body.entityId, body.uploadId);

    // The client reuses this ID after an uncertain response or a partial batch.
    const uploadId = body.uploadId ?? randomUUID();
    const previous = await this.prisma.file.findUnique({
      where: { id: uploadId }, include: { attachments: true },
    });
    if (previous) {
      const subject = await this.freshUploadActor(currentUser, entityType, body.entityId, uploadId);
      return inventoryTransaction(this.prisma, async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${uploadId}, 0))::text`;
        await lockActorAccessRevision(tx, subject);
        if (await this.lockUploadSource(tx, entityType, body.entityId)) {
          await this.assertUploadAllowed(subject, entityType, body.entityId, uploadId, tx);
        }
        const retained = await tx.file.findUnique({ where: { id: uploadId }, include: { attachments: true } });
        if (!retained || retained.deletedAt || retained.uploadedByUserId !== currentUser.id ||
          !retained.attachments.some((entry) => entry.entityType === entityType && entry.entityId === body.entityId)) {
          throw new ConflictException('Upload ID already used');
        }
        return mapSafeFileResponse(retained);
      });
    }

    const originalName = Array.from(body.originalName ?? file.originalname)
      .map((character) => {
        const code = character.charCodeAt(0);
        return character === '/' || character === '\\' || code < 32 || code === 127
          ? '_'
          : character;
      })
      .join('')
      .trim()
      .slice(0, 255) || 'file';

    const verifiedMimeType = this.detectMimeType(file.buffer, file.mimetype);
    await this.assertStandalonePhotoType(currentUser, entityType, body.entityId, verifiedMimeType);
    const objectKey = this.buildObjectKey(entityType, originalName);
    const storageResult = await this.storageService.uploadObject({
      objectKey,
      body: file.buffer,
      contentType: verifiedMimeType,
      contentLength: file.size,
    });

    const discardAndThrow = async (error: unknown): Promise<never> => {
      await this.discardUnlinkedUpload(storageResult, uploadId);
      throw error;
    };
    // Read fresh rights after I/O without reserving a transaction connection.
    // The revision lock below orders any later founder save before this commit.
    const subject = await this.freshUploadActor(currentUser, entityType, body.entityId, uploadId)
      .catch(discardAndThrow);
    const uploadResult = await inventoryTransaction(this.prisma, async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${uploadId}, 0))::text`;
      await lockActorAccessRevision(tx, subject);
      if (await this.lockUploadSource(tx, entityType, body.entityId)) {
        await this.assertUploadAllowed(subject, entityType, body.entityId, uploadId, tx);
      }
      const existing = await tx.file.findUnique({ where: { id: uploadId }, include: { attachments: true } });
      if (existing) {
        if (existing.deletedAt || existing.uploadedByUserId !== currentUser.id ||
          !existing.attachments.some((entry) => entry.entityType === entityType && entry.entityId === body.entityId)) {
          throw new ConflictException('Upload ID already used');
        }
        return { file: existing, cancelledApprovalRequestIds: [] as string[] };
      }
      if (entityType === 'inventory_movement') {
        await tx.$queryRaw`SELECT "id" FROM "inventory_movements" WHERE "id" = ${body.entityId} FOR UPDATE`;
        // Recheck after storage I/O and the movement lock: a correction or the
        // Moscow date boundary may have made this target unwritable.
        await this.assertEntityWritable(subject, entityType, body.entityId, tx);
        await this.assertStandalonePhotoType(subject, entityType, body.entityId, verifiedMimeType, tx);
      }
      if (entityType === 'one_time_order_specification_item') {
        const target = await tx.oneTimeOrderSpecificationItem.findFirst({
          where: { id: body.entityId, deletedAt: null },
          select: { oneTimeOrderId: true },
        });
        if (!target) throw new NotFoundException('Specification item not found');
        await tx.$queryRaw`SELECT "id" FROM "one_time_orders" WHERE "id" = ${target.oneTimeOrderId} FOR UPDATE`;
        const activeAssignments = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "one_time_order_assignments"
          WHERE "oneTimeOrderId" = ${target.oneTimeOrderId}
            AND "userId" = ${currentUser.id}
            AND "assignmentRoleCode" = 'one_time_manager'
            AND "isActive" = true
          FOR SHARE
        `;
        if (activeAssignments.length === 0) {
          throw new ForbiddenException('Active one-time manager assignment required');
        }
        await this.assertEntityWritable(currentUser, entityType, body.entityId);
      }
      const storedFile = await tx.file.create({
        data: {
          id: uploadId,
          bucket: storageResult.bucket,
          objectKey: storageResult.objectKey,
          originalName,
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

      if (entityType === 'inventory_movement' && verifiedMimeType.startsWith('image/')) {
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
        const movement = await tx.inventoryMovement.findUniqueOrThrow({ where: { id: body.entityId } });
        const objectId = movement.relatedObjectId ?? (movement.relatedOneTimeOrderId
          ? (await tx.oneTimeOrder.findUnique({ where: { id: movement.relatedOneTimeOrderId }, select: { linkedObjectId: true } }))?.linkedObjectId
          : null);
        if (objectId) await this.moduleRef.get<ObjectPlanningService>('ObjectPlanningService', { strict: false }).evaluateBudget(objectId, new Date(), tx);
      }

      await this.auditService.writeAuditEvent({
        entityType, entityId: body.entityId, actorUserId: currentUser.id,
        action: 'file.attached', newValues: { fileId: storedFile.id, originalName, mimeType: verifiedMimeType },
      }, tx);
      if (entityType === 'one_time_order_specification_item') {
        const item = await tx.oneTimeOrderSpecificationItem.findUniqueOrThrow({
          where: { id: body.entityId },
          select: { oneTimeOrderId: true, title: true },
        });
        await this.auditService.writeAuditEvent({
          entityType: 'one_time_order',
          entityId: item.oneTimeOrderId,
          actorUserId: currentUser.id,
          action: 'one_time_order.specification_item_attachment_attached',
          newValues: {
            specificationItemId: body.entityId,
            specificationItemTitle: item.title,
            fileId: storedFile.id,
            originalName,
            mimeType: verifiedMimeType,
          },
        }, tx);
      }
      for (const approvalRequestId of cancelledApprovalRequestIds) {
        await this.auditService.writeAuditEvent({
          entityType: 'approval_request', entityId: approvalRequestId,
          actorUserId: currentUser.id, action: 'approval.request.cancelled',
          newValues: { sourceEntityId: body.entityId, decisionComment: 'Evidence attached to inventory movement' },
        }, tx);
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
    }).catch(discardAndThrow);

    // A concurrent same-ID request may already have committed another object.
    // Keep its bytes and discard only this attempt's unused storage object.
    if (uploadResult.file?.objectKey !== storageResult.objectKey) {
      await this.discardUnlinkedUpload(storageResult, uploadId);
    }
    if (!uploadResult.file) {
      throw new NotFoundException('Stored file not found after upload');
    }

    await this.filePreviewService.ensurePreview(uploadResult.file).catch((error) => {
      this.logger.warn(
        `Unable to enqueue preview for file ${uploadResult.file?.id ?? 'unknown'}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    });

    return mapSafeFileResponse(uploadResult.file);
  }

  async stageDailyReportAttachment(
    currentUser: CurrentAuthUser,
    objectId: string,
    reportId: string,
    requestId: string,
    file: UploadedFilePayload,
  ) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw new BadRequestException('requestId must be a UUID v4');
    }
    const report = await this.prisma.objectDailyReport.findFirst({
      where: { id: reportId, objectId }, include: { object: { select: { status: true, deletedAt: true } } },
    });
    if (!report) throw new NotFoundException('Daily report not found');
    if (report.object.deletedAt || ['frozen', 'archived'].includes(report.object.status)) throw new ConflictException('Object does not accept report changes');
    await this.assertDailyReportWritable(currentUser, reportId);
    const verifiedMimeType = this.detectMimeType(file.buffer, file.mimetype);
    const originalName = Array.from(file.originalname).map((character) => {
      const code = character.charCodeAt(0);
      return character === '/' || character === '\\' || code < 32 || code === 127 ? '_' : character;
    }).join('').trim().slice(0, 255) || 'photo';
    const payloadHash = createHash('sha256').update(originalName).update('\0').update(verifiedMimeType).update('\0').update(file.buffer).digest('hex');
    const identity = { reportId_actorUserId_requestId: { reportId, actorUserId: currentUser.id, requestId } };
    const knownReplay = await this.prisma.objectDailyReportAttachmentStage.findUnique({ where: identity, select: { id: true } });
    // S3 must not hold a transaction connection or source locks. Each attempt
    // has its own object key; the request identity still selects one stage.
    const candidateFileId = randomUUID();
    const storageResult = knownReplay ? null : await this.storageService.uploadObject({
      objectKey: this.buildObjectKey('object_daily_report', originalName),
      body: file.buffer, contentType: verifiedMimeType, contentLength: file.size,
    });
    let staged: Prisma.ObjectDailyReportAttachmentStageGetPayload<{ include: { file: { include: { attachments: true } } } }>;
    try {
      staged = await this.prisma.$transaction(async (tx) => {
        // Compensation reacquires this exact attempt lock before checking keys.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${candidateFileId}, 0))::text`;
        await lockActorAccessRevision(tx, currentUser);
        await tx.$queryRaw`SELECT "id" FROM "objects" WHERE "id" = ${objectId} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "object_daily_reports" WHERE "id" = ${reportId} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "object_assignments" WHERE "objectId" = ${objectId} FOR SHARE`;
        const current = await tx.objectDailyReport.findFirst({ where: { id: reportId, objectId }, include: { object: { select: { status: true, deletedAt: true } } } });
        if (!current || current.object.deletedAt || ['frozen', 'archived'].includes(current.object.status)) throw new ConflictException('Daily report is no longer editable');
        await this.assertDailyReportWritable(currentUser, reportId, tx);
        const replay = await tx.objectDailyReportAttachmentStage.findUnique({ where: identity, include: { file: { include: { attachments: true } } } });
        if (replay) {
          if (replay.payloadHash !== payloadHash) throw new ConflictException('requestId already used with a different staged file');
          return replay;
        }
        if (!storageResult) throw new ConflictException('Staged request changed. Retry the same requestId.');
        const stored = await tx.file.create({ data: { id: candidateFileId, bucket: storageResult.bucket, objectKey: storageResult.objectKey, originalName, mimeType: verifiedMimeType, sizeBytes: file.size, uploadedByUserId: currentUser.id } });
        return tx.objectDailyReportAttachmentStage.create({ data: { reportId, objectId, fileId: stored.id, actorUserId: currentUser.id, requestId, payloadHash }, include: { file: { include: { attachments: true } } } });
      });
    } catch (error) {
      if (!storageResult) throw error;
      await this.discardUnlinkedUpload(storageResult, candidateFileId);
      // A failed commit acknowledgement is not evidence of rollback. The same
      // attempt lock has resolved before cleanup's exact-key check. Only this
      // attempt's committed stage can turn an uncertain result into success.
      const committed = await this.prisma.objectDailyReportAttachmentStage.findFirst({
        where: { reportId, objectId, actorUserId: currentUser.id, requestId, payloadHash, fileId: candidateFileId,
          file: { bucket: storageResult.bucket, objectKey: storageResult.objectKey } },
        include: { file: { include: { attachments: true } } },
      }).catch(() => null);
      if (!committed) throw error;
      staged = committed;
    }
    if (storageResult && staged.file.id !== candidateFileId) await this.discardUnlinkedUpload(storageResult, candidateFileId);
    await this.filePreviewService.ensurePreview(staged.file).catch((error) => this.logger.warn(`Unable to enqueue preview for staged report file: ${error instanceof Error ? error.message : 'unknown error'}`));
    return projectCommittedWrite(this.prisma, currentUser, async () => {
      await this.assertDailyReportWritable(currentUser, reportId);
      return { stagingId: staged.id, file: mapSafeFileResponse(staged.file), createdAt: staged.createdAt };
    });
  }

  async assertDailyReportWritable(
    currentUser: CurrentAuthUser,
    reportId: string,
    database: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const target = await resourceAccessTarget(database, 'object_daily_report', reportId);
    if (!target || hasModuleDeny(currentUser, 'objects.reports.update', target.context) ||
      !decideAccess(currentUser, 'files.upload', true, {
        resourceType: 'file', ownerUserId: currentUser.id,
        assignedUserIds: target.context.assignedUserIds, parents: [target],
      })) throw new ForbiddenException('Изменение вложений отчёта недоступно');
    if (this.getPermissionCodes(currentUser).includes('objects.hr_reports_view') || !(await this.canWriteDailyReportTarget(currentUser, reportId, database))) {
      throw new ForbiddenException('Daily report attachment editing denied');
    }
  }

  async getViewById(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<FileViewResponseDto> {
    const file = await this.getReadableFile(currentUser, id);
    const contexts: AccessContext[] = [];
    for (const attachment of file.attachments) {
        const type = this.parseEntityType(attachment.entityType);
        if (!(await this.canReadEntity(currentUser, type, attachment.entityId))) continue;
        const target = await resourceAccessTarget(this.prisma, type, attachment.entityId);
        contexts.push({
          resourceType: 'file', resourceId: file.id, ownerUserId: file.uploadedByUserId ?? undefined,
          assignedUserIds: target?.context.assignedUserIds, parents: target ? [target] : [],
        });
    }
    const allowed = (actionCode: string): boolean => contexts.some(context => decideAccess(currentUser, actionCode, true, context));
    const canPreview = allowed('files.preview');
    const canDownload = allowed('files.download');
    const canRetryPreview = allowed('files.preview.retry');
    const derivative = canPreview ? await this.filePreviewService.ensurePreview(file) : null;
    const result = this.mapFileView(file, derivative);
    result.capabilities = { canPreview, canDownload, canRetryPreview };
    if (!canPreview) {
      result.inlineContentUrl = null;
      result.thumbnailUrl = null;
      result.previewStatus = 'failed';
      result.errorMessage = 'Предпросмотр ограничен настройками доступа.';
    }
    return result;
  }

  async retryPreview(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<FileViewResponseDto | SavedWithoutAccess> {
    const file = await this.getReadableFile(currentUser, id, 'files.preview.retry');
    const originalGrants = [...(objectDelegationContext.getStore()?.used.values() ?? [])];
    await this.filePreviewService.retryPreview(file, currentUser, async (tx) => {
      await this.lockPreviewRetrySources(tx, file, originalGrants, currentUser.id);
      const subject = await loadAccessSubject(tx, currentUser.id);
      if (!subject?.isActive) throw new ForbiddenException('Повторная подготовка файла недоступна.');
      const currentGrants = await resolveObjectDelegationGrants(tx, currentUser.id);
      const grants = currentGrants.filter(grant => originalGrants.some(original =>
        original.substitutionId === grant.substitutionId && original.objectId === grant.objectId &&
        original.principalUserId === grant.principalUserId));
      const freshFile = await tx.file.findFirst({ where: { id, deletedAt: null }, include: { attachments: true } });
      if (!freshFile) throw new ForbiddenException('Файл больше недоступен.');
      // A new attachment/source cannot authorize a request sent for the old one.
      const attachments = freshFile.attachments.filter(attachment => file.attachments.some(original => original.id === attachment.id));
      await objectDelegationContext.run({ actorUserId: currentUser.id, grants, used: new Map() }, () =>
        this.assertFileReadable({ ...currentUser, ...subject, roleCode: subject.roleCodes?.[0] ?? '', roleCodes: [...(subject.roleCodes ?? [])], permissionCodes: [...(subject.permissionCodes ?? [])] }, attachments, freshFile, 'files.preview.retry'));
    });

    return projectCommittedWrite(this.prisma, currentUser, async () => {
      // A substitution can disappear without advancing this actor's revision.
      // Do not project committed results using the request's old delegation.
      const subject = await loadAccessSubject(this.prisma, currentUser.id);
      if (!subject?.isActive) throw new ForbiddenException('Файл больше недоступен.');
      const grants = await resolveObjectDelegationGrants(this.prisma, currentUser.id);
      return objectDelegationContext.run({ actorUserId: currentUser.id, grants, used: new Map() }, () =>
        this.getViewById({
          ...currentUser,
          ...subject,
          roleCode: subject.roleCodes?.[0] ?? '',
          roleCodes: [...(subject.roleCodes ?? [])],
          permissionCodes: [...(subject.permissionCodes ?? [])],
        }, id));
    });
  }

  private async lockPreviewRetrySources(
    tx: Prisma.TransactionClient,
    file: Awaited<ReturnType<FilesService['getReadableFile']>>,
    grants: NonNullable<ReturnType<typeof objectDelegationContext.getStore>>['grants'],
    actorUserId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "files" WHERE "id" = ${file.id} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "file_attachments" WHERE "fileId" = ${file.id} ORDER BY "id" FOR SHARE`;
    const directTables: Record<FileAttachmentEntityType, string> = {
      object: 'objects', object_arrival_photo: 'object_arrival_photos', object_daily_report: 'object_daily_reports', object_comment: 'object_comments',
      one_time_order: 'one_time_orders', one_time_order_comment: 'one_time_order_comments', one_time_order_daily_report: 'one_time_order_daily_reports',
      one_time_order_photo: 'one_time_order_photos', one_time_order_specification_item: 'one_time_order_specification_items',
      task: 'tasks', task_assignee_completion: 'task_assignee_completions', inventory_movement: 'inventory_movements',
      equipment_movement: 'equipment_movements', accountability_expense: 'accountability_expenses', accountability_funding: 'accountability_fundings', chat_message: 'chat_messages',
    };
    const locks = new Map<string, { table: string; field: string; id: string }>();
    const add = (table: string, field: string, id: string) => locks.set(`${table}:${field}:${id}`, { table, field, id });
    const collect = (context: AccessContext): void => {
      const id = context.resourceId;
      if (id) {
        const tables: Record<string, string> = { object: 'objects', one_time_order: 'one_time_orders', task: 'tasks', chat_room: 'chat_rooms', equipment_unit: 'equipment_units', inventory_item: 'inventory_items', user: 'users' };
        if (context.resourceType && tables[context.resourceType]) add(tables[context.resourceType], 'id', id);
        if (context.resourceType === 'object') add('object_assignments', 'objectId', id);
        if (context.resourceType === 'one_time_order') add('one_time_order_assignments', 'oneTimeOrderId', id);
        if (context.resourceType === 'chat_room') add('chat_room_participants', 'chatRoomId', id);
        if (context.resourceType === 'task') { add('task_assignees', 'taskId', id); add('task_visibility_users', 'taskId', id); }
      }
      for (const parent of context.parents ?? []) if (parent.context) collect(parent.context);
    };
    // Freeze child-to-parent links before resolving their current ancestors.
    for (const attachment of [...file.attachments].sort((a, b) => a.entityId.localeCompare(b.entityId))) {
      const type = this.parseEntityType(attachment.entityType);
      await tx.$queryRawUnsafe(`SELECT "id" FROM "${directTables[type]}" WHERE "id" = $1 FOR SHARE`, attachment.entityId);
      const target = await resourceAccessTarget(tx, type, attachment.entityId);
      if (target) collect(target.context);
    }
    for (const grant of grants) {
      add('users', 'id', grant.principalUserId);
      add('user_substitutions', 'id', grant.substitutionId);
      add('user_substitution_objects', 'substitutionId', grant.substitutionId);
      add('object_assignments', 'objectId', grant.objectId);
    }
    if (file.attachments.some(attachment => attachment.entityType === 'accountability_expense')) {
      // Standalone own expenses can inherit legacy access from an assignment
      // elsewhere or a historical receipt, not from this expense's order link.
      // Preserve an actual eligibility witness until the retry commits.
      await tx.$queryRaw`SELECT "id" FROM "one_time_order_assignments"
        WHERE "userId" = ${actorUserId} AND "assignmentRoleCode" = 'one_time_manager' AND "isActive" = true
        ORDER BY "id" LIMIT 1 FOR SHARE`;
      await tx.$queryRaw`SELECT f."id" FROM "accountability_fundings" f
        JOIN "accountability_accounts" a ON a."id" = f."accountabilityAccountId"
        WHERE a."userId" = ${actorUserId} AND f."fundingType" = 'one_time_order_receipt'
        ORDER BY f."id" LIMIT 1 FOR SHARE OF f, a`;
    }
    // Identifiers come only from the static tables above, values are bound.
    for (const lock of [...locks.values()].sort((a, b) => `${a.table}:${a.id}`.localeCompare(`${b.table}:${b.id}`))) {
      await tx.$queryRawUnsafe(`SELECT "id" FROM "${lock.table}" WHERE "${lock.field}" = $1 ORDER BY "id" FOR SHARE`, lock.id);
    }
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
    const file = await this.getReadableFile(currentUser, id, 'files.preview');
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
    await this.assertCurrentPreviewRead(currentUser, id);

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
    const file = await this.getReadableFile(currentUser, id, 'files.preview');

    if (
      INLINE_IMAGE_MIME_TYPES.has(file.mimeType) ||
      file.mimeType === 'application/pdf'
    ) {
      const storedObject = await this.storageService.downloadObject(file.objectKey);
      await this.assertCurrentPreviewRead(currentUser, id);
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
      await this.assertCurrentPreviewRead(currentUser, id);
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
      await this.assertCurrentPreviewRead(currentUser, id);
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

    await this.assertFileReadable(currentUser, file.attachments, file);

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

    const target = await resourceAccessTarget(this.prisma, entityType, params.entityId);
    return attachments.filter((attachment) => decideAccess(params.currentUser, 'files.read', true, {
      resourceType: 'file', resourceId: attachment.file.id,
      ownerUserId: attachment.file.uploadedByUserId ?? undefined,
      assignedUserIds: target?.context.assignedUserIds, parents: target ? [target] : [],
    })).map((attachment) =>
      mapSafeFileResponse(attachment.file),
    );
  }

  private async assertCurrentPreviewRead(currentUser: CurrentAuthUser, id: string): Promise<void> {
    await this.assertCurrentFileRead(currentUser, id, 'files.preview');
  }

  private async assertCurrentFileRead(currentUser: CurrentAuthUser, id: string, actionCode: string): Promise<void> {
    // Actor revisions do not change when a principal revokes a substitution.
    // Refresh both authorities after storage I/O without changing write attribution.
    const subject = await loadAccessSubject(this.prisma, currentUser.id);
    if (!subject?.isActive) throw new ForbiddenException('File access denied');
    const grants = await resolveObjectDelegationGrants(this.prisma, currentUser.id);
    await objectDelegationContext.run({ actorUserId: currentUser.id, grants, used: new Map() }, () => this.getReadableFile({
      ...currentUser,
      ...subject,
      isActive: subject.isActive,
      roleCode: subject.roleCodes?.[0] ?? '',
      roleCodes: [...(subject.roleCodes ?? [])],
      permissionCodes: [...(subject.permissionCodes ?? [])],
    }, id, actionCode));
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
    const file = await this.getReadableFile(currentUser, id, 'files.download');
    const storedObject = await this.storageService.downloadObject(file.objectKey);

    // Storage may have taken long enough for the actor or the source access to change.
    await this.assertCurrentFileRead(currentUser, id, 'files.download');

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

  private async getReadableFile(currentUser: CurrentAuthUser, id: string, actionCode = 'files.read') {
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

    await this.assertFileReadable(currentUser, file.attachments, file, actionCode);

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
      capabilities: { canPreview: true, canDownload: true, canRetryPreview: true },
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
    file: { id: string; uploadedByUserId: string | null },
    actionCode = 'files.read',
  ): Promise<void> {
    for (const attachment of attachments) {
      const entityType = this.parseEntityType(attachment.entityType);

      if (
        await this.canReadEntity(currentUser, entityType, attachment.entityId)
      ) {
        const target = await resourceAccessTarget(this.prisma, entityType, attachment.entityId);
        const context: AccessContext = {
          resourceType: 'file', resourceId: file.id, ownerUserId: file.uploadedByUserId ?? undefined,
          assignedUserIds: target?.context.assignedUserIds,
          parents: target ? [target] : [],
        };
        if (decideAccess(currentUser, 'files.read', true, context) && decideAccess(currentUser, actionCode, true, context)) return;
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

  private async freshUploadActor(
    currentUser: CurrentAuthUser,
    entityType: FileAttachmentEntityType,
    entityId: string,
    uploadId: string,
  ): Promise<CurrentAuthUser> {
    const subject = await loadAccessSubject(this.prisma, currentUser.id);
    if (!subject?.isActive) throw new ForbiddenException('Загрузка файлов недоступна');
    const actor: CurrentAuthUser = {
      ...subject,
      roleCode: subject.roleCodes?.[0] ?? '',
      roleCodes: [...(subject.roleCodes ?? [])],
      permissionCodes: [...(subject.permissionCodes ?? [])],
    };
    await this.assertUploadAllowed(actor, entityType, entityId, uploadId);
    return actor;
  }

  private async assertUploadAllowed(
    currentUser: CurrentAuthUser,
    entityType: FileAttachmentEntityType,
    entityId: string,
    uploadId?: string,
    database: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await this.assertEntityWritable(currentUser, entityType, entityId, database);
    const target = await resourceAccessTarget(database, entityType, entityId);
    if (!decideAccess(currentUser, 'files.upload', true, {
      resourceType: 'file', resourceId: uploadId, ownerUserId: currentUser.id,
      assignedUserIds: target?.context.assignedUserIds,
      parents: target ? [target] : [],
    })) throw new ForbiddenException('Загрузка файлов недоступна');
  }

  private async assertStandalonePhotoType(
    currentUser: CurrentAuthUser,
    entityType: FileAttachmentEntityType,
    entityId: string,
    verifiedMimeType: string,
    database: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    // Preserve pre-existing generic warehouse uploads. The new personal grant
    // adds photos only; a picker filter or client Content-Type is not authority.
    if (entityType !== 'inventory_movement' || verifiedMimeType.startsWith('image/')) return;
    const movement = await database.inventoryMovement.findUnique({
      where: { id: entityId },
      select: { inventoryItemId: true, createdByUserId: true, movementType: true, relatedObjectId: true, relatedOneTimeOrderId: true },
    });
    if (movement?.createdByUserId === currentUser.id && !movement.relatedObjectId && !movement.relatedOneTimeOrderId &&
        ['receipt', 'adjustment'].includes(movement.movementType)) {
      if (!canUseLegacyStandaloneInventoryAttachments(currentUser, movement, canCreateInventoryMovement(this.getRoleCodes(currentUser)))) {
        throw new BadRequestException('Это право разрешает только фото. Выберите файл изображения.');
      }
    }
  }

  private async lockUploadSource(
    tx: Prisma.TransactionClient, entityType: FileAttachmentEntityType, entityId: string,
  ): Promise<boolean> {
    // Only these three newly integrated bridges are synchronized here. Preserve
    // the inventory/specification lifecycle and lock order in their own branches.
    const source = entityType === 'object_comment'
      ? { child: 'object_comments', parent: 'objects', field: 'objectId', assignments: 'object_assignments' }
      : entityType === 'object_arrival_photo'
        ? { child: 'object_arrival_photos', parent: 'objects', field: 'objectId', assignments: 'object_assignments' }
        : entityType === 'one_time_order_photo'
          ? { child: 'one_time_order_photos', parent: 'one_time_orders', field: 'oneTimeOrderId', assignments: 'one_time_order_assignments' }
          : null;
    if (!source) return false;
    const target = await resourceAccessTarget(tx, entityType, entityId);
    const parentId = target?.context.resourceId;
    if (!parentId) throw new ForbiddenException('File upload denied for selected entity');
    // Table/column identifiers above are a closed server-side map; IDs are bound.
    await tx.$queryRawUnsafe(`SELECT "id" FROM "${source.parent}" WHERE "id" = $1 FOR SHARE`, parentId);
    const child = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "${source.child}" WHERE "id" = $1 AND "${source.field}" = $2 FOR SHARE`, entityId, parentId,
    );
    if (!child.length) throw new ForbiddenException('File upload denied for selected entity');
    await tx.$queryRawUnsafe(`SELECT "id" FROM "${source.assignments}" WHERE "${source.field}" = $1 FOR SHARE`, parentId);
    return true;
  }

  private async discardUnlinkedUpload(upload: { bucket: string; objectKey: string }, uploadId: string): Promise<void> {
    try {
      // Reacquire the SAME upload lock: an uncertain earlier transaction must
      // resolve before this READ COMMITTED metadata check and exact-key delete.
      await inventoryTransaction(this.prisma, async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${uploadId}, 0))::text`;
        const stored = await tx.file.findFirst({
          where: { bucket: upload.bucket, objectKey: upload.objectKey }, select: { id: true },
        });
        if (!stored) await this.storageService.deleteObject(upload.objectKey);
      });
    } catch (error: unknown) {
      this.logger.error(`Could not discard unlinked upload ${upload.objectKey}`, error);
    }
  }

  private async assertEntityWritable(
    currentUser: CurrentAuthUser,
    entityType: FileAttachmentEntityType,
    entityId: string,
    database: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    if (!(await this.canWriteEntity(currentUser, entityType, entityId, database))) {
      throw new ForbiddenException('File upload denied for selected entity');
    }
  }

  private async canReadEntity(
    currentUser: CurrentAuthUser,
    entityType: FileAttachmentEntityType,
    entityId: string,
  ): Promise<boolean> {
    const legacy = await this.canReadEntityLegacy(currentUser, entityType, entityId);
    const target = await resourceAccessTarget(this.prisma, entityType, entityId);
    if (!target) return false;
    // Identity resolution retains archived ancestors for deny checks. That is
    // not permission to open their files, including the HR report extension.
    if (target.context.resourceType === 'object' && (!target.context.resourceId || !(await this.prisma.object.findFirst({
      where: { id: target.context.resourceId, deletedAt: null }, select: { id: true },
    })))) return false;
    let parentAllowed = true;
    if (['object_arrival_photo', 'object_daily_report', 'object_comment'].includes(entityType)) {
      const objectId = target.context.resourceId;
      // Preserve the existing HR report-only exception, not a new bypass from
      // granting a child action. Explicit parent denies are still checked below.
      const hrReport = entityType === 'object_daily_report' && decideAccess(currentUser, 'objects.hr_reports_view', this.getPermissionCodes(currentUser).includes('objects.hr_reports_view'), target.context);
      parentAllowed = hrReport || (!!objectId && decideAccess(currentUser, 'objects.read', await this.canReadObject(currentUser, objectId), target.context));
    }
    if (['one_time_order_comment', 'one_time_order_daily_report', 'one_time_order_photo', 'one_time_order_specification_item'].includes(entityType)) {
      const orderId = target.context.resourceId;
      parentAllowed = !!orderId && await this.canReadEntity(currentUser, 'one_time_order', orderId);
    }
    const materialsAllowed = entityType !== 'object' || decideAccess(currentUser, 'objects.materials.read', true, target.context);
    return materialsAllowed && decideAccess(currentUser, target.actionCode, legacy, {
      ...target.context,
      parentAllowed,
      ...(['chat_message', 'task', 'task_assignee_completion'].includes(entityType) ? { invariantAllowed: legacy } : {}),
    });
  }

  private async canReadEntityLegacy(
    currentUser: CurrentAuthUser,
    entityType: FileAttachmentEntityType,
    entityId: string,
  ): Promise<boolean> {
    switch (entityType) {
      case 'object':
        return this.canReadObject(currentUser, entityId, 'objects.materials.read');
      case 'object_arrival_photo':
        return this.canAccessObjectScopedEntity(currentUser, 'objectArrivalPhoto', entityId);
      case 'object_daily_report':
        {
          const target = await resourceAccessTarget(this.prisma, entityType, entityId);
          if (target && decideAccess(currentUser, 'objects.hr_reports_view', this.getPermissionCodes(currentUser).includes('objects.hr_reports_view'), target.context)) return true;
        }
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
      case 'accountability_funding':
        return this.canAccessAccountabilityFunding(currentUser, entityId, 'read');
      case 'chat_message':
        return this.canAccessChatMessage(currentUser, entityId, 'read');
    }
  }

  private async canWriteEntity(
    currentUser: CurrentAuthUser,
    entityType: FileAttachmentEntityType,
    entityId: string,
    database: Prisma.TransactionClient = this.prisma,
  ): Promise<boolean> {
    const target = await resourceAccessTarget(database, entityType, entityId);
    if (!target) return false;
    if (target.context.resourceType === 'object' && (!target.context.resourceId || !(await database.object.findFirst({
      where: { id: target.context.resourceId, deletedAt: null }, select: { id: true },
    })))) return false;
    if (target && hasModuleDeny(currentUser, target.actionCode, target.context)) return false;
    // tasks.update uses the Task DTO's active-assignee context, not the wider
    // file-discovery visibilityUsers context resolved above for parent reads.
    if (entityType === 'task') return this.canWriteTask(currentUser, entityId, database);
    const writeActions: Partial<Record<FileAttachmentEntityType, string>> = {
      object: 'objects.materials.manage', object_arrival_photo: 'objects.arrival.create',
      object_comment: 'objects.comments.create', object_daily_report: 'objects.reports.update',
      one_time_order: 'one_time_orders.update', one_time_order_comment: 'one_time_orders.comments.create',
      one_time_order_daily_report: 'one_time_orders.reports.update', one_time_order_photo: 'one_time_orders.photos.create',
      one_time_order_specification_item: 'one_time_orders.specification.attachments',
      task: 'tasks.update', task_assignee_completion: 'tasks.completion.draft',
      accountability_expense: 'accountability.expenses.update', chat_message: 'chat.messages.create',
    };
    const actionCode = writeActions[entityType];
    if (target && actionCode && hasModuleDeny(currentUser, actionCode, target.context)) return false;
    if (actionCode && (entityType === 'object_comment' || entityType === 'object_arrival_photo')) {
      // These uploads inherit the same object-operation write decision as the
      // parent JSON action. A read bridge alone must not discard a scoped grant.
      const objectId = target.context.resourceType === 'object' ? target.context.resourceId : undefined;
      if (!objectId) return false;
      const parent = await resourceAccessTarget(database, 'object', objectId);
      if (!parent) return false;
      const parentAllowed = decideAccess(currentUser, 'objects.read',
        await this.canReadObject(currentUser, objectId, 'objects.read', database), parent.context);
      return decideAccess(currentUser, actionCode,
        await this.canWriteEntityLegacy(currentUser, entityType, entityId, database),
        { ...target.context, parentAllowed });
    }
    return this.canWriteEntityLegacy(currentUser, entityType, entityId, database);
  }

  private async canWriteEntityLegacy(
    currentUser: CurrentAuthUser,
    entityType: FileAttachmentEntityType,
    entityId: string,
    database: Prisma.TransactionClient = this.prisma,
  ): Promise<boolean> {
    switch (entityType) {
      case 'object':
        return this.canWriteObjectCore(currentUser, entityId);
      case 'object_arrival_photo':
      case 'object_comment':
        return this.canAccessObjectScopedEntity(
          currentUser,
          entityType === 'object_arrival_photo' ? 'objectArrivalPhoto' : 'objectComment',
          entityId,
          database,
        );
      case 'object_daily_report':
        return this.canWriteDailyReportTarget(currentUser, entityId, database);
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
        return this.canAccessOneTimeOrderPhoto(currentUser, entityId, 'write', database);
      case 'one_time_order_specification_item':
        return this.canAccessOneTimeOrderSpecificationItem(
          currentUser,
          entityId,
          'write',
        );
      case 'task':
        return this.canWriteTask(currentUser, entityId, database);
      case 'task_assignee_completion':
        return this.canAccessTaskCompletion(currentUser, entityId, 'write');
      case 'one_time_order':
        return this.canAccessOneTimeOrder(currentUser, entityId, 'write');
      case 'inventory_movement':
        return this.canAccessInventoryMovement(currentUser, entityId, 'write', database);
      case 'equipment_movement':
        return this.canAccessEquipmentMovement(currentUser, entityId, 'write');
      case 'accountability_expense':
        return this.canAccessAccountabilityExpense(currentUser, entityId, 'write');
      case 'accountability_funding':
        return this.canAccessAccountabilityFunding(currentUser, entityId, 'write');
      case 'chat_message':
        return this.canAccessChatMessage(currentUser, entityId, 'write');
    }
  }

  private async canReadObject(
    currentUser: CurrentAuthUser,
    objectId: string,
    policyActionCode = 'objects.read',
    database: Prisma.TransactionClient = this.prisma,
  ): Promise<boolean> {
    const object = await database.object.findFirst({
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
      object.assignments.some((assignment) => assignment.userId === currentUser.id) ||
      hasDelegatedObjectAction(currentUser.id, objectId, 'view', true, policyActionCode, {
        resourceType: 'object', resourceId: objectId, ownerUserId: object.createdByUserId,
        assignedUserIds: object.assignments.map(assignment => assignment.userId),
      })
    );
  }

  private async canWriteDailyReportTarget(currentUser: CurrentAuthUser, reportId: string, database: Prisma.TransactionClient = this.prisma): Promise<boolean> {
    const report = await database.objectDailyReport.findUnique({
      where: { id: reportId },
      select: { objectId: true, object: { select: { createdByUserId: true, status: true, deletedAt: true, assignments: { where: { isActive: true }, select: { userId: true } } } } },
    });
    if (!report) throw new NotFoundException('Attachment target entity not found');
    if (report.object.deletedAt || ['frozen', 'archived'].includes(report.object.status)) return false;
    const roleCodes = this.getRoleCodes(currentUser);
    return hasWideObjectAccess(roleCodes) || report.object.createdByUserId === currentUser.id ||
      report.object.assignments.some((assignment) => assignment.userId === currentUser.id) ||
      hasDelegatedObjectAction(currentUser.id, report.objectId, 'edit', true, 'objects.reports.update', {
        resourceType: 'object', resourceId: report.objectId, ownerUserId: report.object.createdByUserId,
        assignedUserIds: report.object.assignments.map(assignment => assignment.userId),
      });
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

    const target = await resourceAccessTarget(this.prisma, 'object', objectId);
    return decideAccess(currentUser, 'objects.materials.manage', (
      canEditObject(roleCodes) ||
      (object.status === 'frozen' && canOverrideFrozenObject(roleCodes)) ||
      hasDelegatedObjectAction(currentUser.id, objectId, 'edit', true, 'objects.materials.manage', target?.context)
    ), {
      ...target?.context,
      invariantAllowed: object.status !== 'archived' && (object.status !== 'frozen' || canOverrideFrozenObject(roleCodes)),
    });
  }

  private async canAccessObjectScopedEntity(
    currentUser: CurrentAuthUser,
    modelName: 'objectArrivalPhoto' | 'objectDailyReport' | 'objectComment',
    entityId: string,
    database: Prisma.TransactionClient = this.prisma,
  ): Promise<boolean> {
    const model = (database as {
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

    const actionCode = modelName === 'objectDailyReport' ? 'objects.reports.read'
      : modelName === 'objectComment' ? 'objects.comments.read' : 'objects.arrival.read';
    return this.canReadObject(currentUser, item.objectId, actionCode, database);
  }

  private async canAccessTask(
    currentUser: CurrentAuthUser,
    taskId: string,
  ): Promise<boolean> {
    const task = await this.prisma.task.findFirst({
      where: {
        AND: [
          { id: taskId },
          taskVisibilityWhere(currentUser, buildTaskAccessWhere({
            currentUserId: currentUser.id,
            roleCodes: this.getRoleCodes(currentUser),
          })),
        ],
      },
      select: { id: true },
    });

    if (!task) {
      return false;
    }

    return true;
  }

  private async canWriteTask(
    currentUser: CurrentAuthUser,
    taskId: string,
    database: Prisma.TransactionClient = this.prisma,
  ): Promise<boolean> {
    // Match TaskResponseDto.canEdit, retaining the existing task/parent read
    // circle. All source reads use the caller's transaction when supplied.
    const task = await database.task.findFirst({
      where: { AND: [
        { id: taskId },
        taskVisibilityWhere(currentUser, buildTaskAccessWhere({
          currentUserId: currentUser.id,
          roleCodes: this.getRoleCodes(currentUser),
        })),
      ] },
      select: {
        id: true, status: true, createdByUserId: true,
        objectId: true, oneTimeOrderId: true,
        assignees: { where: { isActive: true }, select: { userId: true, isActive: true } },
      },
    });
    if (!task || ['completed', 'cancelled', 'closed'].includes(task.status)) return false;
    const legacy = task.createdByUserId === currentUser.id ||
      hasDelegatedTaskAction(currentUser.id, task, 'creator', false, 'tasks.update');
    return decideAccess(currentUser, 'tasks.update', legacy, {
      resourceType: 'task', resourceId: task.id,
      ownerUserId: task.createdByUserId,
      assignedUserIds: task.assignees.map(assignee => assignee.userId),
    });
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

    if (!(await this.canAccessTask(currentUser, completion.taskAssignee.task.id))) return false;

    if (mode === 'read') {
      return true;
    }

    return (
      completion.status === 'draft' &&
      completion.workCycle === completion.taskAssignee.task.workCycle &&
      completion.taskAssignee.isActive &&
      completion.taskAssignee.userId === currentUser.id &&
      completion.taskAssignee.task.status === 'in_progress'
    );
  }

  private async canAccessInventoryMovement(
    currentUser: CurrentAuthUser,
    movementId: string,
    mode: 'read' | 'write',
    database: Prisma.TransactionClient = this.prisma,
  ): Promise<boolean> {
    const movement = await database.inventoryMovement.findFirst({
      where: {
        id: movementId,
      },
      select: {
        id: true,
        inventoryItemId: true,
        movementType: true,
        createdByUserId: true,
        createdAt: true,
        status: true,
        relatedObject: {
          select: {
            id: true,
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
      if (['cancelled', 'rejected'].includes(movement.status) || !isInventoryPhotoDay(movement.createdAt)) return false;
      if (!movement.relatedObject && !movement.relatedOneTimeOrder && ['receipt', 'adjustment'].includes(movement.movementType)) {
        return canAttachStandaloneInventoryPhoto(currentUser, movement, canCreateInventoryMovement(roleCodes));
      }
      return (
        canCreateInventoryMovement(roleCodes) ||
        (movement.createdByUserId === currentUser.id &&
          isInventoryPhotoDay(movement.createdAt) &&
          (!!movement.relatedObject?.assignments.some((assignment) =>
            assignment.userId === currentUser.id && assignment.assignmentRoleCode === 'manager') ||
            !!movement.relatedOneTimeOrder?.assignments.some((assignment) =>
              assignment.userId === currentUser.id && assignment.assignmentRoleCode === 'one_time_manager')))
      );
    }

    const accessTarget = await resourceAccessTarget(this.prisma, 'inventory_movement', movementId);
    return (
      canAccessInventory(roleCodes) ||
      hasDelegatedObjectAction(currentUser.id, movement.relatedObject?.id, 'view', true, 'inventory.movements.read', accessTarget?.context) ||
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
            id: true,
            createdByUserId: true,
            assignments: {
              where: { isActive: true },
              select: { userId: true },
            },
          },
        },
        toObject: {
          select: {
            id: true,
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

    const accessTarget = await resourceAccessTarget(this.prisma, 'equipment_movement', movementId);
    const canReadObjectLike = (object: typeof movement.fromObject) =>
      !!object &&
      (object.createdByUserId === currentUser.id ||
        hasDelegatedObjectAction(currentUser.id, object.id, 'view', true, 'equipment.history', accessTarget?.context) ||
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
                  subject: currentUser,
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
      subject: currentUser,
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
            assignments: {
              select: { userId: true, assignmentRoleCode: true, isActive: true },
            },
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundException(
        'Attachment target one-time order specification item not found',
      );
    }

    if (mode === 'write') {
      if (
        item.oneTimeOrder.status === 'completed' ||
        item.oneTimeOrder.status === 'cancelled'
      ) return false;
      return hasActiveOneTimeOrderAssignment(
        item.oneTimeOrder,
        currentUser.id,
      );
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
    database: Prisma.TransactionClient = this.prisma,
  ): Promise<boolean> {
    const photo = await database.oneTimeOrderPhoto.findFirst({
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

    if (mode === 'read') {
      return this.canAccessOneTimeOrder(currentUser, photo.oneTimeOrderId, mode);
    }
    const order = await database.oneTimeOrder.findUnique({
      where: { id: photo.oneTimeOrderId },
      select: {
        id: true, createdByUserId: true,
        assignments: { where: { isActive: true }, select: {
          userId: true, assignmentRoleCode: true, isActive: true,
        } },
      },
    });
    return !!order && canEditOneTimeOrderByScope({
      subject: currentUser, actionCode: 'one_time_orders.photos.create',
      currentUserId: currentUser.id, roleCodes: this.getRoleCodes(currentUser),
      permissionCodes: this.getPermissionCodes(currentUser), order,
    });
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
    const legacyOwnerAccess = isOwner && await this.canCurrentUserViewOwnAccountability(currentUser);
    const context: AccessContext = {
      resourceType: 'user', resourceId: expense.accountabilityAccount.userId,
      ownerUserId: expense.accountabilityAccount.userId,
    };
    // The own-expense creation flow may attach evidence to its author's draft.
    // It does not grant access to funding files or another person's expenses.
    const ownCreatedDraft = isOwner && expense.createdByUserId === currentUser.id &&
      expense.status === 'draft' && currentUser.isActive === true &&
      decideAccess(currentUser, 'accountability.expenses.create', true, context);
    const ownerCanAccess = isOwner && decideAccess(
      currentUser, 'accountability.read', legacyOwnerAccess || ownCreatedDraft, context,
    );

    if (mode === 'write') {
      return (
        ownerCanAccess &&
        expense.createdByUserId === currentUser.id &&
        expense.accountabilityAccount.status === 'active' &&
        expense.status === 'draft' &&
        !hasModuleDeny(currentUser, 'accountability.expenses.update', context) &&
        // A newly created own draft accepts its creator's personal create
        // grant; editing an existing own draft may instead use update. A read
        // grant alone never manufactures write authority or account ownership.
        (decideAccess(currentUser, 'accountability.expenses.create', legacyOwnerAccess || ownCreatedDraft, context) ||
          decideAccess(currentUser, 'accountability.expenses.update', legacyOwnerAccess, context))
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

  private async canAccessAccountabilityFunding(
    currentUser: CurrentAuthUser,
    fundingId: string,
    mode: 'read' | 'write',
  ): Promise<boolean> {
    const funding = await this.prisma.accountabilityFunding.findUnique({
      where: { id: fundingId },
      select: {
        fundingType: true,
        accountabilityAccount: { select: { userId: true } },
      },
    });
    if (!funding) throw new NotFoundException('Attachment target accountability funding not found');
    const isOwner = funding.accountabilityAccount.userId === currentUser.id;
    if (mode === 'write') {
      return isOwner && funding.fundingType === 'external_receipt';
    }
    return isOwner || canReviewAccountability({
      roleCodes: this.getRoleCodes(currentUser),
      permissionCodes: this.getPermissionCodes(currentUser),
    });
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

    // Physical attachments inherit the same explicit source-deny boundary as
    // the retained system message. A file grant cannot bypass its hidden source.
    if (mode === 'read' && !await isChatMessageSourceAllowed(this.prisma, currentUser, message)) {
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
    const legacy = (await resolveRoomMembership(this.prisma, currentUser, room)).allowed;
    const target = await resourceAccessTarget(this.prisma, 'chat_room', room.id);
    return decideAccess(currentUser, 'chat.read', legacy, {
      ...target?.context,
      invariantAllowed: legacy,
      parents: room.visibilityType === 'objects_scope' ? [{ actionCode: 'objects.access', context: {} }]
        : room.visibilityType === 'one_time_orders_scope' ? [{ actionCode: 'one_time_orders.access', context: {} }] : [],
    });
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
