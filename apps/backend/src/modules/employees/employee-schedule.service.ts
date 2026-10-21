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

import {
  UpdateEmployeeAvailabilityDto,
  UpdateEmployeeSubstitutionDto,
} from './dto/update-employee-schedule.dto';
import { canEditEmployee } from './utils/employee-hr-access.util';

interface ScheduleActor {
  id: string;
  permissionCodes?: string[];
}

type Client = Prisma.TransactionClient | PrismaService;

/** Substitutions that still occupy people; completed/cancelled ones never conflict. */
const OPEN_SUBSTITUTION_STATUSES = ['planned', 'active'];

function overlapWhere(startDate: Date, endDate: Date | null) {
  return {
    startDate: endDate ? { lte: endDate } : undefined,
    OR: [{ endDate: null }, { endDate: { gte: startDate } }],
  };
}

/**
 * Availability windows and substitutions of an employee card. Attendance facts and
 * object staffing are never changed here.
 */
@Injectable()
export class EmployeeScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  assertCanManage(actor: ScheduleActor): void {
    if (!canEditEmployee(actor.permissionCodes ?? [])) {
      throw new ForbiddenException('Employee schedule access denied');
    }
  }

  /**
   * Rejects a substitution that would put somebody in two places at once:
   * the substitute is unavailable, is already substituting, or is being replaced
   * themselves; or the employee already has an open substitution for the same object.
   */
  async assertSubstitutionIsFree(
    params: {
      employeeId: string;
      substituteEmployeeId: string;
      objectId: string | null;
      startDate: Date;
      endDate: Date | null;
      ignoreSubstitutionId?: string;
    },
    client: Client = this.prisma,
  ): Promise<void> {
    const period = overlapWhere(params.startDate, params.endDate);
    const notSelf = params.ignoreSubstitutionId ? { id: { not: params.ignoreSubstitutionId } } : {};

    const [unavailable, substituteBusy, substituteReplaced, sameSlot] = await Promise.all([
      client.employeeAvailabilityWindow.findFirst({
        where: { employeeId: params.substituteEmployeeId, availabilityStatus: 'unavailable', ...period },
        select: { id: true },
      }),
      client.employeeSubstitution.findFirst({
        where: {
          substituteEmployeeId: params.substituteEmployeeId,
          status: { in: OPEN_SUBSTITUTION_STATUSES },
          ...period,
          ...notSelf,
        },
        select: { employee: { select: { fullName: true } } },
      }),
      client.employeeSubstitution.findFirst({
        where: {
          employeeId: params.substituteEmployeeId,
          status: { in: OPEN_SUBSTITUTION_STATUSES },
          ...period,
          ...notSelf,
        },
        select: { id: true },
      }),
      client.employeeSubstitution.findFirst({
        where: {
          employeeId: params.employeeId,
          objectId: params.objectId,
          status: { in: OPEN_SUBSTITUTION_STATUSES },
          ...period,
          ...notSelf,
        },
        select: { substituteEmployee: { select: { fullName: true } } },
      }),
    ]);

    if (unavailable || substituteReplaced) {
      throw new ConflictException({
        code: 'SUBSTITUTE_UNAVAILABLE',
        message: 'Заменяющий сотрудник в эти дни недоступен.',
      });
    }
    if (substituteBusy) {
      throw new ConflictException({
        code: 'SUBSTITUTE_BUSY',
        message: `В эти дни заменяющий сотрудник уже подменяет: ${substituteBusy.employee.fullName}.`,
      });
    }
    if (sameSlot) {
      throw new ConflictException({
        code: 'SUBSTITUTION_OVERLAP',
        message: `На этот период уже назначена подмена: ${sameSlot.substituteEmployee.fullName}.`,
      });
    }
  }

  async updateSubstitution(
    actor: ScheduleActor,
    employeeId: string,
    substitutionId: string,
    payload: UpdateEmployeeSubstitutionDto,
  ): Promise<void> {
    this.assertCanManage(actor);
    if (payload.status === undefined && payload.endDate === undefined) {
      throw new BadRequestException('Nothing to update');
    }

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.employeeSubstitution.findFirst({
        where: {
          id: substitutionId,
          OR: [{ employeeId }, { substituteEmployeeId: employeeId }],
        },
      });
      if (!existing) throw new NotFoundException('Substitution not found');

      const endDate = payload.endDate ? new Date(payload.endDate) : existing.endDate;
      if (endDate && endDate < existing.startDate) {
        throw new BadRequestException({
          code: 'SUBSTITUTION_END_BEFORE_START',
          message: 'Окончание подмены раньше её начала.',
        });
      }
      const status = payload.status ?? existing.status;
      const reopens = OPEN_SUBSTITUTION_STATUSES.includes(status) &&
        !OPEN_SUBSTITUTION_STATUSES.includes(existing.status);
      if (reopens) {
        await this.assertSubstitutionIsFree({
          employeeId: existing.employeeId,
          substituteEmployeeId: existing.substituteEmployeeId,
          objectId: existing.objectId,
          startDate: existing.startDate,
          endDate,
          ignoreSubstitutionId: existing.id,
        }, tx);
      }

      const updated = await tx.employeeSubstitution.update({
        where: { id: existing.id },
        data: { status, endDate },
      });
      await this.auditService.writeAuditEvent({
        entityType: 'employee',
        entityId: existing.employeeId,
        actorUserId: actor.id,
        action: 'employee.substitution.updated',
        oldValues: { substitutionId: existing.id, status: existing.status, endDate: existing.endDate?.toISOString() ?? null },
        newValues: { substitutionId: updated.id, status: updated.status, endDate: updated.endDate?.toISOString() ?? null },
      }, tx);
    });
  }

  async updateAvailability(
    actor: ScheduleActor,
    employeeId: string,
    windowId: string,
    payload: UpdateEmployeeAvailabilityDto,
  ): Promise<void> {
    this.assertCanManage(actor);
    const existing = await this.findWindow(employeeId, windowId);
    const endDate = this.parseBoundary(payload.endDate, existing.availabilityMode);
    if (endDate < existing.startDate) {
      throw new BadRequestException({
        code: 'AVAILABILITY_END_BEFORE_START',
        message: 'Дата окончания раньше даты начала.',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.employeeAvailabilityWindow.update({ where: { id: existing.id }, data: { endDate } });
      await this.auditService.writeAuditEvent({
        entityType: 'employee',
        entityId: employeeId,
        actorUserId: actor.id,
        action: 'employee.availability.updated',
        oldValues: { windowId: existing.id, endDate: existing.endDate?.toISOString() ?? null },
        newValues: { windowId: existing.id, endDate: endDate.toISOString() },
      }, tx);
    });
  }

  /** Removes an erroneously entered window; the audit keeps its snapshot. */
  async deleteAvailability(actor: ScheduleActor, employeeId: string, windowId: string): Promise<void> {
    this.assertCanManage(actor);
    const existing = await this.findWindow(employeeId, windowId);

    await this.prisma.$transaction(async (tx) => {
      await tx.employeeAvailabilityWindow.delete({ where: { id: existing.id } });
      await this.auditService.writeAuditEvent({
        entityType: 'employee',
        entityId: employeeId,
        actorUserId: actor.id,
        action: 'employee.availability.deleted',
        oldValues: {
          windowId: existing.id,
          startDate: existing.startDate.toISOString(),
          endDate: existing.endDate?.toISOString() ?? null,
          availabilityMode: existing.availabilityMode,
          availabilityStatus: existing.availabilityStatus,
          comment: existing.comment,
        },
      }, tx);
    });
  }

  private async findWindow(employeeId: string, windowId: string) {
    const existing = await this.prisma.employeeAvailabilityWindow.findFirst({
      where: { id: windowId, employeeId },
    });
    if (!existing) throw new NotFoundException('Availability window not found');
    return existing;
  }

  private parseBoundary(rawValue: string, mode: string): Date {
    if (mode === 'timed') return new Date(rawValue);
    const [year, month, day] = rawValue.slice(0, 10).split('-').map(Number);
    if (!year || !month || !day) throw new BadRequestException('Invalid date');
    return new Date(year, month - 1, day, 23, 59, 59, 999);
  }
}
