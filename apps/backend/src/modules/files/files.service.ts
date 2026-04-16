import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import {
  canEditObject,
  canOverrideFrozenObject,
  hasWideObjectAccess,
} from '../objects/utils/object-access.util';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { hasWideTaskAccess } from '../tasks/utils/task-access.util';

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

    const created = await this.prisma.$transaction(async (tx) => {
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

      return tx.file.findUnique({
        where: { id: storedFile.id },
        include: {
          attachments: {
            orderBy: {
              createdAt: 'asc',
            },
          },
        },
      });
    });

    if (!created) {
      throw new NotFoundException('Stored file not found after upload');
    }

    return this.mapFile(created);
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
      case 'task':
        return this.canAccessTask(currentUser, entityId);
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
      case 'task':
        return this.canAccessTask(currentUser, entityId);
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
      task.assignees.some((assignee) => assignee.userId === currentUser.id)
    );
  }

  private getRoleCodes(currentUser: CurrentAuthUser): string[] {
    if (Array.isArray(currentUser.roleCodes) && currentUser.roleCodes.length > 0) {
      return currentUser.roleCodes;
    }

    return currentUser.roleCode ? [currentUser.roleCode] : [];
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
