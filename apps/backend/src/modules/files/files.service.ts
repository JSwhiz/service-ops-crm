import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

import { FileResponseDto } from './dto/file-response.dto';
import { UploadFileBodyDto } from './dto/upload-file-body.dto';

interface CurrentAuthUser {
  id: string;
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
    const objectKey = this.buildObjectKey(body.entityType, file.originalname);
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
          entityType: body.entityType,
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

  async getById(id: string): Promise<FileResponseDto> {
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

    return this.mapFile(file);
  }

  async listByEntity(params: {
    entityType: string;
    entityId: string;
  }): Promise<FileResponseDto[]> {
    const attachments = await this.prisma.fileAttachment.findMany({
      where: {
        entityType: params.entityType,
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

  private buildObjectKey(entityType: string, originalName: string): string {
    const normalizedFileName = originalName
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9._-]/g, '')
      .toLowerCase();

    return `${entityType}/${randomUUID()}-${normalizedFileName || 'file'}`;
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
      url: this.storageService.buildObjectUrl(file.objectKey),
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
