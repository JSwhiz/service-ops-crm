import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { canViewObjectByScope } from '../objects/utils/object-access.util';

import { EmployeeAssignmentHistoryService } from './employee-assignment-history.service';
import { CreateEmployeeAvailabilityDto } from './dto/create-employee-availability.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { CreateEmployeeSubstitutionDto } from './dto/create-employee-substitution.dto';
import { AssignEmployeeToObjectDto } from './dto/assign-employee-to-object.dto';
import { ChangeEmployeeStatusDto } from './dto/change-employee-status.dto';
import { EmployeeListItemDto } from './dto/employee-list-item.dto';
import { EmployeeObjectOptionDto } from './dto/employee-object-option.dto';
import { EmployeeResponseDto } from './dto/employee-response.dto';
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
    private readonly assignmentHistoryService: EmployeeAssignmentHistoryService,
  ) {}

  async listEmployees(
    currentUser: CurrentAuthUser,
    query: ListEmployeesQueryDto,
  ): Promise<EmployeeListItemDto[]> {
    this.assertViewAccess(currentUser);

    const items = await this.prisma.employee.findMany({
      where: {
        deletedAt: null,
        ...(query.employmentStatus
          ? { employmentStatus: query.employmentStatus }
          : {}),
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
        objectAssignments: {
          where: {
            isActive: true,
            object: {
              deletedAt: null,
            },
          },
          select: {
            id: true,
          },
        },
      },
      orderBy: {
        fullName: 'asc',
      },
    });

    return items.map((item) => ({
      id: item.id,
      fullName: item.fullName,
      phone: item.phone ?? null,
      employmentStatus: item.employmentStatus,
      baseDailyRate: item.baseDailyRate ?? null,
      currentObjectCount: item.objectAssignments.length,
    }));
  }

  async listObjectCandidates(
    currentUser: CurrentAuthUser,
  ): Promise<EmployeeObjectOptionDto[]> {
    this.assertViewAccess(currentUser);

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

    const employee = await this.prisma.employee.findFirst({
      where: {
        id: employeeId,
        deletedAt: null,
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

    const employee = await this.prisma.employee.create({
      data: {
        fullName: payload.fullName.trim(),
        phone: payload.phone?.trim() || null,
        residenceAddress: payload.residenceAddress?.trim() || null,
        shiftPreferences: payload.shiftPreferences?.trim() || null,
        baseDailyRate: payload.baseDailyRate ?? null,
        notes: payload.notes?.trim() || null,
        employmentStatus: payload.employmentStatus ?? 'active',
      },
      select: {
        id: true,
      },
    });

    return this.getEmployeeById(currentUser, employee.id);
  }

  async updateEmployee(
    currentUser: CurrentAuthUser,
    employeeId: string,
    payload: UpdateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    this.assertManageAccess(currentUser);
    await this.ensureEmployeeExists(employeeId);

    await this.prisma.employee.update({
      where: {
        id: employeeId,
      },
      data: {
        ...(payload.fullName !== undefined
          ? { fullName: payload.fullName.trim() }
          : {}),
        ...(payload.phone !== undefined
          ? { phone: payload.phone.trim() || null }
          : {}),
        ...(payload.residenceAddress !== undefined
          ? { residenceAddress: payload.residenceAddress.trim() || null }
          : {}),
        ...(payload.shiftPreferences !== undefined
          ? { shiftPreferences: payload.shiftPreferences.trim() || null }
          : {}),
        ...(payload.baseDailyRate !== undefined
          ? { baseDailyRate: payload.baseDailyRate }
          : {}),
        ...(payload.notes !== undefined
          ? { notes: payload.notes.trim() || null }
          : {}),
      },
    });

    return this.getEmployeeById(currentUser, employeeId);
  }

  async changeEmploymentStatus(
    currentUser: CurrentAuthUser,
    employeeId: string,
    payload: ChangeEmployeeStatusDto,
  ): Promise<EmployeeResponseDto> {
    this.assertManageAccess(currentUser);
    await this.ensureEmployeeExists(employeeId);

    await this.prisma.employee.update({
      where: {
        id: employeeId,
      },
      data: {
        employmentStatus: payload.employmentStatus,
      },
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
      residenceAddress: string | null;
      shiftPreferences: string | null;
      baseDailyRate: number | null;
      notes: string | null;
      employmentStatus: string;
      createdAt: Date;
      updatedAt: Date;
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
      residenceAddress: employee.residenceAddress,
      shiftPreferences: employee.shiftPreferences,
      baseDailyRate: employee.baseDailyRate,
      notes: employee.notes,
      employmentStatus: employee.employmentStatus,
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
        canEdit: canManage,
        canManageStatus: canManage,
        canManageAvailability: canManage,
        canManageSubstitutions: canManage,
        canManageAssignments: canManage,
      },
    };
  }
}
