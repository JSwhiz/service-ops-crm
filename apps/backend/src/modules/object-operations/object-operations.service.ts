import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { CreateArrivalPhotoDto } from './dto/create-arrival-photo.dto';
import { CreateObjectCommentDto } from './dto/create-object-comment.dto';
import { ListObjectFeedQueryDto } from './dto/list-object-feed-query.dto';
import { ObjectArrivalPhotoResponseDto } from './dto/object-arrival-photo-response.dto';
import { ObjectCommentResponseDto } from './dto/object-comment-response.dto';
import { ObjectDailyReportResponseDto } from './dto/object-daily-report-response.dto';
import { ObjectFeedItemDto } from './dto/object-feed-item.dto';
import { UpsertDailyReportDto } from './dto/upsert-daily-report.dto';
import { hasWideObjectAccess } from './utils/object-operation-access.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  isActive: boolean;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

@Injectable()
export class ObjectOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getTodayArrivalPhoto(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<ObjectArrivalPhotoResponseDto | null> {
    await this.assertObjectVisible(currentUser, objectId);

    const item = await this.prisma.objectArrivalPhoto.findUnique({
      where: {
        objectId_operationDate: {
          objectId,
          operationDate: startOfToday(),
        },
      },
      include: {
        createdBy: true,
      },
    });

    if (!item) {
      return null;
    }

    return this.mapArrivalPhoto(item);
  }

  async upsertTodayArrivalPhoto(
    currentUser: CurrentAuthUser,
    objectId: string,
    payload: CreateArrivalPhotoDto,
  ): Promise<ObjectArrivalPhotoResponseDto> {
    await this.assertObjectWritable(currentUser, objectId);

    const item = await this.prisma.objectArrivalPhoto.upsert({
      where: {
        objectId_operationDate: {
          objectId,
          operationDate: startOfToday(),
        },
      },
      update: {
        photoUrl: payload.photoUrl,
        photoType: payload.photoType ?? null,
        comment: payload.comment ?? null,
        createdByUserId: currentUser.id,
      },
      create: {
        objectId,
        operationDate: startOfToday(),
        photoUrl: payload.photoUrl,
        photoType: payload.photoType ?? null,
        comment: payload.comment ?? null,
        createdByUserId: currentUser.id,
      },
      include: {
        createdBy: true,
      },
    });

    return this.mapArrivalPhoto(item);
  }

  async getTodayDailyReport(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<ObjectDailyReportResponseDto | null> {
    await this.assertObjectVisible(currentUser, objectId);

    const item = await this.prisma.objectDailyReport.findUnique({
      where: {
        objectId_reportDate: {
          objectId,
          reportDate: startOfToday(),
        },
      },
      include: {
        updatedBy: true,
      },
    });

    if (!item) {
      return null;
    }

    return this.mapDailyReport(item);
  }

  async upsertTodayDailyReport(
    currentUser: CurrentAuthUser,
    objectId: string,
    payload: UpsertDailyReportDto,
  ): Promise<ObjectDailyReportResponseDto> {
    await this.assertObjectWritable(currentUser, objectId);

    const item = await this.prisma.objectDailyReport.upsert({
      where: {
        objectId_reportDate: {
          objectId,
          reportDate: startOfToday(),
        },
      },
      update: {
        content: payload.content,
        updatedByUserId: currentUser.id,
      },
      create: {
        objectId,
        reportDate: startOfToday(),
        content: payload.content,
        updatedByUserId: currentUser.id,
      },
      include: {
        updatedBy: true,
      },
    });

    return this.mapDailyReport(item);
  }

  async listComments(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<ObjectCommentResponseDto[]> {
    await this.assertObjectVisible(currentUser, objectId);

    const items = await this.prisma.objectComment.findMany({
      where: {
        objectId,
      },
      include: {
        createdBy: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 30,
    });

    return items.map((item) => this.mapComment(item));
  }

  async createComment(
    currentUser: CurrentAuthUser,
    objectId: string,
    payload: CreateObjectCommentDto,
  ): Promise<ObjectCommentResponseDto> {
    await this.assertObjectWritable(currentUser, objectId);

    const item = await this.prisma.objectComment.create({
      data: {
        objectId,
        content: payload.content,
        commentType: payload.commentType ?? 'manual',
        createdByUserId: currentUser.id,
      },
      include: {
        createdBy: true,
      },
    });

    return this.mapComment(item);
  }

  async getFeed(
    currentUser: CurrentAuthUser,
    objectId: string,
    query: ListObjectFeedQueryDto,
  ): Promise<ObjectFeedItemDto[]> {
    await this.assertObjectVisible(currentUser, objectId);

    const limit = Math.max(1, Math.min(Number(query.limit || 20), 100));

    const [arrivals, reports, comments] = await Promise.all([
      this.prisma.objectArrivalPhoto.findMany({
        where: { objectId },
        include: { createdBy: true },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      }),
      this.prisma.objectDailyReport.findMany({
        where: { objectId },
        include: { updatedBy: true },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      }),
      this.prisma.objectComment.findMany({
        where: { objectId },
        include: { createdBy: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);

    const feed: ObjectFeedItemDto[] = [
      ...arrivals.map((item) => ({
        type: 'arrival_photo' as const,
        id: item.id,
        occurredAt: item.updatedAt.toISOString(),
        title: 'Фото прибытия',
        description: item.comment ?? item.photoUrl,
        author: {
          id: item.createdBy.id,
          login: item.createdBy.login,
          fullName: item.createdBy.fullName,
        },
      })),
      ...reports.map((item) => ({
        type: 'daily_report' as const,
        id: item.id,
        occurredAt: item.updatedAt.toISOString(),
        title: 'Ежедневный отчет',
        description: item.content,
        author: {
          id: item.updatedBy.id,
          login: item.updatedBy.login,
          fullName: item.updatedBy.fullName,
        },
      })),
      ...comments.map((item) => ({
        type: 'comment' as const,
        id: item.id,
        occurredAt: item.createdAt.toISOString(),
        title: item.commentType === 'system' ? 'Служебная запись' : 'Комментарий',
        description: item.content,
        author: {
          id: item.createdBy.id,
          login: item.createdBy.login,
          fullName: item.createdBy.fullName,
        },
      })),
    ];

    return feed
      .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
      .slice(0, limit);
  }

  private async assertObjectVisible(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<void> {
    const object = await this.prisma.object.findFirst({
      where: {
        id: objectId,
        deletedAt: null,
      },
      include: {
        assignments: {
          where: {
            isActive: true,
          },
        },
      },
    });

    if (!object) {
      throw new NotFoundException('Object not found');
    }

    const wideAccess = hasWideObjectAccess([currentUser.roleCode]);
    const isAssigned = object.assignments.some(
      (assignment) => assignment.userId === currentUser.id,
    );

    if (!wideAccess && !isAssigned) {
      throw new ForbiddenException('Access to object operations denied');
    }
  }

  private async assertObjectWritable(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<void> {
    await this.assertObjectVisible(currentUser, objectId);
  }

  private mapArrivalPhoto(item: {
    id: string;
    objectId: string;
    operationDate: Date;
    photoUrl: string;
    photoType: string | null;
    comment: string | null;
    createdAt: Date;
    updatedAt: Date;
    createdBy: {
      id: string;
      login: string;
      fullName: string;
    };
  }): ObjectArrivalPhotoResponseDto {
    return {
      id: item.id,
      objectId: item.objectId,
      operationDate: item.operationDate.toISOString(),
      photoUrl: item.photoUrl,
      photoType: item.photoType,
      comment: item.comment,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      createdBy: {
        id: item.createdBy.id,
        login: item.createdBy.login,
        fullName: item.createdBy.fullName,
      },
    };
  }

  private mapDailyReport(item: {
    id: string;
    objectId: string;
    reportDate: Date;
    content: string;
    createdAt: Date;
    updatedAt: Date;
    updatedBy: {
      id: string;
      login: string;
      fullName: string;
    };
  }): ObjectDailyReportResponseDto {
    return {
      id: item.id,
      objectId: item.objectId,
      reportDate: item.reportDate.toISOString(),
      content: item.content,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      updatedBy: {
        id: item.updatedBy.id,
        login: item.updatedBy.login,
        fullName: item.updatedBy.fullName,
      },
    };
  }

  private mapComment(item: {
    id: string;
    objectId: string;
    content: string;
    commentType: string;
    createdAt: Date;
    updatedAt: Date;
    createdBy: {
      id: string;
      login: string;
      fullName: string;
    };
  }): ObjectCommentResponseDto {
    return {
      id: item.id,
      objectId: item.objectId,
      content: item.content,
      commentType: item.commentType,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      createdBy: {
        id: item.createdBy.id,
        login: item.createdBy.login,
        fullName: item.createdBy.fullName,
      },
    };
  }
}
