import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { GetTimesheetQueryDto } from './dto/get-timesheet-query.dto';
import { TimesheetResponseDto } from './dto/timesheet-response.dto';
import { UpsertTimesheetEntryDto } from './dto/upsert-timesheet-entry.dto';
import { hasWideTimesheetAccess } from './utils/timesheet-access.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
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

    const monthContainer = await this.ensureMonthContainer(
      query.objectId,
      query.year,
      query.month,
      currentUser.id,
    );

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

    const object = await this.prisma.object.findFirst({
      where: {
        id: query.objectId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!object) {
      throw new NotFoundException('Object not found');
    }

    return {
      objectId: object.id,
      objectName: object.name,
      year: query.year,
      month: query.month,
      status: monthContainer.status,
      daysInMonth: this.getDaysInMonth(query.year, query.month),
      rows: rows.map((row) => ({
        employeeId: row.employeeId,
        employeeName: row.employeeNameSnapshot,
        entries: row.entries.map((entry) => ({
          dayOfMonth: entry.dayOfMonth,
          attendanceStatus: entry.attendanceStatus,
          note: entry.note,
        })),
      })),
    };
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
    });

    if (!row) {
      throw new NotFoundException('Employee row for timesheet not found');
    }

    await this.prisma.timesheetDayEntry.upsert({
      where: {
        rowId_dayOfMonth: {
          rowId: row.id,
          dayOfMonth: payload.dayOfMonth,
        },
      },
      update: {
        attendanceStatus: payload.attendanceStatus,
        note: payload.note ?? null,
        updatedByUserId: currentUser.id,
      },
      create: {
        rowId: row.id,
        dayOfMonth: payload.dayOfMonth,
        attendanceStatus: payload.attendanceStatus,
        note: payload.note ?? null,
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
    const wideAccess = hasWideTimesheetAccess([currentUser.roleCode]);

    if (wideAccess) {
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

    const activeAssignments = await this.prisma.objectEmployeeAssignment.findMany({
      where: {
        objectId,
        isActive: true,
      },
      include: {
        employee: true,
      },
    });

    for (const assignment of activeAssignments) {
      await this.prisma.timesheetEmployeeRow.upsert({
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
    }

    return monthContainer;
  }

  private getDaysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
  }
}
