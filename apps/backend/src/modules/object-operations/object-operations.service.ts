import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { EmployeesService } from '../employees/employees.service';
import { EMPLOYEE_SUBSTITUTION_STATUSES } from '../employees/constants/employee-hr.constants';
import { canManageEmployeeAssignments } from '../employees/utils/employee-hr-access.util';
import { EquipmentScopeResponseDto } from '../equipment/dto/equipment-response.dto';
import { EquipmentService } from '../equipment/equipment.service';
import { FileResponseDto } from '../files/dto/file-response.dto';
import { CreateObjectInventoryIssueDto } from '../inventory/dto/create-object-inventory-issue.dto';
import { InventoryMovementResponseDto } from '../inventory/dto/inventory-movement-response.dto';
import { ObjectInventoryResponseDto } from '../inventory/dto/object-inventory-response.dto';
import { InventoryService } from '../inventory/inventory.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  buildOneTimeOrderAccessWhere,
  canViewOneTimeOrderByScope,
} from '../one-time-orders/utils/one-time-order-access.util';
import {
  canEditObjectDailyRate,
  canOverrideObjectAttendanceRate,
  canViewObjectBasicProfile,
  canViewObjectByScope,
  canViewObjectCompensationRates,
  LEADERSHIP_OBJECT_ROLE_CODES,
} from '../objects/utils/object-access.util';
import { PrismaService } from '../prisma/prisma.service';
import { TimesheetsService } from '../timesheets/timesheets.service';
import { buildTaskAccessWhere } from '../tasks/utils/task-access.util';
import {
  buildObjectDefaultRatePolicy,
  calculateMonthlySalaryDailyRate,
  getRatePolicyLabel,
  normalizeRatePolicy,
  parseRatePolicySnapshot,
} from '../timesheets/utils/timesheet-rate-policy.util';

import { AddObjectEmployeeDto } from './dto/add-object-employee.dto';
import { CreateObjectCompensationRateDto } from './dto/create-object-compensation-rate.dto';
import { CreateArrivalPhotoDto } from './dto/create-arrival-photo.dto';
import { CreateObjectCommentDto } from './dto/create-object-comment.dto';
import { ListEmployeeDirectoryQueryDto } from './dto/list-employee-directory-query.dto';
import { ListObjectFeedQueryDto } from './dto/list-object-feed-query.dto';
import { ObjectArrivalPhotoResponseDto } from './dto/object-arrival-photo-response.dto';
import { ObjectAttendanceResponseDto } from './dto/object-attendance-response.dto';
import { ObjectCommentResponseDto } from './dto/object-comment-response.dto';
import { ObjectCompensationRateResponseDto } from './dto/object-compensation-rate-response.dto';
import { ObjectDailyReportResponseDto } from './dto/object-daily-report-response.dto';
import { ObjectEmployeeOptionDto } from './dto/object-employee-option.dto';
import { ObjectFeedItemDto } from './dto/object-feed-item.dto';
import { LinkedOneTimeOrderProjectionDto } from './dto/linked-one-time-order-projection.dto';
import { UpdateObjectEmployeeRatePolicyDto } from './dto/update-object-employee-rate-policy.dto';
import { UpdateObjectCompensationRateDto } from './dto/update-object-compensation-rate.dto';
import { UpdateObjectCompensationDefaultsDto } from './dto/update-object-compensation-defaults.dto';
import { UpsertDailyReportDto } from './dto/upsert-daily-report.dto';
import { UpsertObjectAttendanceDto } from './dto/upsert-object-attendance.dto';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
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

interface ObjectEmployeeAvailabilityView {
  isUnavailable: boolean;
  availabilityMode: string | null;
  startDate: string | null;
  endDate: string | null;
  comment: string | null;
}

interface ObjectEmployeeSubstitutionView {
  id: string;
  role: 'primary' | 'replacement';
  counterpartEmployeeId: string;
  counterpartEmployeeName: string;
  startDate: string;
  endDate: string | null;
  status: string;
  reason: string;
  comment: string | null;
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

interface LinkedOneTimeOrderView {
  id: string;
  title: string;
  status: string;
  executionDate: Date | null;
  agreedSum: number | null;
  createdByUserId: string;
  assignments: Array<{
    userId: string;
    assignmentRoleCode: string;
    isActive: boolean;
    user: {
      id: string;
      fullName: string;
      roles: Array<{
        role: {
          code: string;
        };
      }>;
    };
  }>;
  _count: {
    comments: number;
    dailyReports: number;
    photos: number;
  };
}

@Injectable()
export class ObjectOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesService: EmployeesService,
    private readonly inventoryService: InventoryService,
    private readonly equipmentService: EquipmentService,
    private readonly timesheetsService: TimesheetsService,
    private readonly notificationsService: NotificationsService,
  ) {}

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

    const attachmentsMap = await this.listAttachmentsByEntityIds(
      'object_arrival_photo',
      [item.id],
    );

    return this.mapArrivalPhoto(item, attachmentsMap.get(item.id) ?? []);
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
        photoUrl: payload.photoUrl ?? null,
        photoType: payload.photoType ?? null,
        comment: payload.comment ?? null,
        createdByUserId: currentUser.id,
      },
      create: {
        objectId,
        operationDate: startOfToday(),
        photoUrl: payload.photoUrl ?? null,
        photoType: payload.photoType ?? null,
        comment: payload.comment ?? null,
        createdByUserId: currentUser.id,
      },
      include: {
        createdBy: true,
      },
    });

    return this.mapArrivalPhoto(item, []);
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

    const attachmentsMap = await this.listAttachmentsByEntityIds(
      'object_daily_report',
      [item.id],
    );

    return this.mapDailyReport(item, attachmentsMap.get(item.id) ?? []);
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

    return this.mapDailyReport(item, []);
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

    const attachmentsMap = await this.listAttachmentsByEntityIds(
      'object_comment',
      items.map((item) => item.id),
    );

    return items.map((item) =>
      this.mapComment(item, attachmentsMap.get(item.id) ?? []),
    );
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

    return this.mapComment(item, []);
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

    const [arrivalAttachments, reportAttachments, commentAttachments] =
      await Promise.all([
        this.listAttachmentsByEntityIds(
          'object_arrival_photo',
          arrivals.map((item) => item.id),
        ),
        this.listAttachmentsByEntityIds(
          'object_daily_report',
          reports.map((item) => item.id),
        ),
        this.listAttachmentsByEntityIds(
          'object_comment',
          comments.map((item) => item.id),
        ),
      ]);

    const feed: ObjectFeedItemDto[] = [
      ...arrivals.map((item) => ({
        type: 'arrival_photo' as const,
        id: item.id,
        occurredAt: item.updatedAt.toISOString(),
        title: 'Фото прибытия',
        description: item.comment ?? item.photoUrl ?? 'Фото без описания',
        attachments: arrivalAttachments.get(item.id) ?? [],
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
        attachments: reportAttachments.get(item.id) ?? [],
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
        attachments: commentAttachments.get(item.id) ?? [],
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
    await this.assertHrObjectProfileVisible(currentUser, objectId);
    const canViewRates = await this.canViewCompensationRatesOnObject(currentUser, objectId);

    const dayRange = this.getBusinessDayRange(startOfToday());
    const [object, items] = await Promise.all([
      this.prisma.object.findUnique({
        where: {
          id: objectId,
        },
        select: {
          paymentType: true,
          dailyRate: true,
          monthlySalary: true,
        },
      }),
      this.prisma.objectEmployeeAssignment.findMany({
        where: {
          objectId,
          isActive: true,
          employee: {
            deletedAt: null,
          },
        },
        include: {
          employee: {
            include: {
              availabilityWindows: {
                where: this.buildAvailabilityOverlapWhere(dayRange),
                orderBy: {
                  startDate: 'asc',
                },
              },
              substitutionsAsPrimary: {
                where: this.buildActiveObjectSubstitutionWhere(objectId, dayRange),
                include: {
                  substituteEmployee: {
                    select: {
                      id: true,
                      fullName: true,
                    },
                  },
                },
              },
              substitutionsAsReplacement: {
                where: this.buildActiveObjectSubstitutionWhere(objectId, dayRange),
                include: {
                  employee: {
                    select: {
                      id: true,
                      fullName: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: {
          employee: {
            fullName: 'asc',
          },
        },
      }),
    ]);

    return items.map((item) => {
      const mapped = this.mapObjectEmployeeOption({
        employeeId: item.employee.id,
        fullName: item.employee.fullName,
        position: item.employee.position,
        baseDailyRate: item.employee.baseDailyRate,
        workScheduleCode: item.employee.workScheduleCode,
        workScheduleCustom: item.employee.workScheduleCustom,
        workTimeText: item.employee.workTimeText,
        isAssignedToObject: true,
        ratePolicy: item,
        objectPaymentType: (object?.paymentType ?? 'monthly') as 'monthly' | 'daily',
        objectMonthlySalary: object?.monthlySalary ?? 0,
        objectDailyRate: object?.dailyRate ?? 0,
        ratePolicyFallbackAmount: this.getObjectMonthlySalaryDailyFallback({
          paymentType: (object?.paymentType ?? 'monthly') as 'monthly' | 'daily',
          monthlySalary: object?.monthlySalary ?? 0,
          dailyRate: object?.dailyRate ?? 0,
          operationDate: startOfToday(),
          scheduleCode: item.ratePolicyScheduleCode,
        }),
        availabilityWindows: item.employee.availabilityWindows,
        substitutionsAsPrimary: item.employee.substitutionsAsPrimary,
        substitutionsAsReplacement: item.employee.substitutionsAsReplacement,
      });
      return canViewRates ? mapped : { ...mapped, baseDailyRate: null, ratePolicy: null };
    });
  }

  async listLinkedOneTimeOrders(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<LinkedOneTimeOrderProjectionDto[]> {
    await this.assertObjectVisible(currentUser, objectId);

    const orders = (await this.prisma.oneTimeOrder.findMany({
      where: {
        AND: [
          { linkedObjectId: objectId },
          buildOneTimeOrderAccessWhere({
            currentUserId: currentUser.id,
            roleCodes: this.getRoleCodes(currentUser),
            permissionCodes: currentUser.permissionCodes,
          }),
        ],
      },
      include: {
        assignments: {
          where: {
            isActive: true,
            assignmentRoleCode: 'one_time_manager',
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
        _count: {
          select: {
            comments: true,
            dailyReports: true,
            photos: {
              where: {
                deletedAt: null,
              },
            },
          },
        },
      },
      orderBy: [
        {
          executionDate: 'desc',
        },
        {
          createdAt: 'desc',
        },
      ],
    })) as LinkedOneTimeOrderView[];

    const fileRows = await this.prisma.fileAttachment.findMany({
      where: {
        entityType: 'one_time_order',
        entityId: {
          in: orders.map((order) => order.id),
        },
        file: {
          deletedAt: null,
        },
      },
      select: {
        entityId: true,
      },
    });

    const fileCountMap = new Map<string, number>();

    for (const row of fileRows) {
      fileCountMap.set(row.entityId, (fileCountMap.get(row.entityId) ?? 0) + 1);
    }

    const roleCodes = this.getRoleCodes(currentUser);
    const taskCountRows =
      orders.length === 0
        ? []
        : await this.prisma.task.groupBy({
            by: ['oneTimeOrderId'],
            where: {
              AND: [
                {
                  oneTimeOrderId: {
                    in: orders.map((order) => order.id),
                  },
                },
                buildTaskAccessWhere({
                  currentUserId: currentUser.id,
                  roleCodes,
                }),
              ],
            },
            _count: {
              _all: true,
            },
          });
    const taskCountMap = new Map(
      taskCountRows.flatMap((row) =>
        row.oneTimeOrderId ? [[row.oneTimeOrderId, row._count._all] as const] : [],
      ),
    );

    return orders.map((order) => ({
      id: order.id,
      title: order.title,
      status: order.status,
      executionDate: order.executionDate?.toISOString() ?? null,
      agreedSum: order.agreedSum,
      canOpenOrderCard: canViewOneTimeOrderByScope({
        currentUserId: currentUser.id,
        roleCodes,
        permissionCodes: currentUser.permissionCodes,
        order: {
          createdByUserId: order.createdByUserId,
          assignments: order.assignments.map((assignment) => ({
            userId: assignment.userId,
            assignmentRoleCode: assignment.assignmentRoleCode,
            isActive: assignment.isActive,
          })),
        },
      }),
      managers: order.assignments.map((assignment) => ({
        userId: assignment.user.id,
        fullName: assignment.user.fullName,
        roleCode: assignment.user.roles[0]?.role.code ?? 'unknown',
      })),
      summary: {
        commentsCount: order._count.comments,
        reportsCount: order._count.dailyReports,
        photosCount: order._count.photos,
        filesCount: fileCountMap.get(order.id) ?? 0,
        tasksCount: taskCountMap.get(order.id) ?? 0,
      },
    }));
  }

  getObjectInventory(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<ObjectInventoryResponseDto> {
    return this.inventoryService.listObjectInventory(currentUser, objectId);
  }

  createObjectInventoryIssue(
    currentUser: CurrentAuthUser,
    objectId: string,
    payload: CreateObjectInventoryIssueDto,
  ): Promise<InventoryMovementResponseDto> {
    return this.inventoryService.createObjectIssueMovement(
      currentUser,
      objectId,
      payload,
    );
  }

  getObjectEquipment(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<EquipmentScopeResponseDto> {
    return this.equipmentService.listObjectEquipment(currentUser, objectId);
  }

  async searchEmployeeDirectory(
    currentUser: CurrentAuthUser,
    objectId: string,
    query: ListEmployeeDirectoryQueryDto,
  ): Promise<ObjectEmployeeOptionDto[]> {
    await this.assertEmployeeAssignmentWritable(currentUser, objectId);
    const canViewRates = await this.canViewCompensationRatesOnObject(currentUser, objectId);

    const dayRange = this.getBusinessDayRange(startOfToday());
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
      include: {
        availabilityWindows: {
          where: this.buildAvailabilityOverlapWhere(dayRange),
          orderBy: {
            startDate: 'asc',
          },
        },
        substitutionsAsPrimary: {
          where: this.buildActiveObjectSubstitutionWhere(objectId, dayRange),
          include: {
            substituteEmployee: {
              select: {
                id: true,
                fullName: true,
              },
            },
          },
        },
        substitutionsAsReplacement: {
          where: this.buildActiveObjectSubstitutionWhere(objectId, dayRange),
          include: {
            employee: {
              select: {
                id: true,
                fullName: true,
              },
            },
          },
        },
      },
      orderBy: {
        fullName: 'asc',
      },
      take: 20,
    });

    return items.map((item) => {
      const mapped = this.mapObjectEmployeeOption({
        employeeId: item.id,
        fullName: item.fullName,
        position: item.position,
        baseDailyRate: item.baseDailyRate,
        workScheduleCode: item.workScheduleCode,
        workScheduleCustom: item.workScheduleCustom,
        workTimeText: item.workTimeText,
        isAssignedToObject: false,
        availabilityWindows: item.availabilityWindows,
        substitutionsAsPrimary: item.substitutionsAsPrimary,
        substitutionsAsReplacement: item.substitutionsAsReplacement,
      });
      return canViewRates ? mapped : { ...mapped, baseDailyRate: null, ratePolicy: null };
    });
  }

  async addEmployeeToObject(
    currentUser: CurrentAuthUser,
    objectId: string,
    payload: AddObjectEmployeeDto,
  ): Promise<{ success: true }> {
    await this.assertEmployeeAssignmentWritable(currentUser, objectId);
    await this.employeesService.assignEmployeeToObject(
      currentUser,
      payload.employeeId,
      { objectId },
    );

    return { success: true };
  }

  async removeEmployeeFromObject(
    currentUser: CurrentAuthUser,
    objectId: string,
    employeeId: string,
  ): Promise<{ success: true }> {
    await this.assertEmployeeAssignmentWritable(currentUser, objectId);
    await this.employeesService.removeEmployeeFromObject(
      currentUser,
      employeeId,
      objectId,
    );

    return { success: true };
  }

  async updateEmployeeRatePolicy(
    currentUser: CurrentAuthUser,
    objectId: string,
    employeeId: string,
    payload: UpdateObjectEmployeeRatePolicyDto,
  ): Promise<ObjectEmployeeOptionDto> {
    await this.assertRatePolicyWritable(currentUser);
    await this.assertObjectVisible(currentUser, objectId);

    if (payload.rateOptionId) {
      const rateOption = await this.prisma.objectCompensationRate.findFirst({
        where: { id: payload.rateOptionId, objectId, isActive: true },
      });
      if (!rateOption) {
        throw new BadRequestException('Выбранный вариант оплаты неактивен или относится к другому объекту');
      }
      if (
        rateOption.ratePolicyType !== payload.ratePolicyType ||
        rateOption.baseAmount !== payload.baseAmount ||
        rateOption.scheduleCode !== (payload.scheduleCode ?? null) ||
        rateOption.standardShiftHours !== (payload.standardShiftHours ?? 8) ||
        [...rateOption.scheduleWeekdays].sort().join(',') !==
          [...(payload.scheduleWeekdays ?? [])].sort().join(',')
      ) {
        throw new BadRequestException('График и сумма должны совпадать с выбранным вариантом оплаты');
      }
    }

    const assignment = await this.prisma.objectEmployeeAssignment.findFirst({
      where: {
        objectId,
        employeeId,
        isActive: true,
      },
      include: {
        employee: {
          include: {
            availabilityWindows: {
              where: this.buildAvailabilityOverlapWhere(
                this.getBusinessDayRange(startOfToday()),
              ),
              orderBy: {
                startDate: 'asc',
              },
            },
            substitutionsAsPrimary: {
              where: this.buildActiveObjectSubstitutionWhere(
                objectId,
                this.getBusinessDayRange(startOfToday()),
              ),
              include: {
                substituteEmployee: {
                  select: {
                    id: true,
                    fullName: true,
                  },
                },
              },
            },
            substitutionsAsReplacement: {
              where: this.buildActiveObjectSubstitutionWhere(
                objectId,
                this.getBusinessDayRange(startOfToday()),
              ),
              include: {
                employee: {
                  select: {
                    id: true,
                    fullName: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException('Object employee assignment not found');
    }

    const updated = await this.prisma.objectEmployeeAssignment.update({
      where: {
        id: assignment.id,
      },
      data: {
        ratePolicyType: payload.ratePolicyType,
        rateOptionId: payload.rateOptionId ?? null,
        ratePolicyBaseAmount: payload.baseAmount,
        ratePolicyScheduleCode: payload.scheduleCode ?? null,
        ratePolicyWeekdays: payload.scheduleWeekdays ?? [],
        ratePolicyRoundingMode: payload.roundingMode ?? 'none',
        ratePolicyRoundingStep: payload.roundingStep ?? null,
        ratePolicyStandardShiftHours: payload.standardShiftHours ?? null,
        ratePolicyWorkingDaysInMonth: payload.workingDaysInMonth ?? null,
        ratePolicyExcludedHolidayDays: payload.excludedHolidayDays ?? null,
        ratePolicyNotes: payload.notes?.trim() || null,
        ratePolicyUpdatedByUserId: currentUser.id,
        ratePolicyUpdatedAt: new Date(),
      },
      include: {
        employee: {
          include: {
            availabilityWindows: {
              where: this.buildAvailabilityOverlapWhere(
                this.getBusinessDayRange(startOfToday()),
              ),
              orderBy: {
                startDate: 'asc',
              },
            },
            substitutionsAsPrimary: {
              where: this.buildActiveObjectSubstitutionWhere(
                objectId,
                this.getBusinessDayRange(startOfToday()),
              ),
              include: {
                substituteEmployee: {
                  select: {
                    id: true,
                    fullName: true,
                  },
                },
              },
            },
            substitutionsAsReplacement: {
              where: this.buildActiveObjectSubstitutionWhere(
                objectId,
                this.getBusinessDayRange(startOfToday()),
              ),
              include: {
                employee: {
                  select: {
                    id: true,
                    fullName: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    return this.mapObjectEmployeeOption({
      employeeId: updated.employee.id,
      fullName: updated.employee.fullName,
      isAssignedToObject: true,
      ratePolicy: updated,
      availabilityWindows: updated.employee.availabilityWindows,
      substitutionsAsPrimary: updated.employee.substitutionsAsPrimary,
      substitutionsAsReplacement: updated.employee.substitutionsAsReplacement,
    });
  }

  async listCompensationRates(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<ObjectCompensationRateResponseDto[]> {
    await this.assertObjectVisible(currentUser, objectId);
    const items = await this.prisma.objectCompensationRate.findMany({
      where: { objectId },
      orderBy: [{ isActive: 'desc' }, { category: 'asc' }, { name: 'asc' }],
    });
    return items.map((item) => this.mapCompensationRate(item));
  }

  async updateCompensationDefaults(
    currentUser: CurrentAuthUser,
    objectId: string,
    payload: UpdateObjectCompensationDefaultsDto,
  ): Promise<{ success: true }> {
    await this.assertRatePolicyWritable(currentUser);
    await this.assertObjectVisible(currentUser, objectId);
    const existing = await this.prisma.object.findFirst({
      where: { id: objectId, deletedAt: null },
      select: {
        seasonMode: true,
        paymentType: true, dailyRate: true, monthlySalary: true,
        paymentScheduleCode: true, paymentScheduleWeekdays: true,
        summerPaymentType: true, summerDailyRate: true, summerMonthlySalary: true,
        summerScheduleCode: true, summerScheduleWeekdays: true,
        winterPaymentType: true, winterDailyRate: true, winterMonthlySalary: true,
        winterScheduleCode: true, winterScheduleWeekdays: true,
      },
    });
    if (!existing) throw new NotFoundException('Object not found');
    const updateData: Prisma.ObjectUpdateInput = { ...payload };
    const summerProfileChanged = payload.summerPaymentType !== undefined ||
      payload.summerDailyRate !== undefined || payload.summerMonthlySalary !== undefined ||
      payload.summerScheduleCode !== undefined || payload.summerScheduleWeekdays !== undefined;
    const winterProfileChanged = payload.winterPaymentType !== undefined ||
      payload.winterDailyRate !== undefined || payload.winterMonthlySalary !== undefined ||
      payload.winterScheduleCode !== undefined || payload.winterScheduleWeekdays !== undefined;
    if (existing.seasonMode === 'summer' && summerProfileChanged) {
      updateData.paymentType = payload.summerPaymentType ?? existing.summerPaymentType;
      updateData.dailyRate = payload.summerDailyRate ?? existing.summerDailyRate;
      updateData.monthlySalary = payload.summerMonthlySalary ?? existing.summerMonthlySalary;
      updateData.paymentScheduleCode = payload.summerScheduleCode ?? existing.summerScheduleCode;
      updateData.paymentScheduleWeekdays = payload.summerScheduleWeekdays ?? existing.summerScheduleWeekdays;
    } else if (existing.seasonMode === 'winter' && winterProfileChanged) {
      updateData.paymentType = payload.winterPaymentType ?? existing.winterPaymentType;
      updateData.dailyRate = payload.winterDailyRate ?? existing.winterDailyRate;
      updateData.monthlySalary = payload.winterMonthlySalary ?? existing.winterMonthlySalary;
      updateData.paymentScheduleCode = payload.winterScheduleCode ?? existing.winterScheduleCode;
      updateData.paymentScheduleWeekdays = payload.winterScheduleWeekdays ?? existing.winterScheduleWeekdays;
    }
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.object.update({
        where: { id: objectId },
        data: updateData,
      });
      await tx.auditEvent.create({
        data: {
          entityType: 'object',
          entityId: objectId,
          actorUserId: currentUser.id,
          action: 'object.compensation_defaults.updated',
          oldValues: existing as unknown as Prisma.InputJsonObject,
          newValues: {
            paymentType: updated.paymentType,
            dailyRate: updated.dailyRate,
            monthlySalary: updated.monthlySalary,
            paymentScheduleCode: updated.paymentScheduleCode,
            paymentScheduleWeekdays: updated.paymentScheduleWeekdays,
            summerPaymentType: updated.summerPaymentType,
            summerDailyRate: updated.summerDailyRate,
            summerMonthlySalary: updated.summerMonthlySalary,
            summerScheduleCode: updated.summerScheduleCode,
            summerScheduleWeekdays: updated.summerScheduleWeekdays,
            winterPaymentType: updated.winterPaymentType,
            winterDailyRate: updated.winterDailyRate,
            winterMonthlySalary: updated.winterMonthlySalary,
            winterScheduleCode: updated.winterScheduleCode,
            winterScheduleWeekdays: updated.winterScheduleWeekdays,
          },
        },
      });
    });
    return { success: true };
  }

  async createCompensationRate(
    currentUser: CurrentAuthUser,
    objectId: string,
    payload: CreateObjectCompensationRateDto,
  ): Promise<ObjectCompensationRateResponseDto> {
    await this.assertRatePolicyWritable(currentUser);
    await this.assertObjectVisible(currentUser, objectId);
    const item = await this.prisma.$transaction(async (tx) => {
      const created = await tx.objectCompensationRate.create({
        data: {
          objectId,
          name: payload.name.trim(),
          category: payload.category,
          ratePolicyType: payload.ratePolicyType,
          baseAmount: payload.baseAmount,
          scheduleCode: payload.scheduleCode ?? null,
          scheduleWeekdays: payload.scheduleWeekdays ?? [],
          standardShiftHours: payload.standardShiftHours ?? 8,
          notes: payload.notes?.trim() || null,
          createdByUserId: currentUser.id,
        },
      });
      await tx.auditEvent.create({
        data: {
          entityType: 'object_compensation_rate',
          entityId: created.id,
          actorUserId: currentUser.id,
          action: 'object.compensation_rate.created',
          newValues: { objectId, name: created.name, category: created.category, ratePolicyType: created.ratePolicyType, baseAmount: created.baseAmount },
        },
      });
      return created;
    });
    return this.mapCompensationRate(item);
  }

  async updateCompensationRate(
    currentUser: CurrentAuthUser,
    objectId: string,
    rateId: string,
    payload: UpdateObjectCompensationRateDto,
  ): Promise<ObjectCompensationRateResponseDto> {
    await this.assertRatePolicyWritable(currentUser);
    await this.assertObjectVisible(currentUser, objectId);
    const existing = await this.prisma.objectCompensationRate.findFirst({ where: { id: rateId, objectId } });
    if (!existing) throw new NotFoundException('Вариант оплаты не найден');
    const item = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.objectCompensationRate.update({
        where: { id: rateId },
        data: {
          ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
          ...(payload.category !== undefined ? { category: payload.category } : {}),
          ...(payload.ratePolicyType !== undefined ? { ratePolicyType: payload.ratePolicyType } : {}),
          ...(payload.baseAmount !== undefined ? { baseAmount: payload.baseAmount } : {}),
          ...(payload.scheduleCode !== undefined ? { scheduleCode: payload.scheduleCode || null } : {}),
          ...(payload.scheduleWeekdays !== undefined ? { scheduleWeekdays: payload.scheduleWeekdays } : {}),
          ...(payload.standardShiftHours !== undefined ? { standardShiftHours: payload.standardShiftHours } : {}),
          ...(payload.notes !== undefined ? { notes: payload.notes.trim() || null } : {}),
          ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
          updatedByUserId: currentUser.id,
        },
      });
      await tx.auditEvent.create({
        data: {
          entityType: 'object_compensation_rate',
          entityId: updated.id,
          actorUserId: currentUser.id,
          action: 'object.compensation_rate.updated',
          oldValues: { name: existing.name, category: existing.category, ratePolicyType: existing.ratePolicyType, baseAmount: existing.baseAmount, isActive: existing.isActive },
          newValues: { name: updated.name, category: updated.category, ratePolicyType: updated.ratePolicyType, baseAmount: updated.baseAmount, isActive: updated.isActive },
        },
      });
      return updated;
    });
    return this.mapCompensationRate(item);
  }

  async getTodayAttendance(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<ObjectAttendanceResponseDto> {
    await this.assertObjectVisible(currentUser, objectId, true);

    const operationDate = startOfToday();
    const [facts, employees] = await Promise.all([
      this.prisma.objectAttendanceFact.findMany({
        where: {
          objectId,
          operationDate,
        },
        select: {
          employeeId: true,
          workedHours: true,
          dailyRateSnapshot: true,
          ratePolicySnapshot: true,
        },
      }),
      this.listAttendanceEmployees(objectId, operationDate),
    ]);

    return {
      operationDate: todayAsBusinessDate(),
      employeeIds: facts.map((item) => item.employeeId),
      employeeFacts: facts.map((item) => ({
        employeeId: item.employeeId,
        workedHours: item.workedHours,
        ratePolicyType: parseRatePolicySnapshot(item.ratePolicySnapshot)?.ratePolicyType ?? null,
        rateAmount: parseRatePolicySnapshot(item.ratePolicySnapshot)?.baseAmount ?? item.dailyRateSnapshot,
        rateReason: parseRatePolicySnapshot(item.ratePolicySnapshot)?.notes ?? null,
      })),
      employees,
    };
  }

  async upsertObjectAttendance(
    currentUser: CurrentAuthUser,
    objectId: string,
    payload: UpsertObjectAttendanceDto,
  ): Promise<{ success: true }> {
    await this.assertObjectVisible(currentUser, objectId, true);

    const inputFacts = payload.employeeFacts ?? [];
    if (new Set(inputFacts.map((fact) => fact.employeeId)).size !== inputFacts.length || inputFacts.some((fact) => !payload.employeeIds.includes(fact.employeeId))) {
      throw new BadRequestException('Факты должны быть уникальными и относиться только к отмеченным сотрудникам');
    }
    for (const fact of inputFacts) {
      const specialRate = fact.ratePolicyType !== undefined || fact.rateAmount !== undefined || fact.rateReason !== undefined || fact.clearRateOverride === true;
      if (!specialRate) continue;
      if (fact.clearRateOverride) {
        await this.assertAttendanceRateOverrideWritable(currentUser);
        if (fact.ratePolicyType !== undefined || fact.rateAmount !== undefined || fact.rateReason !== undefined) {
          throw new BadRequestException('Сброс особой ставки нельзя совмещать с новой ставкой');
        }
        continue;
      }
      if (!fact.ratePolicyType || fact.rateAmount === undefined || !fact.rateReason?.trim()) {
        throw new BadRequestException('Для особого выхода укажите вид работы, ставку и основание');
      }
    }

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

    const sideJobFacts = inputFacts.filter((fact) => fact.ratePolicyType === 'side_job');
    if (sideJobFacts.length > 0) {
      const assignedManager = await this.prisma.objectAssignment.findFirst({
        where: { objectId, userId: currentUser.id, assignmentRoleCode: 'manager', isActive: true },
        select: { id: true },
      });
      if (!assignedManager && !canOverrideObjectAttendanceRate(this.getRoleCodes(currentUser))) {
        throw new ForbiddenException('Дополнительный выход может назначить только менеджер этого объекта');
      }
    }
    for (const fact of inputFacts) {
      if (fact.ratePolicyType === 'complex_shift' || fact.clearRateOverride) {
        await this.assertAttendanceRateOverrideWritable(currentUser);
      }
    }

    const normalizedDate = this.parseBusinessDate(payload.operationDate);
    const workedHoursByEmployeeId = new Map(
      (payload.employeeFacts ?? []).map((item) => [
        item.employeeId,
        item.workedHours ?? null,
      ]),
    );
    const targetYear = normalizedDate.getFullYear();
    const targetMonth = normalizedDate.getMonth() + 1;
    const dayRange = this.getBusinessDayRange(normalizedDate);

    const [existingFacts, activeSubstitutions, unavailableEmployees] =
      await Promise.all([
        this.prisma.objectAttendanceFact.findMany({
          where: {
            objectId,
            operationDate: normalizedDate,
          },
          select: {
            employeeId: true,
            ratePolicySnapshot: true,
          },
        }),
        this.prisma.employeeSubstitution.findMany({
          where: this.buildActiveObjectSubstitutionWhere(objectId, dayRange),
          include: {
            substituteEmployee: {
              select: {
                id: true,
                fullName: true,
              },
            },
          },
        }),
        this.prisma.employee.findMany({
          where: {
            id: {
              in: payload.employeeIds,
            },
            deletedAt: null,
            availabilityWindows: {
              some: {
                availabilityStatus: 'unavailable',
                ...this.buildAvailabilityOverlapWhere(dayRange),
              },
            },
          },
          include: {
            availabilityWindows: {
              where: {
                availabilityStatus: 'unavailable',
                ...this.buildAvailabilityOverlapWhere(dayRange),
              },
              orderBy: {
                startDate: 'asc',
              },
            },
          },
        }),
      ]);

    const allowedEmployeeIds = new Set([
      ...object.employeeAssignments.map((assignment) => assignment.employeeId),
      ...activeSubstitutions.map((item) => item.substituteEmployee.id),
    ]);

    const existingFactEmployeeIds = new Set(
      existingFacts.map((item) => item.employeeId),
    );
    const previousFactByEmployeeId = new Map(existingFacts.map((item) => [item.employeeId, item]));
    const sideJobNotificationFacts = sideJobFacts.filter((fact) => {
      const previous = parseRatePolicySnapshot(previousFactByEmployeeId.get(fact.employeeId)?.ratePolicySnapshot);
      return previous?.ratePolicyType !== 'side_job' || previous.baseAmount !== fact.rateAmount || previous.notes !== fact.rateReason?.trim();
    });
    const unavailableEmployeeIds = new Set(
      unavailableEmployees
        .filter(
          (employee) =>
            this.resolveActiveUnavailableAvailability(employee.availabilityWindows) !==
            null,
        )
        .map((employee) => employee.id),
    );

    const timesheetEmployees = new Map(
      object.employeeAssignments.map((assignment) => [
        assignment.employeeId,
        assignment.employee.fullName,
      ]),
    );

    for (const substitution of activeSubstitutions) {
      timesheetEmployees.set(
        substitution.substituteEmployee.id,
        substitution.substituteEmployee.fullName,
      );
    }

    if (existingFactEmployeeIds.size > 0) {
      const missingEmployeeIds = [...existingFactEmployeeIds].filter(
        (employeeId) => !timesheetEmployees.has(employeeId),
      );

      if (missingEmployeeIds.length > 0) {
        const additionalEmployees = await this.prisma.employee.findMany({
          where: {
            id: {
              in: missingEmployeeIds,
            },
            deletedAt: null,
          },
          select: {
            id: true,
            fullName: true,
          },
        });

        for (const employee of additionalEmployees) {
          timesheetEmployees.set(employee.id, employee.fullName);
        }
      }
    }

    for (const employeeId of payload.employeeIds) {
      if (!allowedEmployeeIds.has(employeeId)) {
        throw new ForbiddenException('Employee is not assigned to object');
      }

      if (
        unavailableEmployeeIds.has(employeeId) &&
        !existingFactEmployeeIds.has(employeeId)
      ) {
        throw new ForbiddenException(
          'Unavailable employee cannot be added to attendance without override',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "objects" WHERE "id" = ${objectId} FOR UPDATE`;
      const previousFacts = await tx.objectAttendanceFact.findMany({ where: { objectId, operationDate: normalizedDate } });
      await tx.objectAttendanceFact.deleteMany({
        where: {
          objectId,
          operationDate: normalizedDate,
          employeeId: { notIn: payload.employeeIds },
        },
      });

      if (payload.employeeIds.length > 0) {
        const nextFacts = payload.employeeIds.map((employeeId) => {
            const assignment = object.employeeAssignments.find(
              (item) => item.employeeId === employeeId,
            );
            const previous = previousFacts.find((fact) => fact.employeeId === employeeId);
            const inputFact = inputFacts.find((fact) => fact.employeeId === employeeId);
            const savedPolicy = parseRatePolicySnapshot(previous?.ratePolicySnapshot);
            const ratePolicy = inputFact?.ratePolicyType
              ? normalizeRatePolicy({ ratePolicyType: inputFact.ratePolicyType, ratePolicyBaseAmount: inputFact.rateAmount, ratePolicyNotes: inputFact.rateReason }, inputFact.rateAmount ?? 0)
              : inputFact?.clearRateOverride
                ? assignment?.ratePolicyUpdatedAt
                  ? normalizeRatePolicy(assignment, this.getObjectMonthlySalaryDailyFallback({ paymentType: object.paymentType as 'monthly' | 'daily', monthlySalary: object.monthlySalary, dailyRate: object.dailyRate, operationDate: normalizedDate, scheduleCode: assignment.ratePolicyScheduleCode ?? object.paymentScheduleCode, scheduleWeekdays: assignment.ratePolicyWeekdays }))
                  : buildObjectDefaultRatePolicy({ paymentType: object.paymentType as 'monthly' | 'daily', monthlySalary: object.monthlySalary, dailyRate: object.dailyRate, scheduleCode: assignment?.ratePolicyScheduleCode ?? object.paymentScheduleCode, scheduleWeekdays: assignment?.ratePolicyWeekdays ?? object.paymentScheduleWeekdays })
                : savedPolicy ?? (previous
              ? normalizeRatePolicy({ ratePolicyType: 'per_attendance', ratePolicyBaseAmount: previous.dailyRateSnapshot }, previous.dailyRateSnapshot)
              : assignment?.ratePolicyUpdatedAt
              ? normalizeRatePolicy(
                  assignment,
                  this.getObjectMonthlySalaryDailyFallback({
                    paymentType: object.paymentType as 'monthly' | 'daily',
                    monthlySalary: object.monthlySalary,
                    dailyRate: object.dailyRate,
                    operationDate: normalizedDate,
                    scheduleCode: assignment.ratePolicyScheduleCode ?? object.paymentScheduleCode,
                    scheduleWeekdays: assignment.ratePolicyWeekdays,
                  }),
                )
              : buildObjectDefaultRatePolicy({
                  paymentType: object.paymentType as 'monthly' | 'daily',
                  monthlySalary: object.monthlySalary,
                  dailyRate: object.dailyRate,
                  scheduleCode: assignment?.ratePolicyScheduleCode ?? object.paymentScheduleCode,
                  scheduleWeekdays: assignment?.ratePolicyUpdatedAt
                    ? assignment.ratePolicyWeekdays
                    : object.paymentScheduleWeekdays,
                }));
            const workedHours = workedHoursByEmployeeId.has(employeeId) ? workedHoursByEmployeeId.get(employeeId) ?? null : previous?.workedHours ?? null;
            const dailyRateSnapshot =
              ratePolicy.ratePolicyType === 'monthly_fixed'
                ? calculateMonthlySalaryDailyRate({
                    monthlySalary: ratePolicy.baseAmount,
                    year: targetYear,
                    month: targetMonth,
                    scheduleCode: ratePolicy.scheduleCode,
                    scheduleWeekdays: ratePolicy.scheduleWeekdays,
                  }).dailyRate
                : ratePolicy.ratePolicyType === 'partial_shift'
                  ? Math.round(
                      ratePolicy.baseAmount *
                        (workedHours ?? ratePolicy.standardShiftHours) /
                        ratePolicy.standardShiftHours,
                    )
                  : ratePolicy.baseAmount;

            return {
              objectId,
              employeeId,
              operationDate: normalizedDate,
              dailyRateSnapshot,
              workedHours,
              ratePolicySnapshot: ratePolicy as unknown as Prisma.InputJsonObject,
              calculationExplanation:
                ratePolicy.ratePolicyType === 'partial_shift'
                  ? `${ratePolicy.baseAmount} * ${workedHours ?? ratePolicy.standardShiftHours} / ${ratePolicy.standardShiftHours}`
                  : null,
              createdByUserId: previous?.createdByUserId ?? currentUser.id,
            };
          });
        for (const fact of nextFacts) {
          const { createdByUserId, ...values } = fact;
          await tx.objectAttendanceFact.upsert({ where: { objectId_employeeId_operationDate: { objectId, employeeId: fact.employeeId, operationDate: normalizedDate } }, update: values, create: { ...values, createdByUserId } });
        }
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

      for (const [employeeId, employeeFullName] of timesheetEmployees.entries()) {
        await tx.timesheetEmployeeRow.upsert({
          where: {
            timesheetMonthId_employeeId: {
              timesheetMonthId: monthContainer.id,
              employeeId,
            },
          },
          update: {
            employeeNameSnapshot: employeeFullName,
          },
          create: {
            timesheetMonthId: monthContainer.id,
            employeeId,
            employeeNameSnapshot: employeeFullName,
          },
        });
      }
      await this.timesheetsService.syncAttendanceDay(tx, { objectId, timesheetMonthId: monthContainer.id, year: targetYear, month: targetMonth, dayOfMonth: normalizedDate.getDate(), actorUserId: currentUser.id, previousFactEmployeeIds: previousFacts.map((fact) => fact.employeeId) });
      const nextFacts = await tx.objectAttendanceFact.findMany({ where: { objectId, operationDate: normalizedDate } });
      const snapshot = (facts: typeof nextFacts) => facts.map((fact) => ({ employeeId: fact.employeeId, dailyRateSnapshot: fact.dailyRateSnapshot, workedHours: fact.workedHours, ratePolicySnapshot: fact.ratePolicySnapshot }));
      await tx.auditEvent.create({ data: { entityType: 'object_attendance', entityId: objectId, actorUserId: currentUser.id, action: 'object.attendance.updated', oldValues: snapshot(previousFacts) as Prisma.InputJsonValue, newValues: snapshot(nextFacts) as Prisma.InputJsonValue, metadata: { operationDate: payload.operationDate, comment: payload.comment?.trim() || null } } });

      if (sideJobNotificationFacts.length > 0) {
        const recipients = await this.notificationsService.listActiveUserIdsByRoles(
          [...LEADERSHIP_OBJECT_ROLE_CODES, 'deputy_director'],
          tx,
        );
        const employeeNames = sideJobNotificationFacts
          .map((fact) => timesheetEmployees.get(fact.employeeId))
          .filter((name): name is string => Boolean(name));
        await this.notificationsService.createForRecipients({
          recipientUserIds: recipients.filter((id) => id !== currentUser.id),
          type: 'object.extra_shift.created',
          title: 'На объекте назначен дополнительный выход',
          body: `${employeeNames.join(', ') || 'Сотрудник'} · ${payload.operationDate}`,
          entityType: 'object',
          entityId: objectId,
          targetUrl: `/objects/${encodeURIComponent(objectId)}#today`,
        }, tx);
      }
    });

    return { success: true };
  }

  private async listAttendanceEmployees(
    objectId: string,
    operationDate: Date,
  ): Promise<ObjectEmployeeOptionDto[]> {
    const dayRange = this.getBusinessDayRange(operationDate);
    const [object, assignedEmployees, activeSubstitutions] = await Promise.all([
      this.prisma.object.findUnique({
        where: { id: objectId },
        select: { paymentType: true, dailyRate: true, monthlySalary: true, paymentScheduleCode: true, paymentScheduleWeekdays: true },
      }),
      this.prisma.objectEmployeeAssignment.findMany({
        where: {
          objectId,
          isActive: true,
          employee: {
            deletedAt: null,
          },
        },
        include: {
          employee: {
            include: {
              availabilityWindows: {
                where: this.buildAvailabilityOverlapWhere(dayRange),
                orderBy: {
                  startDate: 'asc',
                },
              },
              substitutionsAsPrimary: {
                where: this.buildActiveObjectSubstitutionWhere(objectId, dayRange),
                include: {
                  substituteEmployee: {
                    select: {
                      id: true,
                      fullName: true,
                    },
                  },
                },
              },
              substitutionsAsReplacement: {
                where: this.buildActiveObjectSubstitutionWhere(objectId, dayRange),
                include: {
                  employee: {
                    select: {
                      id: true,
                      fullName: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.employeeSubstitution.findMany({
        where: this.buildActiveObjectSubstitutionWhere(objectId, dayRange),
        include: {
          employee: {
            select: {
              id: true,
              fullName: true,
            },
          },
          substituteEmployee: {
            include: {
              availabilityWindows: {
                where: this.buildAvailabilityOverlapWhere(dayRange),
                orderBy: {
                  startDate: 'asc',
                },
              },
              substitutionsAsPrimary: {
                where: this.buildActiveObjectSubstitutionWhere(objectId, dayRange),
                include: {
                  substituteEmployee: {
                    select: {
                      id: true,
                      fullName: true,
                    },
                  },
                },
              },
              substitutionsAsReplacement: {
                where: this.buildActiveObjectSubstitutionWhere(objectId, dayRange),
                include: {
                  employee: {
                    select: {
                      id: true,
                      fullName: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const mapped = new Map<string, ObjectEmployeeOptionDto>();

    for (const item of assignedEmployees) {
      mapped.set(
        item.employee.id,
        this.mapObjectEmployeeOption({
        employeeId: item.employee.id,
        fullName: item.employee.fullName,
        isAssignedToObject: true,
        ratePolicy: item,
        objectPaymentType: (object?.paymentType ?? 'monthly') as 'monthly' | 'daily',
        objectMonthlySalary: object?.monthlySalary ?? 0,
        objectDailyRate: object?.dailyRate ?? 0,
        objectScheduleCode: object?.paymentScheduleCode ?? null,
        objectScheduleWeekdays: object?.paymentScheduleWeekdays ?? [],
        ratePolicyFallbackAmount: this.getObjectMonthlySalaryDailyFallback({
          paymentType: (object?.paymentType ?? 'monthly') as 'monthly' | 'daily',
          monthlySalary: object?.monthlySalary ?? 0,
          dailyRate: object?.dailyRate ?? 0,
          operationDate,
          scheduleCode: item.ratePolicyScheduleCode ?? object?.paymentScheduleCode,
          scheduleWeekdays: item.ratePolicyUpdatedAt ? item.ratePolicyWeekdays : (object?.paymentScheduleWeekdays ?? []),
        }),
        availabilityWindows: item.employee.availabilityWindows,
        substitutionsAsPrimary: item.employee.substitutionsAsPrimary,
        substitutionsAsReplacement: item.employee.substitutionsAsReplacement,
        }),
      );
    }

    for (const item of activeSubstitutions) {
      if (mapped.has(item.substituteEmployee.id)) {
        continue;
      }

      mapped.set(
        item.substituteEmployee.id,
        this.mapObjectEmployeeOption({
          employeeId: item.substituteEmployee.id,
          fullName: item.substituteEmployee.fullName,
          isAssignedToObject: false,
          objectPaymentType: (object?.paymentType ?? 'monthly') as 'monthly' | 'daily',
          objectMonthlySalary: object?.monthlySalary ?? 0,
          objectDailyRate: object?.dailyRate ?? 0,
          objectScheduleCode: object?.paymentScheduleCode ?? null,
          objectScheduleWeekdays: object?.paymentScheduleWeekdays ?? [],
          ratePolicyFallbackAmount: this.getObjectMonthlySalaryDailyFallback({
            paymentType: (object?.paymentType ?? 'monthly') as 'monthly' | 'daily',
            monthlySalary: object?.monthlySalary ?? 0,
            dailyRate: object?.dailyRate ?? 0,
            operationDate,
            scheduleCode: object?.paymentScheduleCode,
            scheduleWeekdays: object?.paymentScheduleWeekdays,
          }),
          availabilityWindows: item.substituteEmployee.availabilityWindows,
          substitutionsAsPrimary: item.substituteEmployee.substitutionsAsPrimary,
          substitutionsAsReplacement: item.substituteEmployee.substitutionsAsReplacement,
        }),
      );
    }

    return [...mapped.values()].sort((left, right) =>
      left.fullName.localeCompare(right.fullName, 'ru'),
    );
  }

  private getObjectMonthlySalaryDailyFallback(params: {
    paymentType: 'monthly' | 'daily';
    monthlySalary: number;
    dailyRate: number;
    operationDate: Date;
    scheduleCode?: string | null;
    scheduleWeekdays?: string[];
  }): number {
    const calculation = calculateMonthlySalaryDailyRate({
      monthlySalary: params.monthlySalary,
      year: params.operationDate.getFullYear(),
      month: params.operationDate.getMonth() + 1,
      scheduleCode: params.scheduleCode ?? null,
      scheduleWeekdays: params.scheduleWeekdays ?? [],
    });

    return params.paymentType === 'monthly'
      ? calculation.dailyRate
      : Math.max(0, Math.round(params.dailyRate));
  }

  private buildActiveObjectSubstitutionWhere(
    objectId: string,
    dayRange: { start: Date; end: Date },
  ) {
    return {
      objectId,
      status: {
        in: EMPLOYEE_SUBSTITUTION_STATUSES.filter(
          (status) => status === 'planned' || status === 'active',
        ),
      },
      startDate: {
        lte: dayRange.end,
      },
      OR: [
        {
          endDate: null,
        },
        {
          endDate: {
            gte: dayRange.start,
          },
        },
      ],
    };
  }

  private buildAvailabilityOverlapWhere(dayRange: { start: Date; end: Date }) {
    return {
      startDate: {
        lte: dayRange.end,
      },
      OR: [
        {
          endDate: null,
        },
        {
          endDate: {
            gte: dayRange.start,
          },
        },
      ],
    };
  }

  private getBusinessDayRange(operationDate: Date): { start: Date; end: Date } {
    const start = new Date(
      operationDate.getFullYear(),
      operationDate.getMonth(),
      operationDate.getDate(),
      0,
      0,
      0,
      0,
    );
    const end = new Date(
      operationDate.getFullYear(),
      operationDate.getMonth(),
      operationDate.getDate(),
      23,
      59,
      59,
      999,
    );

    return { start, end };
  }

  private resolveActiveUnavailableAvailability(
    windows: Array<{
      id: string;
      startDate: Date;
      endDate: Date | null;
      availabilityMode: string;
      availabilityStatus: string;
      comment: string | null;
    }>,
  ): ObjectEmployeeAvailabilityView | null {
    const unavailableWindow = windows.find(
      (windowItem) => windowItem.availabilityStatus === 'unavailable',
    );

    if (!unavailableWindow) {
      return null;
    }

    return {
      isUnavailable: true,
      availabilityMode: unavailableWindow.availabilityMode,
      startDate: unavailableWindow.startDate.toISOString(),
      endDate: unavailableWindow.endDate?.toISOString() ?? null,
      comment: unavailableWindow.comment,
    };
  }

  private mapObjectEmployeeOption(params: {
    employeeId: string;
    fullName: string;
    position?: string | null;
    baseDailyRate?: number | null;
    workScheduleCode?: string | null;
    workScheduleCustom?: string | null;
    workTimeText?: string | null;
    isAssignedToObject: boolean;
    ratePolicy?: {
      ratePolicyType: string | null;
      rateOptionId?: string | null;
      ratePolicyBaseAmount: number | null;
      ratePolicyScheduleCode: string | null;
      ratePolicyRoundingMode: string | null;
      ratePolicyRoundingStep: number | null;
      ratePolicyStandardShiftHours: number | null;
      ratePolicyWorkingDaysInMonth: number | null;
      ratePolicyExcludedHolidayDays: number | null;
      ratePolicyNotes: string | null;
      ratePolicyWeekdays?: string[];
      ratePolicyUpdatedAt: Date | null;
      employee?: {
        baseDailyRate: number | null;
      };
    } | null;
    objectPaymentType?: 'monthly' | 'daily';
    objectMonthlySalary?: number;
    objectDailyRate?: number;
    objectScheduleCode?: string | null;
    objectScheduleWeekdays?: string[];
    ratePolicyFallbackAmount?: number;
    availabilityWindows: Array<{
      id: string;
      startDate: Date;
      endDate: Date | null;
      availabilityMode: string;
      availabilityStatus: string;
      comment: string | null;
    }>;
    substitutionsAsPrimary: Array<{
      id: string;
      startDate: Date;
      endDate: Date | null;
      status: string;
      reason: string;
      comment: string | null;
      substituteEmployee: {
        id: string;
        fullName: string;
      };
    }>;
    substitutionsAsReplacement: Array<{
      id: string;
      startDate: Date;
      endDate: Date | null;
      status: string;
      reason: string;
      comment: string | null;
      employee: {
        id: string;
        fullName: string;
      };
    }>;
  }): ObjectEmployeeOptionDto {
    const activeAvailability =
      this.resolveActiveUnavailableAvailability(params.availabilityWindows);

    const activeSubstitutions: ObjectEmployeeSubstitutionView[] = [
      ...params.substitutionsAsPrimary.map((item) => ({
        id: item.id,
        role: 'primary' as const,
        counterpartEmployeeId: item.substituteEmployee.id,
        counterpartEmployeeName: item.substituteEmployee.fullName,
        startDate: item.startDate.toISOString(),
        endDate: item.endDate?.toISOString() ?? null,
        status: item.status,
        reason: item.reason,
        comment: item.comment,
      })),
      ...params.substitutionsAsReplacement.map((item) => ({
        id: item.id,
        role: 'replacement' as const,
        counterpartEmployeeId: item.employee.id,
        counterpartEmployeeName: item.employee.fullName,
        startDate: item.startDate.toISOString(),
        endDate: item.endDate?.toISOString() ?? null,
        status: item.status,
        reason: item.reason,
        comment: item.comment,
      })),
    ].sort((left, right) => (left.startDate < right.startDate ? 1 : -1));
    const ratePolicy = params.ratePolicy?.ratePolicyUpdatedAt
      ? normalizeRatePolicy(
          params.ratePolicy,
          params.ratePolicyFallbackAmount ??
            params.ratePolicy.employee?.baseDailyRate ??
            0,
        )
      : params.objectPaymentType
        ? buildObjectDefaultRatePolicy({
            paymentType: params.objectPaymentType,
            monthlySalary: params.objectMonthlySalary ?? 0,
            dailyRate: params.objectDailyRate ?? 0,
            scheduleCode: params.ratePolicy?.ratePolicyScheduleCode ?? params.objectScheduleCode ?? null,
            scheduleWeekdays: params.ratePolicy?.ratePolicyUpdatedAt
              ? params.ratePolicy.ratePolicyWeekdays ?? []
              : params.ratePolicy?.ratePolicyWeekdays?.length
                ? params.ratePolicy.ratePolicyWeekdays
                : params.objectScheduleWeekdays ?? [],
          })
        : null;

    return {
      id: params.employeeId,
      fullName: params.fullName,
      position: params.position ?? null,
      baseDailyRate: params.baseDailyRate ?? null,
      workScheduleCode: params.workScheduleCode ?? null,
      workScheduleCustom: params.workScheduleCustom ?? null,
      workTimeText: params.workTimeText ?? null,
      isAssignedToObject: params.isAssignedToObject,
      ratePolicy: ratePolicy
        ? {
            ...ratePolicy,
            scheduleWeekdays: ratePolicy.scheduleWeekdays ?? [],
            rateOptionId: params.ratePolicy?.rateOptionId ?? null,
            label: getRatePolicyLabel(ratePolicy),
            updatedAt: params.ratePolicy?.ratePolicyUpdatedAt?.toISOString() ?? null,
          }
        : null,
      availability:
        activeAvailability ?? {
          isUnavailable: false,
          availabilityMode: null,
          startDate: null,
          endDate: null,
          comment: null,
        },
      activeSubstitutions,
    };
  }

  private async assertObjectVisible(
    currentUser: CurrentAuthUser,
    objectId: string,
    ownScopeOnly = false,
  ): Promise<void> {
    const object = await this.prisma.object.findFirst({
      where: {
        id: objectId,
        deletedAt: null,
      },
      select: {
        id: true,
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
    });

    if (!object) {
      throw new NotFoundException('Object not found');
    }

    if (
      !canViewObjectByScope({
        currentUserId: currentUser.id,
        roleCodes: this.getRoleCodes(currentUser),
        ownScopeOnly,
        object,
      })
    ) {
      throw new ForbiddenException('Access to object operations denied');
    }
  }

  private async canViewCompensationRatesOnObject(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<boolean> {
    const object = await this.prisma.object.findFirst({
      where: { id: objectId, deletedAt: null },
      select: {
        id: true,
        createdByUserId: true,
        assignments: {
          where: { isActive: true },
          select: { userId: true, isActive: true },
        },
      },
    });
    if (!object) throw new NotFoundException('Object not found');
    return canViewObjectCompensationRates({
      currentUserId: currentUser.id,
      roleCodes: this.getRoleCodes(currentUser),
      object,
    });
  }

  private async assertHrObjectProfileVisible(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<void> {
    const object = await this.prisma.object.findFirst({
      where: { id: objectId, deletedAt: null },
      select: {
        id: true,
        createdByUserId: true,
        assignments: {
          where: { isActive: true },
          select: { userId: true, isActive: true },
        },
      },
    });
    if (!object) throw new NotFoundException('Object not found');
    if (
      !canViewObjectBasicProfile({
        currentUserId: currentUser.id,
        roleCodes: this.getRoleCodes(currentUser),
        permissionCodes: currentUser.permissionCodes,
        ownScopeOnly: true,
        object,
      })
    ) {
      throw new ForbiddenException('Access to employee staffing denied');
    }
  }

  private async assertEmployeeAssignmentWritable(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<void> {
    await this.assertHrObjectProfileVisible(currentUser, objectId);
    if (!canManageEmployeeAssignments(currentUser.permissionCodes ?? [])) {
      throw new ForbiddenException('Employee assignment management denied');
    }
  }

  private async assertObjectWritable(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<void> {
    await this.assertObjectVisible(currentUser, objectId);
  }

  private async assertRatePolicyWritable(
    currentUser: CurrentAuthUser,
  ): Promise<void> {
    if (!canEditObjectDailyRate(this.getRoleCodes(currentUser))) {
      throw new ForbiddenException('Управление вариантами оплаты объекта недоступно');
    }
  }

  private mapCompensationRate(item: {
    id: string;
    objectId: string;
    name: string;
    category: string;
    ratePolicyType: string;
    baseAmount: number;
    scheduleCode: string | null;
    scheduleWeekdays: string[];
    standardShiftHours: number;
    notes: string | null;
    isActive: boolean;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    updatedAt: Date;
  }): ObjectCompensationRateResponseDto {
    return {
      id: item.id,
      objectId: item.objectId,
      name: item.name,
      category: item.category as 'standard' | 'substitution',
      ratePolicyType: item.ratePolicyType as 'daily_rate' | 'monthly_fixed',
      baseAmount: item.baseAmount,
      scheduleCode: item.scheduleCode,
      scheduleWeekdays: item.scheduleWeekdays,
      standardShiftHours: item.standardShiftHours,
      notes: item.notes,
      isActive: item.isActive,
      effectiveFrom: item.effectiveFrom.toISOString(),
      effectiveTo: item.effectiveTo?.toISOString() ?? null,
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private async assertAttendanceRateOverrideWritable(
    currentUser: CurrentAuthUser,
  ): Promise<void> {
    if (!canOverrideObjectAttendanceRate(this.getRoleCodes(currentUser))) {
      throw new ForbiddenException('Attendance rate override denied');
    }
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
    photoUrl: string | null;
    photoType: string | null;
    comment: string | null;
    createdAt: Date;
    updatedAt: Date;
    createdBy: {
      id: string;
      login: string;
      fullName: string;
    };
  }, attachments: FileResponseDto[]): ObjectArrivalPhotoResponseDto {
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
      attachments,
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
  }, attachments: FileResponseDto[]): ObjectDailyReportResponseDto {
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
      attachments,
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
  }, attachments: FileResponseDto[]): ObjectCommentResponseDto {
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
      attachments,
    };
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
