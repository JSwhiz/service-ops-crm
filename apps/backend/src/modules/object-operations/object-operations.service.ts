import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { AddObjectEmployeeDto } from './dto/add-object-employee.dto';
import { CreateArrivalPhotoDto } from './dto/create-arrival-photo.dto';
import { CreateObjectCommentDto } from './dto/create-object-comment.dto';
import { ListEmployeeDirectoryQueryDto } from './dto/list-employee-directory-query.dto';
import { ListObjectFeedQueryDto } from './dto/list-object-feed-query.dto';
import { ObjectArrivalPhotoResponseDto } from './dto/object-arrival-photo-response.dto';
import { ObjectAttendanceResponseDto } from './dto/object-attendance-response.dto';
import { ObjectCommentResponseDto } from './dto/object-comment-response.dto';
import { ObjectDailyReportResponseDto } from './dto/object-daily-report-response.dto';
import { ObjectEmployeeOptionDto } from './dto/object-employee-option.dto';
import { ObjectFeedItemDto } from './dto/object-feed-item.dto';
import { UpsertDailyReportDto } from './dto/upsert-daily-report.dto';
import { UpsertObjectAttendanceDto } from './dto/upsert-object-attendance.dto';
import { hasWideObjectAccess } from './utils/object-operation-access.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  isActive: boolean;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function todayAsBusinessDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
      where: { objectId },
      include: { createdBy: true },
      orderBy: { createdAt: 'desc' },
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
        title:
          item.commentType === 'system' ? 'Служебная запись' : 'Комментарий',
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

  async listObjectEmployees(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<ObjectEmployeeOptionDto[]> {
    await this.assertObjectVisible(currentUser, objectId);

    const items = await this.prisma.objectEmployeeAssignment.findMany({
      where: {
        objectId,
        isActive: true,
        employee: {
          deletedAt: null,
        },
      },
      include: {
        employee: true,
      },
      orderBy: {
        employee: {
          fullName: 'asc',
        },
      },
    });

    return items.map((item) => ({
      id: item.employee.id,
      fullName: item.employee.fullName,
    }));
  }

  async searchEmployeeDirectory(
    currentUser: CurrentAuthUser,
    objectId: string,
    query: ListEmployeeDirectoryQueryDto,
  ): Promise<ObjectEmployeeOptionDto[]> {
    await this.assertObjectWritable(currentUser, objectId);

    const items = await this.prisma.employee.findMany({
      where: {
        deletedAt: null,
        employmentStatus: 'active',
        ...(query.search?.trim()
          ? {
              fullName: {
                contains: query.search.trim(),
                mode: 'insensitive',
              },
            }
          : {}),
      },
      orderBy: {
        fullName: 'asc',
      },
      take: 20,
    });

    return items.map((item) => ({
      id: item.id,
      fullName: item.fullName,
    }));
  }

  async addEmployeeToObject(
    currentUser: CurrentAuthUser,
    objectId: string,
    payload: AddObjectEmployeeDto,
  ): Promise<{ success: true }> {
    await this.assertObjectWritable(currentUser, objectId);

    const object = await this.prisma.object.findFirst({
      where: {
        id: objectId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!object) {
      throw new NotFoundException('Object not found');
    }

    const employee = await this.prisma.employee.findFirst({
      where: {
        id: payload.employeeId,
        deletedAt: null,
        employmentStatus: 'active',
      },
      select: {
        id: true,
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    await this.prisma.objectEmployeeAssignment.upsert({
      where: {
        objectId_employeeId: {
          objectId,
          employeeId: payload.employeeId,
        },
      },
      update: {
        isActive: true,
      },
      create: {
        objectId,
        employeeId: payload.employeeId,
        isActive: true,
      },
    });

    return { success: true };
  }

  async removeEmployeeFromObject(
    currentUser: CurrentAuthUser,
    objectId: string,
    employeeId: string,
  ): Promise<{ success: true }> {
    await this.assertObjectWritable(currentUser, objectId);

    await this.prisma.objectEmployeeAssignment.updateMany({
      where: {
        objectId,
        employeeId,
      },
      data: {
        isActive: false,
      },
    });

    return { success: true };
  }

  async getTodayAttendance(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<ObjectAttendanceResponseDto> {
    await this.assertObjectVisible(currentUser, objectId);

    const facts = await this.prisma.objectAttendanceFact.findMany({
      where: {
        objectId,
        operationDate: startOfToday(),
      },
      select: {
        employeeId: true,
      },
    });

    return {
      operationDate: todayAsBusinessDate(),
      employeeIds: facts.map((item) => item.employeeId),
    };
  }

  async upsertObjectAttendance(
    currentUser: CurrentAuthUser,
    objectId: string,
    payload: UpsertObjectAttendanceDto,
  ): Promise<{ success: true }> {
    await this.assertObjectWritable(currentUser, objectId);

    const object = await this.prisma.object.findFirst({
      where: {
        id: objectId,
        deletedAt: null,
      },
      include: {
        employeeAssignments: {
          where: { isActive: true },
          include: { employee: true },
        },
      },
    });

    if (!object) {
      throw new NotFoundException('Object not found');
    }

    const allowedEmployeeIds = new Set(
      object.employeeAssignments.map((assignment) => assignment.employeeId),
    );

    for (const employeeId of payload.employeeIds) {
      if (!allowedEmployeeIds.has(employeeId)) {
        throw new ForbiddenException('Employee is not assigned to object');
      }
    }

    const normalizedDate = this.parseBusinessDate(payload.operationDate);
    const selectedEmployeeIds = new Set(payload.employeeIds);
    const targetYear = normalizedDate.getFullYear();
    const targetMonth = normalizedDate.getMonth() + 1;
    const dayOfMonth = normalizedDate.getDate();

    await this.prisma.$transaction(async (tx) => {
      await tx.objectAttendanceFact.deleteMany({
        where: {
          objectId,
          operationDate: normalizedDate,
        },
      });

      if (payload.employeeIds.length > 0) {
        await tx.objectAttendanceFact.createMany({
          data: payload.employeeIds.map((employeeId) => ({
            objectId,
            employeeId,
            operationDate: normalizedDate,
            dailyRateSnapshot: object.dailyRate,
            createdByUserId: currentUser.id,
          })),
        });
      }

      const monthContainer = await tx.timesheetMonth.upsert({
        where: {
          objectId_year_month: {
            objectId,
            year: targetYear,
            month: targetMonth,
          },
        },
        update: {},
        create: {
          objectId,
          year: targetYear,
          month: targetMonth,
          status: 'open',
          createdByUserId: currentUser.id,
        },
      });

      for (const assignment of object.employeeAssignments) {
        const row = await tx.timesheetEmployeeRow.upsert({
          where: {
            timesheetMonthId_employeeId: {
              timesheetMonthId: monthContainer.id,
              employeeId: assignment.employeeId,
            },
          },
          update: {
            employeeNameSnapshot: assignment.employee.fullName,
          },
          create: {
            timesheetMonthId: monthContainer.id,
            employeeId: assignment.employeeId,
            employeeNameSnapshot: assignment.employee.fullName,
          },
        });

        const existingEntry = await tx.timesheetDayEntry.findUnique({
          where: {
            rowId_dayOfMonth: {
              rowId: row.id,
              dayOfMonth,
            },
          },
        });

        if (selectedEmployeeIds.has(assignment.employeeId)) {
          await tx.timesheetDayEntry.upsert({
            where: {
              rowId_dayOfMonth: {
                rowId: row.id,
                dayOfMonth,
              },
            },
            update: {
              dayValue: existingEntry?.isChangedManually
                ? existingEntry.dayValue
                : object.dailyRate,
              updatedByUserId: currentUser.id,
            },
            create: {
              rowId: row.id,
              dayOfMonth,
              dayValue: object.dailyRate,
              isChangedManually: false,
              createdByUserId: currentUser.id,
              updatedByUserId: currentUser.id,
            },
          });

          continue;
        }

        if (existingEntry && !existingEntry.isChangedManually) {
          await tx.timesheetDayEntry.delete({
            where: {
              id: existingEntry.id,
            },
          });
        }
      }
    });

    return { success: true };
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

    const roleCodes = this.getRoleCodes(currentUser);
    const wideAccess = hasWideObjectAccess(roleCodes);
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

  private getRoleCodes(currentUser: CurrentAuthUser): string[] {
    if (currentUser.roleCodes && currentUser.roleCodes.length > 0) {
      return currentUser.roleCodes;
    }

    return currentUser.roleCode ? [currentUser.roleCode] : [];
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

  private parseBusinessDate(rawDate: string): Date {
    const parts = rawDate.split('-');

    if (parts.length !== 3) {
      throw new BadRequestException('Invalid operationDate format');
    }

    const [yearRaw, monthRaw, dayRaw] = parts;
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);

    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day)
    ) {
      throw new BadRequestException('Invalid operationDate numeric values');
    }

    if (month < 1 || month > 12) {
      throw new BadRequestException('Invalid operationDate month');
    }

    if (day < 1 || day > 31) {
      throw new BadRequestException('Invalid operationDate day');
    }

    const parsed = new Date(year, month - 1, day);

    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      throw new BadRequestException('Invalid operationDate calendar value');
    }

    return parsed;
  }
}
