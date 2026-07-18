import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { canViewObjectByScope } from '../objects/utils/object-access.util';

import { EmployeeAssignmentHistoryService } from './employee-assignment-history.service';
import { CreateEmployeeAvailabilityDto } from './dto/create-employee-availability.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { CreateEmployeeSubstitutionDto } from './dto/create-employee-substitution.dto';
import { AssignEmployeeToObjectDto } from './dto/assign-employee-to-object.dto';
import { ChangeEmployeeStatusDto } from './dto/change-employee-status.dto';
import {
  EmployeeListItemDto,
  EmployeeListResponseDto,
} from './dto/employee-list-item.dto';
import { EmployeeObjectOptionDto } from './dto/employee-object-option.dto';
import { EmployeeResponseDto } from './dto/employee-response.dto';
import { EmployeeVersionDto } from './dto/employee-version.dto';
import { ListEmployeesQueryDto } from './dto/list-employees-query.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import {
  EMPLOYEE_AVAILABILITY_MODES,
  EMPLOYEE_SUBSTITUTION_STATUSES,
} from './constants/employee-hr.constants';
import {
  canManageEmployeesHr,
  canViewEmployeesHr,
} from './utils/employee-hr-access.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  isActive: boolean;
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly assignmentHistoryService: EmployeeAssignmentHistoryService,
  ) {}

  async listEmployees(
    currentUser: CurrentAuthUser,
    query: ListEmployeesQueryDto,
  ): Promise<EmployeeListResponseDto> {
    this.assertViewAccess(currentUser);

    const page = query.page;
    const limit = query.limit;
    const offset = (page - 1) * limit;
    const conditions = this.buildEmployeeListConditions(query);
    const whereSql = conditions.length
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;
    const sortColumn = this.getEmployeeSortColumn(query.sortBy);
    const sortOrder = query.sortOrder === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;

    const { items, total } = await this.prisma.$transaction(async (tx) => {
      const [idRows, countRows] = await Promise.all([
        tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT employee."id"
          FROM "employees" employee
          ${whereSql}
          ORDER BY ${sortColumn} ${sortOrder} NULLS LAST, employee."id" ASC
          LIMIT ${limit}
          OFFSET ${offset}
        `),
        tx.$queryRaw<Array<{ total: number }>>(Prisma.sql`
          SELECT COUNT(*)::integer AS "total"
          FROM "employees" employee
          ${whereSql}
        `),
      ]);

      const ids = idRows.map((row) => row.id);
      const employees = ids.length
        ? await tx.employee.findMany({
            where: {
              id: { in: ids },
            },
            include: {
              objectAssignments: {
                where: {
                  isActive: true,
                  object: {
                    deletedAt: null,
                  },
                },
                select: {
                  object: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
                orderBy: {
                  object: {
                    name: 'asc',
                  },
                },
              },
            },
          })
        : [];
      const employeeById = new Map(employees.map((employee) => [employee.id, employee]));

      return {
        items: ids
          .map((id) => employeeById.get(id))
          .filter((employee): employee is NonNullable<typeof employee> => Boolean(employee))
          .map((employee): EmployeeListItemDto => ({
            id: employee.id,
            fullName: employee.fullName,
            phone: employee.phone,
            position: employee.position,
            birthDate: this.formatDateOnly(employee.birthDate),
            employmentStatus: employee.employmentStatus,
            baseDailyRate: employee.baseDailyRate,
            version: employee.version,
            isArchived: employee.deletedAt !== null,
            deletedAt: employee.deletedAt?.toISOString() ?? null,
            updatedAt: employee.updatedAt.toISOString(),
            currentObjects: employee.objectAssignments.map((assignment) => ({
              id: assignment.object.id,
              name: assignment.object.name,
            })),
            currentObjectCount: employee.objectAssignments.length,
          })),
        total: countRows[0]?.total ?? 0,
      };
    });

    return {
      items,
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async listObjectCandidates(
    currentUser: CurrentAuthUser,
  ): Promise<EmployeeObjectOptionDto[]> {
    this.assertManageAccess(currentUser);

    const objects = await this.prisma.object.findMany({
      where: {
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        status: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    return objects;
  }

  async getEmployeeById(
    currentUser: CurrentAuthUser,
    employeeId: string,
  ): Promise<EmployeeResponseDto> {
    this.assertViewAccess(currentUser);

    const employee = await this.prisma.employee.findUnique({
      where: {
        id: employeeId,
      },
      include: this.getEmployeeDetailInclude(),
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    return this.mapEmployee(employee, currentUser);
  }

  async createEmployee(
    currentUser: CurrentAuthUser,
    payload: CreateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    this.assertManageAccess(currentUser);
    const birthDate = this.parseBirthDate(payload.birthDate);

    const employeeId = await this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.create({
        data: {
          fullName: payload.fullName,
          phone: payload.phone ?? null,
          position: payload.position ?? null,
          birthDate,
          residenceAddress: payload.residenceAddress ?? null,
          shiftPreferences: payload.shiftPreferences ?? null,
          baseDailyRate: payload.baseDailyRate ?? null,
          notes: payload.notes ?? null,
          employmentStatus: payload.employmentStatus ?? 'active',
        },
      });

      await this.auditService.writeAuditEvent(
        {
          entityType: 'employee',
          entityId: employee.id,
          actorUserId: currentUser.id,
          action: 'employee.created',
          newValues: this.buildEmployeeAuditSnapshot(employee),
        },
        tx,
      );

      return employee.id;
    });

    return this.getEmployeeById(currentUser, employeeId);
  }

  async updateEmployee(
    currentUser: CurrentAuthUser,
    employeeId: string,
    payload: UpdateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    this.assertManageAccess(currentUser);
    const birthDate =
      payload.birthDate === undefined
        ? undefined
        : this.parseBirthDate(payload.birthDate);

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.employee.findUnique({
        where: { id: employeeId },
      });

      if (!existing || existing.deletedAt) {
        throw new NotFoundException('Employee not found');
      }

      if (existing.version !== payload.expectedVersion) {
        this.throwVersionConflict();
      }

      const result = await tx.employee.updateMany({
        where: {
          id: employeeId,
          version: payload.expectedVersion,
          deletedAt: null,
        },
        data: {
          ...(payload.fullName !== undefined ? { fullName: payload.fullName } : {}),
          ...(payload.phone !== undefined ? { phone: payload.phone } : {}),
          ...(payload.position !== undefined ? { position: payload.position } : {}),
          ...(birthDate !== undefined ? { birthDate } : {}),
          ...(payload.residenceAddress !== undefined
            ? { residenceAddress: payload.residenceAddress }
            : {}),
          ...(payload.shiftPreferences !== undefined
            ? { shiftPreferences: payload.shiftPreferences }
            : {}),
          ...(payload.baseDailyRate !== undefined
            ? { baseDailyRate: payload.baseDailyRate }
            : {}),
          ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
          ...(payload.employmentStatus !== undefined
            ? { employmentStatus: payload.employmentStatus }
            : {}),
          version: { increment: 1 },
        },
      });

      if (result.count !== 1) {
        this.throwVersionConflict();
      }

      const updated = await tx.employee.findUniqueOrThrow({
        where: { id: employeeId },
      });

      await this.auditService.writeAuditEvent(
        {
          entityType: 'employee',
          entityId: employeeId,
          actorUserId: currentUser.id,
          action: 'employee.updated',
          oldValues: this.buildEmployeeAuditSnapshot(existing),
          newValues: this.buildEmployeeAuditSnapshot(updated),
        },
        tx,
      );
    });

    return this.getEmployeeById(currentUser, employeeId);
  }

  async changeEmploymentStatus(
    currentUser: CurrentAuthUser,
    employeeId: string,
    payload: ChangeEmployeeStatusDto,
  ): Promise<EmployeeResponseDto> {
    return this.updateEmployee(currentUser, employeeId, payload);
  }

  async archiveEmployee(
    currentUser: CurrentAuthUser,
    employeeId: string,
    payload: EmployeeVersionDto,
  ): Promise<EmployeeResponseDto> {
    this.assertManageAccess(currentUser);

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "employees"
        WHERE "id" = ${employeeId}
        FOR UPDATE
      `;

      const existing = await tx.employee.findUnique({
        where: { id: employeeId },
      });

      if (!existing) {
        throw new NotFoundException('Employee not found');
      }

      if (existing.version !== payload.expectedVersion) {
        this.throwVersionConflict();
      }

      if (existing.deletedAt) {
        throw new ConflictException({
          code: 'EMPLOYEE_ALREADY_ARCHIVED',
          message: 'Employee is already archived',
        });
      }

      const activeAssignmentCount = await tx.objectEmployeeAssignment.count({
        where: {
          employeeId,
          isActive: true,
        },
      });

      if (activeAssignmentCount > 0) {
        throw new ConflictException({
          code: 'EMPLOYEE_HAS_ACTIVE_OBJECT_ASSIGNMENTS',
          message: 'Employee has active object assignments',
        });
      }

      const archivedAt = new Date();
      const result = await tx.employee.updateMany({
        where: {
          id: employeeId,
          version: payload.expectedVersion,
          deletedAt: null,
        },
        data: {
          deletedAt: archivedAt,
          version: { increment: 1 },
        },
      });

      if (result.count !== 1) {
        this.throwVersionConflict();
      }

      const archived = await tx.employee.findUniqueOrThrow({
        where: { id: employeeId },
      });

      await this.auditService.writeAuditEvent(
        {
          entityType: 'employee',
          entityId: employeeId,
          actorUserId: currentUser.id,
          action: 'employee.archived',
          oldValues: this.buildEmployeeAuditSnapshot(existing),
          newValues: this.buildEmployeeAuditSnapshot(archived),
        },
        tx,
      );
    });

    return this.getEmployeeById(currentUser, employeeId);
  }

  async restoreEmployee(
    currentUser: CurrentAuthUser,
    employeeId: string,
    payload: EmployeeVersionDto,
  ): Promise<EmployeeResponseDto> {
    this.assertManageAccess(currentUser);

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "employees"
        WHERE "id" = ${employeeId}
        FOR UPDATE
      `;

      const existing = await tx.employee.findUnique({
        where: { id: employeeId },
      });

      if (!existing) {
        throw new NotFoundException('Employee not found');
      }

      if (existing.version !== payload.expectedVersion) {
        this.throwVersionConflict();
      }

      if (!existing.deletedAt) {
        throw new ConflictException({
          code: 'EMPLOYEE_NOT_ARCHIVED',
          message: 'Employee is not archived',
        });
      }

      const result = await tx.employee.updateMany({
        where: {
          id: employeeId,
          version: payload.expectedVersion,
          deletedAt: { not: null },
        },
        data: {
          deletedAt: null,
          version: { increment: 1 },
        },
      });

      if (result.count !== 1) {
        this.throwVersionConflict();
      }

      const restored = await tx.employee.findUniqueOrThrow({
        where: { id: employeeId },
      });

      await this.auditService.writeAuditEvent(
        {
          entityType: 'employee',
          entityId: employeeId,
          actorUserId: currentUser.id,
          action: 'employee.restored',
          oldValues: this.buildEmployeeAuditSnapshot(existing),
          newValues: this.buildEmployeeAuditSnapshot(restored),
        },
        tx,
      );
    });

    return this.getEmployeeById(currentUser, employeeId);
  }

  async addAvailabilityWindow(
    currentUser: CurrentAuthUser,
    employeeId: string,
    payload: CreateEmployeeAvailabilityDto,
  ): Promise<EmployeeResponseDto> {
    this.assertManageAccess(currentUser);
    await this.ensureEmployeeExists(employeeId);

    const startDate = this.parseAvailabilityBoundary(
      payload.startDate,
      payload.availabilityMode,
      'start',
    );
    const endDate = payload.endDate
      ? this.parseAvailabilityBoundary(
          payload.endDate,
          payload.availabilityMode,
          'end',
        )
      : null;

    if (endDate && endDate < startDate) {
      throw new BadRequestException('Availability endDate must be after startDate');
    }

    await this.prisma.employeeAvailabilityWindow.create({
      data: {
        employeeId,
        startDate,
        endDate,
        availabilityMode: payload.availabilityMode,
        availabilityStatus: payload.availabilityStatus,
        comment: payload.comment?.trim() || null,
        createdByUserId: currentUser.id,
      },
    });

    return this.getEmployeeById(currentUser, employeeId);
  }

  async addSubstitution(
    currentUser: CurrentAuthUser,
    employeeId: string,
    payload: CreateEmployeeSubstitutionDto,
  ): Promise<EmployeeResponseDto> {
    this.assertManageAccess(currentUser);

    if (employeeId === payload.substituteEmployeeId) {
      throw new BadRequestException('Employee substitution requires different employees');
    }

    const [employee, substituteEmployee] = await Promise.all([
      this.ensureEmployeeExists(employeeId),
      this.ensureEmployeeExists(payload.substituteEmployeeId),
    ]);

    if (substituteEmployee.employmentStatus !== 'active') {
      throw new ForbiddenException('Substitute employee must be active');
    }

    if (payload.objectId) {
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
        throw new NotFoundException('Object for substitution not found');
      }
    }

    const startDate = new Date(payload.startDate);
    const endDate = payload.endDate ? new Date(payload.endDate) : null;

    if (endDate && endDate < startDate) {
      throw new BadRequestException('Substitution endDate must be after startDate');
    }

    await this.prisma.employeeSubstitution.create({
      data: {
        employeeId: employee.id,
        substituteEmployeeId: substituteEmployee.id,
        objectId: payload.objectId ?? null,
        startDate,
        endDate,
        status: payload.status ?? EMPLOYEE_SUBSTITUTION_STATUSES[0],
        reason: payload.reason.trim(),
        comment: payload.comment?.trim() || null,
        createdByUserId: currentUser.id,
      },
    });

    return this.getEmployeeById(currentUser, employeeId);
  }

  async assignEmployeeToObject(
    currentUser: CurrentAuthUser,
    employeeId: string,
    payload: AssignEmployeeToObjectDto,
  ): Promise<EmployeeResponseDto> {
    this.assertManageAccess(currentUser);

    const [employee, object] = await Promise.all([
      this.ensureEmployeeExists(employeeId),
      this.prisma.object.findFirst({
        where: {
          id: payload.objectId,
          deletedAt: null,
        },
        select: {
          id: true,
        },
      }),
    ]);

    if (employee.employmentStatus !== 'active') {
      throw new ForbiddenException('Only active employees can be assigned to object');
    }

    if (!object) {
      throw new NotFoundException('Object not found');
    }

    const startedAt = payload.startDate ? new Date(payload.startDate) : new Date();

    await this.prisma.objectEmployeeAssignment.upsert({
      where: {
        objectId_employeeId: {
          objectId: object.id,
          employeeId,
        },
      },
      update: {
        isActive: true,
        startDate: startedAt,
        endDate: null,
      },
      create: {
        objectId: object.id,
        employeeId,
        isActive: true,
        startDate: startedAt,
      },
    });

    await this.assignmentHistoryService.openObjectAssignmentHistory({
      employeeId,
      objectId: object.id,
      startedAt,
      actorUserId: currentUser.id,
    });

    return this.getEmployeeById(currentUser, employeeId);
  }

  async removeEmployeeFromObject(
    currentUser: CurrentAuthUser,
    employeeId: string,
    objectId: string,
  ): Promise<EmployeeResponseDto> {
    this.assertManageAccess(currentUser);
    await this.ensureEmployeeExists(employeeId);

    const endedAt = new Date();

    await this.prisma.objectEmployeeAssignment.updateMany({
      where: {
        objectId,
        employeeId,
      },
      data: {
        isActive: false,
        endDate: endedAt,
      },
    });

    await this.assignmentHistoryService.closeObjectAssignmentHistory({
      employeeId,
      objectId,
      endedAt,
      actorUserId: currentUser.id,
    });

    return this.getEmployeeById(currentUser, employeeId);
  }

  private buildEmployeeListConditions(query: ListEmployeesQueryDto): Prisma.Sql[] {
    const conditions: Prisma.Sql[] = [];

    if (query.archiveState === 'active') {
      conditions.push(Prisma.sql`employee."deletedAt" IS NULL`);
    } else if (query.archiveState === 'archived') {
      conditions.push(Prisma.sql`employee."deletedAt" IS NOT NULL`);
    }

    if (query.search) {
      const pattern = `%${query.search}%`;
      conditions.push(
        Prisma.sql`(
          employee."fullName" ILIKE ${pattern}
          OR COALESCE(employee."phone", '') ILIKE ${pattern}
        )`,
      );
    }

    if (query.objectId) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1
        FROM "object_employee_assignments" assignment
        INNER JOIN "objects" object ON object."id" = assignment."objectId"
        WHERE assignment."employeeId" = employee."id"
          AND assignment."objectId" = ${query.objectId}
          AND assignment."isActive" = true
          AND object."deletedAt" IS NULL
      )`);
    }

    if (query.position) {
      conditions.push(Prisma.sql`employee."position" ILIKE ${query.position}`);
    }

    if (query.employmentStatus) {
      conditions.push(
        Prisma.sql`employee."employmentStatus" = ${query.employmentStatus}`,
      );
    }

    if (query.birthMonth) {
      conditions.push(
        Prisma.sql`EXTRACT(MONTH FROM employee."birthDate") = ${query.birthMonth}`,
      );
    }

    if (query.hasActiveObjectAssignment !== undefined) {
      const activeAssignmentExists = Prisma.sql`EXISTS (
        SELECT 1
        FROM "object_employee_assignments" active_assignment
        INNER JOIN "objects" active_object
          ON active_object."id" = active_assignment."objectId"
        WHERE active_assignment."employeeId" = employee."id"
          AND active_assignment."isActive" = true
          AND active_object."deletedAt" IS NULL
      )`;
      conditions.push(
        query.hasActiveObjectAssignment
          ? activeAssignmentExists
          : Prisma.sql`NOT (${activeAssignmentExists})`,
      );
    }

    return conditions;
  }

  private getEmployeeSortColumn(
    sortBy: ListEmployeesQueryDto['sortBy'],
  ): Prisma.Sql {
    switch (sortBy) {
      case 'position':
        return Prisma.sql`employee."position"`;
      case 'employmentStatus':
        return Prisma.sql`employee."employmentStatus"`;
      case 'birthDate':
        return Prisma.sql`employee."birthDate"`;
      case 'createdAt':
        return Prisma.sql`employee."createdAt"`;
      case 'updatedAt':
        return Prisma.sql`employee."updatedAt"`;
      case 'fullName':
      default:
        return Prisma.sql`employee."fullName"`;
    }
  }

  private assertViewAccess(currentUser: CurrentAuthUser): void {
    if (!canViewEmployeesHr(this.getRoleCodes(currentUser))) {
      throw new ForbiddenException('Employees registry access denied');
    }
  }

  private assertManageAccess(currentUser: CurrentAuthUser): void {
    if (!canManageEmployeesHr(this.getRoleCodes(currentUser))) {
      throw new ForbiddenException('Employees registry management denied');
    }
  }

  private async ensureEmployeeExists(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: {
        id: employeeId,
        deletedAt: null,
      },
      select: {
        id: true,
        employmentStatus: true,
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    return employee;
  }

  private getRoleCodes(currentUser: CurrentAuthUser): string[] {
    if (currentUser.roleCodes && currentUser.roleCodes.length > 0) {
      return currentUser.roleCodes;
    }

    return currentUser.roleCode ? [currentUser.roleCode] : [];
  }

  private parseBirthDate(value: string | null | undefined): Date | null {
    if (!value) {
      return null;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException('birthDate must use YYYY-MM-DD format');
    }

    const parsed = new Date(`${value}T00:00:00.000Z`);

    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException('birthDate must be a valid calendar date');
    }

    const today = new Date();
    const todayDateOnly = Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate(),
    );

    if (parsed.getTime() > todayDateOnly) {
      throw new BadRequestException('birthDate cannot be in the future');
    }

    return parsed;
  }

  private formatDateOnly(value: Date | null): string | null {
    return value?.toISOString().slice(0, 10) ?? null;
  }

  private throwVersionConflict(): never {
    throw new ConflictException({
      code: 'EMPLOYEE_VERSION_CONFLICT',
      message: 'Employee was changed by another user',
    });
  }

  private buildEmployeeAuditSnapshot(employee: {
    fullName: string;
    phone: string | null;
    position: string | null;
    birthDate: Date | null;
    residenceAddress: string | null;
    shiftPreferences: string | null;
    baseDailyRate: number | null;
    notes: string | null;
    employmentStatus: string;
    version: number;
    deletedAt: Date | null;
  }): Prisma.InputJsonValue {
    return {
      fullName: employee.fullName,
      phone: employee.phone,
      position: employee.position,
      birthDate: this.formatDateOnly(employee.birthDate),
      residenceAddress: employee.residenceAddress,
      shiftPreferences: employee.shiftPreferences,
      baseDailyRate: employee.baseDailyRate,
      notes: employee.notes,
      employmentStatus: employee.employmentStatus,
      version: employee.version,
      deletedAt: employee.deletedAt?.toISOString() ?? null,
    };
  }

  private getEmployeeDetailInclude() {
    return {
      objectAssignments: {
        where: {
          object: {
            deletedAt: null,
          },
        },
        include: {
          object: {
            select: this.getObjectVisibilitySelect(),
          },
        },
        orderBy: {
          updatedAt: 'desc' as const,
        },
      },
      objectAssignmentHistory: {
        include: {
          object: {
            select: this.getObjectVisibilitySelect(),
          },
        },
        orderBy: {
          startedAt: 'desc' as const,
        },
      },
      availabilityWindows: {
        orderBy: {
          startDate: 'desc' as const,
        },
      },
      substitutionsAsPrimary: {
        include: {
          substituteEmployee: {
            select: {
              id: true,
              fullName: true,
            },
          },
          object: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          startDate: 'desc' as const,
        },
      },
      substitutionsAsReplacement: {
        include: {
          employee: {
            select: {
              id: true,
              fullName: true,
            },
          },
          object: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          startDate: 'desc' as const,
        },
      },
    };
  }

  private getObjectVisibilitySelect() {
    return {
      id: true,
      name: true,
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
    };
  }

  private canOpenObjectCard(
    currentUser: CurrentAuthUser,
    object: {
      createdByUserId: string;
      assignments: Array<{
        userId: string;
        isActive?: boolean;
      }>;
    },
  ): boolean {
    return canViewObjectByScope({
      currentUserId: currentUser.id,
      roleCodes: this.getRoleCodes(currentUser),
      object,
    });
  }

  private parseAvailabilityBoundary(
    rawValue: string,
    mode: (typeof EMPLOYEE_AVAILABILITY_MODES)[number],
    boundary: 'start' | 'end',
  ): Date {
    if (mode === 'timed') {
      return new Date(rawValue);
    }

    const [year, month, day] = rawValue.split('-').map((part) => Number(part));

    if (!year || !month || !day) {
      throw new BadRequestException('Invalid full-day availability date');
    }

    if (boundary === 'start') {
      return new Date(year, month - 1, day, 0, 0, 0, 0);
    }

    return new Date(year, month - 1, day, 23, 59, 59, 999);
  }

  private mapEmployee(
    employee: {
      id: string;
      fullName: string;
      phone: string | null;
      position: string | null;
      birthDate: Date | null;
      residenceAddress: string | null;
      shiftPreferences: string | null;
      baseDailyRate: number | null;
      notes: string | null;
      employmentStatus: string;
      version: number;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
      objectAssignments: Array<{
        isActive: boolean;
        startDate: Date | null;
        endDate: Date | null;
        object: {
          id: string;
          name: string;
          createdByUserId: string;
          assignments: Array<{
            userId: string;
            isActive: boolean;
          }>;
        };
      }>;
      objectAssignmentHistory: Array<{
        id: string;
        startedAt: Date;
        endedAt: Date | null;
        object: {
          id: string;
          name: string;
          createdByUserId: string;
          assignments: Array<{
            userId: string;
            isActive: boolean;
          }>;
        };
      }>;
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
        object: { id: string; name: string } | null;
        substituteEmployee: { id: string; fullName: string };
      }>;
      substitutionsAsReplacement: Array<{
        id: string;
        startDate: Date;
        endDate: Date | null;
        status: string;
        reason: string;
        comment: string | null;
        object: { id: string; name: string } | null;
        employee: { id: string; fullName: string };
      }>;
    },
    currentUser: CurrentAuthUser,
  ): EmployeeResponseDto {
    const canManage = canManageEmployeesHr(this.getRoleCodes(currentUser));

    return {
      id: employee.id,
      fullName: employee.fullName,
      phone: employee.phone,
      position: employee.position,
      birthDate: this.formatDateOnly(employee.birthDate),
      residenceAddress: employee.residenceAddress,
      shiftPreferences: employee.shiftPreferences,
      baseDailyRate: employee.baseDailyRate,
      notes: employee.notes,
      employmentStatus: employee.employmentStatus,
      version: employee.version,
      isArchived: employee.deletedAt !== null,
      deletedAt: employee.deletedAt?.toISOString() ?? null,
      createdAt: employee.createdAt.toISOString(),
      updatedAt: employee.updatedAt.toISOString(),
      currentObjectAssignments: employee.objectAssignments
        .filter((assignment) => assignment.isActive)
        .map((assignment) => ({
          objectId: assignment.object.id,
          objectName: assignment.object.name,
          startDate: assignment.startDate?.toISOString() ?? null,
          endDate: assignment.endDate?.toISOString() ?? null,
          canOpenObjectCard: this.canOpenObjectCard(currentUser, assignment.object),
        })),
      objectAssignmentHistory: employee.objectAssignmentHistory.map((item) => ({
        id: item.id,
        objectId: item.object.id,
        objectName: item.object.name,
        startedAt: item.startedAt.toISOString(),
        endedAt: item.endedAt?.toISOString() ?? null,
        canOpenObjectCard: this.canOpenObjectCard(currentUser, item.object),
      })),
      availabilityWindows: employee.availabilityWindows.map((item) => ({
        id: item.id,
        startDate: item.startDate.toISOString(),
        endDate: item.endDate?.toISOString() ?? null,
        availabilityMode: item.availabilityMode,
        availabilityStatus: item.availabilityStatus,
        comment: item.comment,
      })),
      substitutions: [
        ...employee.substitutionsAsPrimary.map((item) => ({
          id: item.id,
          role: 'primary' as const,
          counterpartEmployeeId: item.substituteEmployee.id,
          counterpartEmployeeName: item.substituteEmployee.fullName,
          objectId: item.object?.id ?? null,
          objectName: item.object?.name ?? null,
          startDate: item.startDate.toISOString(),
          endDate: item.endDate?.toISOString() ?? null,
          status: item.status,
          reason: item.reason,
          comment: item.comment,
        })),
        ...employee.substitutionsAsReplacement.map((item) => ({
          id: item.id,
          role: 'replacement' as const,
          counterpartEmployeeId: item.employee.id,
          counterpartEmployeeName: item.employee.fullName,
          objectId: item.object?.id ?? null,
          objectName: item.object?.name ?? null,
          startDate: item.startDate.toISOString(),
          endDate: item.endDate?.toISOString() ?? null,
          status: item.status,
          reason: item.reason,
          comment: item.comment,
        })),
      ].sort((left, right) => (left.startDate < right.startDate ? 1 : -1)),
      capabilities: {
        canEdit: canManage && employee.deletedAt === null,
        canArchive: canManage && employee.deletedAt === null,
        canRestore: canManage && employee.deletedAt !== null,
        canManageStatus: canManage && employee.deletedAt === null,
        canManageAvailability: canManage && employee.deletedAt === null,
        canManageSubstitutions: canManage && employee.deletedAt === null,
        canManageAssignments: canManage && employee.deletedAt === null,
      },
    };
  }
}
