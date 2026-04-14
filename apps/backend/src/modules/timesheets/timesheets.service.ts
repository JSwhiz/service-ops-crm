import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { GetTimesheetQueryDto } from './dto/get-timesheet-query.dto';
import { ListTimesheetCorrectionsQueryDto } from './dto/list-timesheet-corrections-query.dto';
import { TimesheetCorrectionItemDto } from './dto/timesheet-correction-item.dto';
import { TimesheetResponseDto } from './dto/timesheet-response.dto';
import { UpsertTimesheetEntryDto } from './dto/upsert-timesheet-entry.dto';
import { hasWideTimesheetAccess } from './utils/timesheet-access.util';

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
      objectDailyRate: object.dailyRate,
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
        dailyRate: true,
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

    const row = await this.prisma.timesheetEmployeeRow.findFirst({
      where: {
        timesheetMonthId: monthContainer.id,
        employeeId: payload.employeeId,
      },
      include: {
        entries: true,
      },
    });

    if (!row) {
      throw new NotFoundException('Employee row for timesheet not found');
    }

    const existingEntry = row.entries.find(
      (entry) => entry.dayOfMonth === payload.dayOfMonth,
    );

    const attendanceFact = await this.prisma.objectAttendanceFact.findFirst({
      where: {
        objectId: payload.objectId,
        employeeId: payload.employeeId,
        operationDate: this.getDayRange(
          payload.year,
          payload.month,
          payload.dayOfMonth,
        ),
      },
      select: {
        id: true,
      },
    });

    const expectedAutoValue = attendanceFact ? object.dailyRate : 0;
    const normalizedComment = payload.comment?.trim();

    if (payload.dayValue !== expectedAutoValue && !normalizedComment) {
      throw new BadRequestException(
        'Manual timesheet correction requires a comment',
      );
    }

    if (payload.dayValue === expectedAutoValue) {
      if (!attendanceFact) {
        if (existingEntry) {
          await this.prisma.timesheetDayEntry.delete({
            where: {
              id: existingEntry.id,
            },
          });
        }

        return this.getTimesheet(currentUser, {
          objectId: payload.objectId,
          year: payload.year,
          month: payload.month,
        });
      }

      await this.prisma.timesheetDayEntry.upsert({
        where: {
          rowId_dayOfMonth: {
            rowId: row.id,
            dayOfMonth: payload.dayOfMonth,
          },
        },
        update: {
          dayValue: expectedAutoValue,
          comment: null,
          isChangedManually: false,
          updatedByUserId: currentUser.id,
        },
        create: {
          rowId: row.id,
          dayOfMonth: payload.dayOfMonth,
          dayValue: expectedAutoValue,
          comment: null,
          isChangedManually: false,
          createdByUserId: currentUser.id,
          updatedByUserId: currentUser.id,
        },
      });

      return this.getTimesheet(currentUser, {
        objectId: payload.objectId,
        year: payload.year,
        month: payload.month,
      });
    }

    await this.prisma.timesheetDayEntry.upsert({
      where: {
        rowId_dayOfMonth: {
          rowId: row.id,
          dayOfMonth: payload.dayOfMonth,
        },
      },
      update: {
        dayValue: payload.dayValue,
        comment: normalizedComment ?? null,
        isChangedManually: true,
        updatedByUserId: currentUser.id,
      },
      create: {
        rowId: row.id,
        dayOfMonth: payload.dayOfMonth,
        dayValue: payload.dayValue,
        comment: normalizedComment ?? null,
        isChangedManually: true,
        createdByUserId: currentUser.id,
        updatedByUserId: currentUser.id,
      },
    });

    return this.getTimesheet(currentUser, {
      objectId: payload.objectId,
      year: payload.year,
      month: payload.month,
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

  private async ensureMonthContainer(
    objectId: string,
    year: number,
    month: number,
    currentUserId: string,
  ) {
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

    const monthContainer = await this.prisma.timesheetMonth.upsert({
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
      this.prisma.objectEmployeeAssignment.findMany({
        where: {
          objectId,
          isActive: true,
        },
        include: {
          employee: true,
        },
      }),
      this.prisma.objectAttendanceFact.findMany({
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

    const employees = await this.prisma.employee.findMany({
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
      await this.prisma.timesheetEmployeeRow.upsert({
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
    objectDailyRate: number;
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
      },
    });

    const factSet = new Set(
      monthFacts.map((fact) => {
        const day = new Date(fact.operationDate).getDate();
        return `${fact.employeeId}:${day}`;
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
        const hasFact = factSet.has(factKey);
        const existing = entriesByDay.get(dayOfMonth);

        if (hasFact) {
          if (!existing) {
            operations.push(
              this.prisma.timesheetDayEntry.create({
                data: {
                  rowId: row.id,
                  dayOfMonth,
                  dayValue: params.objectDailyRate,
                  comment: null,
                  isChangedManually: false,
                },
              }),
            );
            continue;
          }

          if (!existing.isChangedManually) {
            if (existing.dayValue !== params.objectDailyRate) {
              operations.push(
                this.prisma.timesheetDayEntry.update({
                  where: {
                    id: existing.id,
                  },
                  data: {
                    dayValue: params.objectDailyRate,
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
                  dayValue: params.objectDailyRate,
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
