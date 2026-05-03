import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { ApprovalRequestResponseDto } from '../approvals/dto/approval-request-response.dto';
import {
  MANUAL_TIMESHEET_EXCEPTION_CONFIRMATION_TYPE,
  TIMESHEET_EXCEPTION_APPROVAL_SOURCE_ENTITY_TYPE,
} from '../approvals/constants/approval.constants';
import { PrismaService } from '../prisma/prisma.service';

import { CreateTimesheetManualExceptionDto } from './dto/create-timesheet-manual-exception.dto';
import { GetTimesheetQueryDto } from './dto/get-timesheet-query.dto';
import { ListTimesheetCorrectionsQueryDto } from './dto/list-timesheet-corrections-query.dto';
import { TimesheetCorrectionItemDto } from './dto/timesheet-correction-item.dto';
import { TimesheetResponseDto } from './dto/timesheet-response.dto';
import { UpsertTimesheetEntryDto } from './dto/upsert-timesheet-entry.dto';
import {
  canManuallyCorrectTimesheet,
  hasWideTimesheetAccess,
} from './utils/timesheet-access.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  isActive: boolean;
}

@Injectable()
export class TimesheetsService {
  constructor(private readonly prisma: PrismaService) {}

  async getTimesheet(
    currentUser: CurrentAuthUser,
    query: GetTimesheetQueryDto,
  ): Promise<TimesheetResponseDto> {
    await this.assertAccess(currentUser, query.objectId);

    const object = await this.prisma.object.findFirst({
      where: {
        id: query.objectId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        dailyRate: true,
      },
    });

    if (!object) {
      throw new NotFoundException('Object not found');
    }

    const monthContainer = await this.ensureMonthContainer(
      query.objectId,
      query.year,
      query.month,
      currentUser.id,
    );

    await this.syncAutomaticEntries({
      objectId: query.objectId,
      timesheetMonthId: monthContainer.id,
      year: query.year,
      month: query.month,
    });

    const rows = await this.prisma.timesheetEmployeeRow.findMany({
      where: {
        timesheetMonthId: monthContainer.id,
      },
      include: {
        entries: {
          orderBy: {
            dayOfMonth: 'asc',
          },
        },
      },
      orderBy: {
        employeeNameSnapshot: 'asc',
      },
    });

    const monthFacts = await this.prisma.objectAttendanceFact.findMany({
      where: {
        objectId: query.objectId,
        operationDate: this.getMonthRange(query.year, query.month),
      },
      select: {
        employeeId: true,
        operationDate: true,
      },
    });

    const factSet = new Set(
      monthFacts.map((fact) => {
        const day = new Date(fact.operationDate).getDate();
        return `${fact.employeeId}:${day}`;
      }),
    );

    const daysInSelectedMonth = this.getDaysInMonth(query.year, query.month);

    const mappedRows = rows.map((row) => {
      const entriesByDay = new Map(
        row.entries.map((entry) => [entry.dayOfMonth, entry]),
      );

      const fullEntries = Array.from(
        { length: daysInSelectedMonth },
        (_, index) => {
          const dayOfMonth = index + 1;
          const existing = entriesByDay.get(dayOfMonth);

          return {
            dayOfMonth,
            dayValue: existing?.dayValue ?? 0,
            comment: existing?.comment ?? null,
            isChangedManually: existing?.isChangedManually ?? false,
            hasFact: factSet.has(`${row.employeeId}:${dayOfMonth}`),
          };
        },
      );

      return {
        employeeId: row.employeeId,
        employeeName: row.employeeNameSnapshot,
        rowTotal: fullEntries.reduce((sum, item) => sum + item.dayValue, 0),
        entries: fullEntries,
      };
    });

    return {
      objectId: object.id,
      objectName: object.name,
      objectDailyRate: object.dailyRate,
      year: query.year,
      month: query.month,
      status: monthContainer.status,
      daysInMonth: daysInSelectedMonth,
      monthTotal: mappedRows.reduce((sum, row) => sum + row.rowTotal, 0),
      capabilities: {
        canManualCorrection: canManuallyCorrectTimesheet(
          this.getRoleCodes(currentUser),
        ),
      },
      rows: mappedRows,
    };
  }

  async listCorrections(
    currentUser: CurrentAuthUser,
    query: ListTimesheetCorrectionsQueryDto,
  ): Promise<TimesheetCorrectionItemDto[]> {
    await this.assertAccess(currentUser, query.objectId);

    const monthContainer = await this.ensureMonthContainer(
      query.objectId,
      query.year,
      query.month,
      currentUser.id,
    );

    const correctionEntries = await this.prisma.timesheetDayEntry.findMany({
      where: {
        row: {
          timesheetMonthId: monthContainer.id,
        },
        isChangedManually: true,
      },
      include: {
        row: {
          select: {
            employeeId: true,
            employeeNameSnapshot: true,
          },
        },
        updatedBy: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
      orderBy: [
        {
          dayOfMonth: 'asc',
        },
        {
          updatedAt: 'desc',
        },
      ],
    });

    if (correctionEntries.length === 0) {
      return [];
    }

    const monthFacts = await this.prisma.objectAttendanceFact.findMany({
      where: {
        objectId: query.objectId,
        operationDate: this.getMonthRange(query.year, query.month),
      },
      select: {
        employeeId: true,
        operationDate: true,
      },
    });

    const factSet = new Set(
      monthFacts.map((fact) => {
        const day = new Date(fact.operationDate).getDate();
        return `${fact.employeeId}:${day}`;
      }),
    );

    return correctionEntries.map((entry) => ({
      employeeId: entry.row.employeeId,
      employeeName: entry.row.employeeNameSnapshot,
      dayOfMonth: entry.dayOfMonth,
      dayValue: entry.dayValue,
      comment: entry.comment ?? null,
      hasFact: factSet.has(`${entry.row.employeeId}:${entry.dayOfMonth}`),
      updatedAt: entry.updatedAt.toISOString(),
      updatedByUserId: entry.updatedBy?.id ?? null,
      updatedByUserName: entry.updatedBy?.fullName ?? null,
    }));
  }

  async upsertEntry(
    currentUser: CurrentAuthUser,
    payload: UpsertTimesheetEntryDto,
  ): Promise<TimesheetResponseDto> {
    await this.assertAccess(currentUser, payload.objectId);
    this.assertManualCorrectionAccess(currentUser);

    const daysInMonth = this.getDaysInMonth(payload.year, payload.month);
    if (payload.dayOfMonth > daysInMonth) {
      throw new NotFoundException('Day exceeds month length');
    }

    const object = await this.prisma.object.findFirst({
      where: {
        id: payload.objectId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!object) {
      throw new NotFoundException('Object not found');
    }

    const monthContainer = await this.ensureMonthContainer(
      payload.objectId,
      payload.year,
      payload.month,
      currentUser.id,
    );

    const mutationContext = await this.prepareEntryMutationContext({
      objectId: payload.objectId,
      employeeId: payload.employeeId,
      year: payload.year,
      month: payload.month,
      dayOfMonth: payload.dayOfMonth,
      dayValue: payload.dayValue,
      comment: payload.comment,
      monthContainerId: monthContainer.id,
    });

    await this.applyEntryMutation(this.prisma, {
      rowId: mutationContext.row.id,
      existingEntryId: mutationContext.existingEntry?.id ?? null,
      dayOfMonth: payload.dayOfMonth,
      dayValue: payload.dayValue,
      expectedAutoValue: mutationContext.expectedAutoValue,
      hasAttendanceFact: mutationContext.hasAttendanceFact,
      normalizedComment: mutationContext.normalizedComment,
      actorUserId: currentUser.id,
    });

    return this.getTimesheet(currentUser, {
      objectId: payload.objectId,
      year: payload.year,
      month: payload.month,
    });
  }

  async requestManualException(
    currentUser: CurrentAuthUser,
    payload: CreateTimesheetManualExceptionDto,
  ): Promise<ApprovalRequestResponseDto> {
    await this.assertAccess(currentUser, payload.objectId);

    if (canManuallyCorrectTimesheet(this.getRoleCodes(currentUser))) {
      throw new BadRequestException(
        'Direct manual correction is available for current user',
      );
    }

    const daysInMonth = this.getDaysInMonth(payload.year, payload.month);
    if (payload.dayOfMonth > daysInMonth) {
      throw new NotFoundException('Day exceeds month length');
    }

    const monthContainer = await this.ensureMonthContainer(
      payload.objectId,
      payload.year,
      payload.month,
      currentUser.id,
    );

    const mutationContext = await this.prepareEntryMutationContext({
      objectId: payload.objectId,
      employeeId: payload.employeeId,
      year: payload.year,
      month: payload.month,
      dayOfMonth: payload.dayOfMonth,
      dayValue: payload.dayValue,
      comment: payload.comment,
      monthContainerId: monthContainer.id,
    });

    if (payload.dayValue === mutationContext.expectedAutoValue) {
      throw new BadRequestException(
        'Manual exception must differ from current automatic value',
      );
    }

    const existingPendingRequest = await this.prisma.timesheetManualException.findFirst({
      where: {
        objectId: payload.objectId,
        employeeId: payload.employeeId,
        year: payload.year,
        month: payload.month,
        dayOfMonth: payload.dayOfMonth,
        status: 'pending',
      },
      select: {
        id: true,
      },
    });

    if (existingPendingRequest) {
      throw new ConflictException(
        'Timesheet manual exception approval is already pending for this day',
      );
    }

    const createdRequest = await this.prisma.$transaction(async (tx) => {
      const exception = await tx.timesheetManualException.create({
        data: {
          objectId: payload.objectId,
          employeeId: payload.employeeId,
          year: payload.year,
          month: payload.month,
          dayOfMonth: payload.dayOfMonth,
          requestedDayValue: payload.dayValue,
          currentDayValueSnapshot: mutationContext.currentDayValueSnapshot,
          comment: mutationContext.normalizedComment ?? payload.comment.trim(),
          requestedByUserId: currentUser.id,
        },
      });

      return tx.approvalRequest.create({
        data: {
          approvalType: MANUAL_TIMESHEET_EXCEPTION_CONFIRMATION_TYPE,
          sourceEntityType: TIMESHEET_EXCEPTION_APPROVAL_SOURCE_ENTITY_TYPE,
          sourceEntityId: exception.id,
          createdByUserId: currentUser.id,
          payloadSnapshot: {
            summaryTitle: 'Исключение табеля',
            summarySubtitle: `${mutationContext.row.employeeNameSnapshot} · ${payload.year}-${String(payload.month).padStart(2, '0')} · день ${payload.dayOfMonth}`,
            objectId: payload.objectId,
            employeeId: payload.employeeId,
            employeeName: mutationContext.row.employeeNameSnapshot,
            year: payload.year,
            month: payload.month,
            dayOfMonth: payload.dayOfMonth,
            currentDayValue: mutationContext.currentDayValueSnapshot,
            requestedDayValue: payload.dayValue,
            comment: mutationContext.normalizedComment ?? payload.comment.trim(),
          },
        },
        include: {
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
        },
      });
    });

    await this.prisma.auditEvent.create({
      data: {
        entityType: 'approval_request',
        entityId: createdRequest.id,
        actorUserId: currentUser.id,
        action: 'approval.request.created',
        newValues: {
          approvalType: MANUAL_TIMESHEET_EXCEPTION_CONFIRMATION_TYPE,
          sourceEntityType: TIMESHEET_EXCEPTION_APPROVAL_SOURCE_ENTITY_TYPE,
          sourceEntityId: createdRequest.sourceEntityId,
        },
      },
    });

    return this.mapApprovalRequest(createdRequest, currentUser.id);
  }

  async applyManualExceptionApprovalDecision(
    tx: Prisma.TransactionClient,
    params: {
      exceptionId: string;
      decision: 'approve' | 'reject' | 'cancel';
      actorUserId: string;
    },
  ): Promise<void> {
    const exception = await tx.timesheetManualException.findFirst({
      where: {
        id: params.exceptionId,
      },
      select: {
        id: true,
        objectId: true,
        employeeId: true,
        year: true,
        month: true,
        dayOfMonth: true,
        requestedDayValue: true,
        currentDayValueSnapshot: true,
        comment: true,
        status: true,
        resolvedAt: true,
      },
    });

    if (!exception) {
      throw new NotFoundException('Timesheet manual exception not found');
    }

    if (exception.status !== 'pending') {
      throw new ConflictException('Timesheet manual exception is already resolved');
    }

    if (params.decision === 'approve') {
      const monthContainer = await this.ensureMonthContainer(
        exception.objectId,
        exception.year,
        exception.month,
        params.actorUserId,
        tx,
      );
      const mutationContext = await this.prepareEntryMutationContext({
        objectId: exception.objectId,
        employeeId: exception.employeeId,
        year: exception.year,
        month: exception.month,
        dayOfMonth: exception.dayOfMonth,
        dayValue: exception.requestedDayValue,
        comment: exception.comment,
        monthContainerId: monthContainer.id,
        client: tx,
      });

      if (mutationContext.currentDayValueSnapshot !== exception.currentDayValueSnapshot) {
        throw new ConflictException(
          'Timesheet cell changed after approval request was created',
        );
      }

      await this.applyEntryMutation(tx, {
        rowId: mutationContext.row.id,
        existingEntryId: mutationContext.existingEntry?.id ?? null,
        dayOfMonth: exception.dayOfMonth,
        dayValue: exception.requestedDayValue,
        expectedAutoValue: mutationContext.expectedAutoValue,
        hasAttendanceFact: mutationContext.hasAttendanceFact,
        normalizedComment: exception.comment,
        actorUserId: params.actorUserId,
      });
    }

    await tx.timesheetManualException.update({
      where: {
        id: exception.id,
      },
      data: {
        status:
          params.decision === 'approve'
            ? 'approved'
            : params.decision === 'reject'
              ? 'rejected'
              : 'cancelled',
        resolvedByUserId: params.actorUserId,
        resolvedAt: new Date(),
      },
    });
  }

  private async prepareEntryMutationContext(params: {
    objectId: string;
    employeeId: string;
    year: number;
    month: number;
    dayOfMonth: number;
    dayValue: number;
    comment?: string;
    monthContainerId: string;
    client?: PrismaService | Prisma.TransactionClient;
  }): Promise<{
    row: {
      id: string;
      employeeNameSnapshot: string;
      entries: Array<{
        id: string;
        dayOfMonth: number;
        dayValue: number;
        isChangedManually: boolean;
      }>;
    };
    existingEntry: {
      id: string;
      dayOfMonth: number;
      dayValue: number;
      isChangedManually: boolean;
    } | undefined;
    expectedAutoValue: number;
    currentDayValueSnapshot: number;
    hasAttendanceFact: boolean;
    normalizedComment: string | null;
  }> {
    const client = params.client ?? this.prisma;

    const row = await client.timesheetEmployeeRow.findFirst({
      where: {
        timesheetMonthId: params.monthContainerId,
        employeeId: params.employeeId,
      },
      include: {
        entries: {
          select: {
            id: true,
            dayOfMonth: true,
            dayValue: true,
            isChangedManually: true,
          },
        },
      },
    });

    if (!row) {
      throw new NotFoundException('Employee row for timesheet not found');
    }

    const existingEntry = row.entries.find(
      (entry) => entry.dayOfMonth === params.dayOfMonth,
    );

    const attendanceFact = await client.objectAttendanceFact.findFirst({
      where: {
        objectId: params.objectId,
        employeeId: params.employeeId,
        operationDate: this.getDayRange(
          params.year,
          params.month,
          params.dayOfMonth,
        ),
      },
      select: {
        dailyRateSnapshot: true,
      },
    });

    const expectedAutoValue = attendanceFact
      ? attendanceFact.dailyRateSnapshot
      : 0;
    const normalizedComment = params.comment?.trim() || null;

    if (params.dayValue !== expectedAutoValue && !normalizedComment) {
      throw new BadRequestException(
        'Manual timesheet correction requires a comment',
      );
    }

    return {
      row,
      existingEntry,
      expectedAutoValue,
      currentDayValueSnapshot: existingEntry?.dayValue ?? expectedAutoValue,
      hasAttendanceFact: Boolean(attendanceFact),
      normalizedComment,
    };
  }

  private async applyEntryMutation(
    tx: Prisma.TransactionClient,
    params: {
      rowId: string;
      existingEntryId: string | null;
      dayOfMonth: number;
      dayValue: number;
      expectedAutoValue: number;
      hasAttendanceFact: boolean;
      normalizedComment: string | null;
      actorUserId: string;
    },
  ): Promise<void> {
    if (params.dayValue === params.expectedAutoValue) {
      if (!params.hasAttendanceFact) {
        if (params.existingEntryId) {
          await tx.timesheetDayEntry.delete({
            where: {
              id: params.existingEntryId,
            },
          });
        }

        return;
      }

      await tx.timesheetDayEntry.upsert({
        where: {
          rowId_dayOfMonth: {
            rowId: params.rowId,
            dayOfMonth: params.dayOfMonth,
          },
        },
        update: {
          dayValue: params.expectedAutoValue,
          comment: null,
          isChangedManually: false,
          updatedByUserId: params.actorUserId,
        },
        create: {
          rowId: params.rowId,
          dayOfMonth: params.dayOfMonth,
          dayValue: params.expectedAutoValue,
          comment: null,
          isChangedManually: false,
          createdByUserId: params.actorUserId,
          updatedByUserId: params.actorUserId,
        },
      });

      return;
    }

    await tx.timesheetDayEntry.upsert({
      where: {
        rowId_dayOfMonth: {
          rowId: params.rowId,
          dayOfMonth: params.dayOfMonth,
        },
      },
      update: {
        dayValue: params.dayValue,
        comment: params.normalizedComment,
        isChangedManually: true,
        updatedByUserId: params.actorUserId,
      },
      create: {
        rowId: params.rowId,
        dayOfMonth: params.dayOfMonth,
        dayValue: params.dayValue,
        comment: params.normalizedComment,
        isChangedManually: true,
        createdByUserId: params.actorUserId,
        updatedByUserId: params.actorUserId,
      },
    });
  }

  private async assertAccess(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<void> {
    const roleCodes = this.getRoleCodes(currentUser);

    if (hasWideTimesheetAccess(roleCodes)) {
      return;
    }

    const assignment = await this.prisma.objectAssignment.findFirst({
      where: {
        objectId,
        userId: currentUser.id,
        isActive: true,
        assignmentRoleCode: {
          in: ['manager', 'responsible'],
        },
      },
    });

    if (!assignment) {
      throw new ForbiddenException('Access to timesheet denied');
    }
  }

  private assertManualCorrectionAccess(currentUser: CurrentAuthUser): void {
    const roleCodes = this.getRoleCodes(currentUser);

    // TODO: extend this bridge with timesheet.manual_correction capability
    // when runtime capability enforcement is introduced.
    if (!canManuallyCorrectTimesheet(roleCodes)) {
      throw new ForbiddenException('Manual timesheet correction denied');
    }
  }

  private async ensureMonthContainer(
    objectId: string,
    year: number,
    month: number,
    currentUserId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const object = await client.object.findFirst({
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

    const monthContainer = await client.timesheetMonth.upsert({
      where: {
        objectId_year_month: {
          objectId,
          year,
          month,
        },
      },
      update: {},
      create: {
        objectId,
        year,
        month,
        status: 'open',
        createdByUserId: currentUserId,
      },
    });

    const [activeAssignments, monthAttendanceFacts] = await Promise.all([
      client.objectEmployeeAssignment.findMany({
        where: {
          objectId,
          isActive: true,
        },
        include: {
          employee: true,
        },
      }),
      client.objectAttendanceFact.findMany({
        where: {
          objectId,
          operationDate: this.getMonthRange(year, month),
        },
        select: {
          employeeId: true,
        },
      }),
    ]);

    const employeeIds = Array.from(
      new Set([
        ...activeAssignments.map((assignment) => assignment.employeeId),
        ...monthAttendanceFacts.map((fact) => fact.employeeId),
      ]),
    );

    if (employeeIds.length === 0) {
      return monthContainer;
    }

    const employees = await client.employee.findMany({
      where: {
        id: {
          in: employeeIds,
        },
      },
      select: {
        id: true,
        fullName: true,
      },
    });

    const employeeNameById = new Map(
      employees.map((employee) => [employee.id, employee.fullName]),
    );

    for (const employeeId of employeeIds) {
      await client.timesheetEmployeeRow.upsert({
        where: {
          timesheetMonthId_employeeId: {
            timesheetMonthId: monthContainer.id,
            employeeId,
          },
        },
        update: {
          employeeNameSnapshot: employeeNameById.get(employeeId) ?? 'Сотрудник',
        },
        create: {
          timesheetMonthId: monthContainer.id,
          employeeId,
          employeeNameSnapshot: employeeNameById.get(employeeId) ?? 'Сотрудник',
        },
      });
    }

    return monthContainer;
  }

  private async syncAutomaticEntries(params: {
    objectId: string;
    timesheetMonthId: string;
    year: number;
    month: number;
  }): Promise<void> {
    const rows = await this.prisma.timesheetEmployeeRow.findMany({
      where: {
        timesheetMonthId: params.timesheetMonthId,
      },
      include: {
        entries: true,
      },
    });

    if (rows.length === 0) {
      return;
    }

    const monthFacts = await this.prisma.objectAttendanceFact.findMany({
      where: {
        objectId: params.objectId,
        operationDate: this.getMonthRange(params.year, params.month),
      },
      select: {
        employeeId: true,
        operationDate: true,
        dailyRateSnapshot: true,
      },
    });

    const factSnapshotByKey = new Map<string, number>(
      monthFacts.map((fact) => {
        const day = new Date(fact.operationDate).getDate();
        return [`${fact.employeeId}:${day}`, fact.dailyRateSnapshot];
      }),
    );

    const daysInMonth = this.getDaysInMonth(params.year, params.month);
    const operations: Prisma.PrismaPromise<unknown>[] = [];

    for (const row of rows) {
      const entriesByDay = new Map(
        row.entries.map((entry) => [entry.dayOfMonth, entry]),
      );

      for (let dayOfMonth = 1; dayOfMonth <= daysInMonth; dayOfMonth += 1) {
        const factKey = `${row.employeeId}:${dayOfMonth}`;
        const autoValue = factSnapshotByKey.get(factKey);
        const hasFact = typeof autoValue === 'number';
        const existing = entriesByDay.get(dayOfMonth);

        if (hasFact) {
          if (!existing) {
            operations.push(
              this.prisma.timesheetDayEntry.create({
                data: {
                  rowId: row.id,
                  dayOfMonth,
                  dayValue: autoValue,
                  comment: null,
                  isChangedManually: false,
                },
              }),
            );
            continue;
          }

          if (!existing.isChangedManually) {
            if (existing.dayValue !== autoValue || existing.comment !== null) {
              operations.push(
                this.prisma.timesheetDayEntry.update({
                  where: {
                    id: existing.id,
                  },
                  data: {
                    dayValue: autoValue,
                    comment: null,
                    isChangedManually: false,
                  },
                }),
              );
            }

            continue;
          }

          const hasMeaningfulManualComment =
            typeof existing.comment === 'string' &&
            existing.comment.trim().length > 0;

          if (!hasMeaningfulManualComment) {
            operations.push(
              this.prisma.timesheetDayEntry.update({
                where: {
                  id: existing.id,
                },
                data: {
                  dayValue: autoValue,
                  comment: null,
                  isChangedManually: false,
                },
              }),
            );
          }

          continue;
        }

        if (existing && !existing.isChangedManually) {
          operations.push(
            this.prisma.timesheetDayEntry.delete({
              where: {
                id: existing.id,
              },
            }),
          );
        }
      }
    }

    if (operations.length > 0) {
      await this.prisma.$transaction(operations);
    }
  }

  private mapApprovalRequest(
    request: {
      id: string;
      approvalType: string;
      sourceEntityType: string;
      sourceEntityId: string;
      status: string;
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
    },
    currentUserId: string,
  ): ApprovalRequestResponseDto {
    const payloadSnapshot =
      request.payloadSnapshot &&
      typeof request.payloadSnapshot === 'object' &&
      !Array.isArray(request.payloadSnapshot)
        ? (request.payloadSnapshot as Prisma.JsonObject as Record<string, unknown>)
        : {};

    const summaryTitle =
      typeof payloadSnapshot.summaryTitle === 'string' &&
      payloadSnapshot.summaryTitle.trim()
        ? payloadSnapshot.summaryTitle
        : request.approvalType;
    const summarySubtitle =
      typeof payloadSnapshot.summarySubtitle === 'string' &&
      payloadSnapshot.summarySubtitle.trim()
        ? payloadSnapshot.summarySubtitle
        : null;

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
        title: summaryTitle,
        subtitle: summarySubtitle,
      },
      capabilities: {
        canApprove: false,
        canReject: false,
        canCancel:
          request.status === 'pending' && request.createdBy.id === currentUserId,
      },
    };
  }

  private getRoleCodes(currentUser: CurrentAuthUser): string[] {
    if (currentUser.roleCodes && currentUser.roleCodes.length > 0) {
      return currentUser.roleCodes;
    }

    return currentUser.roleCode ? [currentUser.roleCode] : [];
  }

  private getDaysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
  }

  private getMonthRange(year: number, month: number) {
    return {
      gte: new Date(year, month - 1, 1),
      lt: new Date(year, month, 1),
    };
  }

  private getDayRange(year: number, month: number, dayOfMonth: number) {
    return {
      gte: new Date(year, month - 1, dayOfMonth),
      lt: new Date(year, month - 1, dayOfMonth + 1),
    };
  }
}
