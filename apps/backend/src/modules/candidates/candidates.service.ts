import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Candidate, CandidateManagerAssignment, Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { canCreateEmployee, canViewEmployeesHr } from '../employees/utils/employee-hr-access.util';
import { canViewObjectBasicProfile } from '../objects/utils/object-access.util';
import { PrismaService } from '../prisma/prisma.service';

import { CANDIDATE_MANAGER_ROLE_CODES, CANDIDATE_RESPONSE_SLA_MS } from './constants/candidate.constants';
import { CandidateAssignmentResponseDto, CandidateCardResponseDto, CandidateListItemDto, CandidateListResponseDto, CandidateResponseItemDto } from './dto/candidate-response.dto';
import { AssignCandidateManagerDto, CandidateManagerSelectionDto, CandidateVersionDto, ChangeCandidateStatusDto, ConvertCandidateToEmployeeDto, CreateCandidateDto, CreateCandidateResponseDto, UpdateCandidateDto } from './dto/candidate-mutations.dto';
import { ListCandidateManagersQueryDto, ListCandidatesQueryDto } from './dto/list-candidates-query.dto';
import { buildCandidateAccessWhere, canManageCandidates, canRespondToCandidates, canViewCandidates } from './utils/candidate-access.util';
import { candidatePhoneSearchDigits } from './utils/candidate-phone.util';

interface CurrentAuthUser {
  id: string;
  roleCode?: string;
  roleCodes?: string[];
  permissionCodes?: string[];
}
const userSelect = { id: true, login: true, fullName: true } as const;
const objectSelect = { id: true, name: true, internalName: true, address: true } as const;
const assignmentInclude = { manager: { select: userSelect }, assignedBy: { select: userSelect }, endedBy: { select: userSelect }, object: { select: objectSelect } } as const;

type CandidateAssignmentView = CandidateManagerAssignment & {
  object: { id: string; name: string; internalName: string | null; address: string } | null;
  manager: { id: string; login: string; fullName: string };
  assignedBy: { id: string; login: string; fullName: string };
  endedBy: { id: string; login: string; fullName: string } | null;
};

type CandidateFeedbackView = {
  id: string;
  assignmentId: string | null;
  authorUserId: string;
  text: string;
  createdAt: Date;
  author: { id: string; login: string; fullName: string };
};

type CandidateListView = Candidate & {
  object: {
    id: string;
    name: string;
    internalName: string | null;
    address: string;
  } | null;
  assignments: CandidateAssignmentView[];
  responses: CandidateFeedbackView[];
};

const CLOSED_CANDIDATE_STATUSES: string[] = ['accepted', 'rejected'];

@Injectable()
export class CandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async list(currentUser: CurrentAuthUser, query: ListCandidatesQueryDto): Promise<CandidateListResponseDto> {
    this.assertView(currentUser);
    const now = new Date();
    const scope = query.scope ?? (canManageCandidates(this.permissions(currentUser)) ? 'all' : 'mine');
    const where: Prisma.CandidateWhereInput = { AND: [
      this.buildWhere(query, now), buildCandidateAccessWhere(currentUser),
      ...(scope === 'mine' ? [{ assignments: { some: { managerUserId: currentUser.id, endedAt: null } } }] : []),
    ] };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.candidate.findMany({
        where,
        include: {
          object: {
            select: { id: true, name: true, internalName: true, address: true },
          },
          assignments: {
            include: assignmentInclude,
            orderBy: { assignedAt: 'desc' },
            where: { endedAt: null },
          },
          responses: {
            include: { author: { select: userSelect } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
          },
        },
        orderBy: [{ [query.sort]: query.sortDirection }, { id: query.sortDirection }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.candidate.count({ where }),
    ]);
    return {
      items: items.map((candidate) => this.mapListItem(candidate, now)),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async listManagers(currentUser: CurrentAuthUser, query: ListCandidateManagersQueryDto) {
    this.assertView(currentUser);
    return this.prisma.user.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        roles: { some: { role: { code: { in: [...CANDIDATE_MANAGER_ROLE_CODES] } } } },
        permissions: { none: { permission: { code: 'candidates.denied' } } },
        ...(query.selectedId ? { id: query.selectedId } : {}),
        ...(query.q ? { OR: [{ fullName: { contains: query.q, mode: 'insensitive' } }, { login: { contains: query.q, mode: 'insensitive' } }] } : {}),
      },
      select: userSelect,
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      take: 30,
    });
  }

  async getById(currentUser: CurrentAuthUser, id: string): Promise<CandidateCardResponseDto> {
    this.assertView(currentUser);
    const candidate = await this.prisma.candidate.findFirst({
      where: { id, ...buildCandidateAccessWhere(currentUser) },
      include: {
        createdBy: { select: userSelect },
        object: {
          select: { id: true, name: true, internalName: true, address: true },
        },
        assignments: { include: assignmentInclude, orderBy: { assignedAt: 'desc' } },
        responses: { include: { author: { select: userSelect } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!candidate) throw new NotFoundException('Candidate not found');
    return {
      ...this.mapListItem(candidate, new Date()),
      comment: candidate.comment,
      createdBy: candidate.createdBy,
      createdAt: candidate.createdAt.toISOString(),
      assignments: candidate.assignments.map((item) => this.mapAssignment(item)),
      responses: candidate.responses.map((item) => this.mapResponse(item)),
      capabilities: {
        canManage: canManageCandidates(this.permissions(currentUser)),
        canRespond:
          canRespondToCandidates(this.permissions(currentUser)) &&
          (canManageCandidates(this.permissions(currentUser)) || candidate.assignments.some((assignment) => !assignment.endedAt && assignment.managerUserId === currentUser.id)) &&
          !candidate.deletedAt &&
          (canManageCandidates(this.permissions(currentUser)) || !['accepted', 'rejected'].includes(candidate.status)),
        canArchive: canManageCandidates(this.permissions(currentUser)) && !candidate.deletedAt,
        canRestore: canManageCandidates(this.permissions(currentUser)) && Boolean(candidate.deletedAt),
        canConvert: canManageCandidates(this.permissions(currentUser)) && canCreateEmployee(this.permissions(currentUser)) && !candidate.deletedAt && !candidate.employeeId && candidate.status !== 'rejected',
        canViewEmployee: canViewEmployeesHr(this.permissions(currentUser)),
      },
    };
  }

  async create(currentUser: CurrentAuthUser, payload: CreateCandidateDto): Promise<CandidateCardResponseDto> {
    this.assertManage(currentUser);

    if (payload.candidateType === 'regular' && !payload.objectId) {
      throw new BadRequestException('Regular candidate requires object');
    }
    const selections = this.managerSelections(payload, payload.objectId ?? null);
    const phones = this.normalizePhones(payload.phones ?? [payload.phone ?? '']);
    if (payload.candidateType === 'regular' && selections.length === 0) {
      throw new BadRequestException('Regular candidate requires manager');
    }

    const candidate = await this.prisma.$transaction(async (tx) => {
      if (payload.objectId) {
        await this.assertCandidateObjectAvailable(tx, currentUser, payload.objectId);
      }
      for (const selection of selections) {
        await this.loadEligibleManager(tx, selection.managerUserId);
        if (selection.objectId) await this.assertCandidateObjectAvailable(tx, currentUser, selection.objectId);
      }

      const created = await tx.candidate.create({
        data: {
          fullName: payload.fullName,
          phone: phones[0],
          phones,
          phoneSearchText: this.phoneSearchText(phones),
          comment: payload.comment || null,
          candidateType: payload.candidateType,
          objectId: payload.objectId ?? null,
          createdByUserId: currentUser.id,
        },
      });

      await this.auditService.writeAuditEvent({
        entityType: 'candidate',
        entityId: created.id,
        actorUserId: currentUser.id,
        action: 'candidate.created',
        newValues: this.snapshot(created),
      }, tx);

      for (const selection of selections) {
        const assignedAt = new Date();
        const assignment = await tx.candidateManagerAssignment.create({
          data: {
            candidateId: created.id,
            managerUserId: selection.managerUserId,
            objectId: selection.objectId,
            assignedByUserId: currentUser.id,
            assignedAt,
            responseDueAt: new Date(
              assignedAt.getTime() + CANDIDATE_RESPONSE_SLA_MS,
            ),
          },
        });

        await this.notificationsService.create({
          recipientUserId: selection.managerUserId,
          type: 'candidate.assigned',
          title: `Назначен кандидат ${created.fullName}`,
          entityType: 'candidate',
          entityId: created.id,
          targetUrl: `/candidates/${created.id}`,
          dedupeKey: `candidate:${created.id}:assignment:${assignment.id}:assigned`,
        }, tx);

        await this.auditService.writeAuditEvent({
          entityType: 'candidate',
          entityId: created.id,
          actorUserId: currentUser.id,
          action: 'candidate.manager_assigned',
          newValues: {
            managerUserId: selection.managerUserId,
            objectId: selection.objectId,
            assignmentId: assignment.id,
          },
        }, tx);
      }

      const hrUserIds = await this.notificationsService.listActiveUserIdsByRoles(
        ['hr'],
        tx,
      );
      await this.notificationsService.createForRecipients({
        recipientUserIds: hrUserIds.filter((userId) => userId !== currentUser.id),
        type: 'candidate.created',
        title: 'Добавлен новый кандидат',
        body: created.fullName,
        entityType: 'candidate',
        entityId: created.id,
        targetUrl: `/candidates/${encodeURIComponent(created.id)}`,
        dedupeKey: `candidate:${created.id}:created`,
      }, tx);

      if (created.objectId) {
        await this.auditService.writeAuditEvent({
          entityType: 'candidate',
          entityId: created.id,
          actorUserId: currentUser.id,
          action: 'candidate.object_linked',
          newValues: { objectId: created.objectId },
        }, tx);
      }

      return created;
    });

    return this.getById(currentUser, candidate.id);
  }

  async update(currentUser: CurrentAuthUser, id: string, payload: UpdateCandidateDto): Promise<CandidateCardResponseDto> {
    this.assertManage(currentUser);
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.lockCandidate(tx, id);
      this.assertVersion(existing, payload.expectedVersion);

      const nextCandidateType = payload.candidateType ?? existing.candidateType;
      const nextObjectId =
        payload.objectId !== undefined ? payload.objectId : existing.objectId;

      if (nextCandidateType === 'regular' && !nextObjectId) {
        throw new BadRequestException('Для обычного кандидата укажите объект.');
      }
      if (payload.objectId) {
        await this.assertCandidateObjectAvailable(tx, currentUser, payload.objectId);
      }
      if (nextCandidateType === 'regular' && !CLOSED_CANDIDATE_STATUSES.includes(existing.status)) {
        const activeAssignment = await tx.candidateManagerAssignment.findFirst({
          where: { candidateId: id, endedAt: null },
          select: { id: true },
        });
        if (!activeAssignment) {
          throw new BadRequestException({ code: 'CANDIDATE_MANAGER_REQUIRED', message: 'Назначьте хотя бы одного ответственного менеджера.' });
        }
      }

      const result = await tx.candidate.updateMany({
        where: { id, version: payload.expectedVersion },
        data: {
          ...(payload.fullName !== undefined ? { fullName: payload.fullName } : {}),
          ...(payload.phones !== undefined || payload.phone !== undefined ? this.phoneData(payload.phones ?? [payload.phone ?? '']) : {}),
          ...(payload.comment !== undefined ? { comment: payload.comment || null } : {}),
          ...(payload.candidateType !== undefined ? { candidateType: payload.candidateType } : {}),
          ...(payload.objectId !== undefined ? { objectId: payload.objectId } : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) this.versionConflict();

      const updated = await tx.candidate.findUniqueOrThrow({ where: { id } });
      await this.auditService.writeAuditEvent({
        entityType: 'candidate',
        entityId: id,
        actorUserId: currentUser.id,
        action:
          existing.objectId !== updated.objectId
            ? 'candidate.object_changed'
            : 'candidate.updated',
        oldValues: this.snapshot(existing),
        newValues: this.snapshot(updated),
      }, tx);
    });
    return this.getById(currentUser, id);
  }

  async changeStatus(currentUser: CurrentAuthUser, id: string, payload: ChangeCandidateStatusDto): Promise<CandidateCardResponseDto> {
    this.assertManage(currentUser);
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.lockCandidate(tx, id);
      this.assertVersion(existing, payload.expectedVersion);
      if (existing.status === payload.status) return;
      const closing = CLOSED_CANDIDATE_STATUSES.includes(payload.status);
      const reopening = !closing && CLOSED_CANDIDATE_STATUSES.includes(existing.status);
      const selections = reopening && payload.assignments?.length
        ? this.managerSelections({ assignments: payload.assignments }, existing.objectId)
        : [];
      if (reopening && existing.candidateType === 'regular' && !selections.length) {
        const active = await tx.candidateManagerAssignment.count({ where: { candidateId: id, endedAt: null } });
        if (!active) {
          throw new BadRequestException({
            code: 'CANDIDATE_MANAGER_REQUIRED',
            message: 'Чтобы вернуть кандидата в работу, назначьте ответственного менеджера.',
          });
        }
      }
      await tx.candidate.update({ where: { id }, data: { status: payload.status, version: { increment: 1 } } });
      if (closing) {
        await tx.candidateManagerAssignment.updateMany({ where: { candidateId: id, endedAt: null }, data: { endedAt: new Date(), endedByUserId: currentUser.id } });
      }
      if (selections.length) {
        await this.openManagerAssignments(tx, currentUser, existing, selections);
      }
      await this.auditService.writeAuditEvent({
        entityType: 'candidate', entityId: id, actorUserId: currentUser.id, action: 'candidate.status_changed',
        oldValues: { status: existing.status },
        newValues: { status: payload.status, ...(selections.length ? { managers: selections } : {}) },
      }, tx);
    });
    return this.getById(currentUser, id);
  }

  /** Validates and opens new manager assignments with their own SLA and notification. */
  private async openManagerAssignments(
    tx: Prisma.TransactionClient,
    currentUser: CurrentAuthUser,
    candidate: Candidate,
    selections: Array<{ managerUserId: string; objectId: string | null }>,
  ): Promise<void> {
    const now = new Date();
    for (const selection of selections) {
      await this.loadEligibleManager(tx, selection.managerUserId);
      if (selection.objectId) await this.assertCandidateObjectAvailable(tx, currentUser, selection.objectId);
      const created = await tx.candidateManagerAssignment.create({ data: {
        candidateId: candidate.id, managerUserId: selection.managerUserId, objectId: selection.objectId,
        assignedByUserId: currentUser.id, assignedAt: now,
        responseDueAt: new Date(now.getTime() + CANDIDATE_RESPONSE_SLA_MS),
      } });
      await this.notificationsService.create({
        recipientUserId: selection.managerUserId, type: 'candidate.assigned', title: `Назначен кандидат ${candidate.fullName}`,
        entityType: 'candidate', entityId: candidate.id, targetUrl: `/candidates/${candidate.id}`,
        dedupeKey: `candidate:${candidate.id}:assignment:${created.id}:assigned`,
      }, tx);
    }
  }

  async archive(currentUser: CurrentAuthUser, id: string, payload: CandidateVersionDto): Promise<CandidateCardResponseDto> {
    return this.setArchive(currentUser, id, payload, true);
  }

  async restore(currentUser: CurrentAuthUser, id: string, payload: CandidateVersionDto): Promise<CandidateCardResponseDto> {
    return this.setArchive(currentUser, id, payload, false);
  }

  async assign(currentUser: CurrentAuthUser, id: string, payload: AssignCandidateManagerDto): Promise<CandidateCardResponseDto> {
    this.assertManage(currentUser);
    if (payload.assignments === undefined && payload.managerUserIds === undefined && !payload.managerUserId) {
      throw new BadRequestException('Укажите ответственных менеджеров');
    }
    await this.prisma.$transaction(async (tx) => {
      const candidate = await this.lockCandidate(tx, id);
      this.assertVersion(candidate, payload.expectedVersion);
      if (candidate.deletedAt || ['accepted', 'rejected'].includes(candidate.status)) throw new ConflictException('Кандидат закрыт или находится в архиве. Обновите карточку.');
      const selections = this.managerSelections(payload, candidate.objectId);
      if (candidate.candidateType === 'regular' && !selections.length) throw new BadRequestException({ code: 'CANDIDATE_MANAGER_REQUIRED', message: 'Назначьте хотя бы одного ответственного менеджера.' });
      for (const selection of selections) {
        await this.loadEligibleManager(tx, selection.managerUserId);
        if (selection.objectId) await this.assertCandidateObjectAvailable(tx, currentUser, selection.objectId);
      }
      const now = new Date();
      const existing = await tx.candidateManagerAssignment.findMany({ where: { candidateId: id, endedAt: null } });
      const unchanged = (item: CandidateManagerAssignment) => selections.some((selection) => selection.managerUserId === item.managerUserId && selection.objectId === item.objectId);
      const removed = existing.filter((item) => !unchanged(item));
      const added = selections.filter((selection) => !existing.some((item) => item.managerUserId === selection.managerUserId && item.objectId === selection.objectId));
      if (!removed.length && !added.length) return;
      for (const item of removed) {
        await tx.candidateManagerAssignment.update({ where: { id: item.id }, data: { endedAt: now, endedByUserId: currentUser.id } });
      }
      for (const selection of added) {
        const created = await tx.candidateManagerAssignment.create({ data: {
          candidateId: id, managerUserId: selection.managerUserId, objectId: selection.objectId,
          assignedByUserId: currentUser.id, assignedAt: now,
          responseDueAt: new Date(now.getTime() + CANDIDATE_RESPONSE_SLA_MS),
        } });
        await this.notificationsService.create({
          recipientUserId: selection.managerUserId, type: 'candidate.assigned', title: `Назначен кандидат ${candidate.fullName}`,
          entityType: 'candidate', entityId: id, targetUrl: `/candidates/${id}`,
          dedupeKey: `candidate:${id}:assignment:${created.id}:assigned`,
        }, tx);
      }
      await tx.candidate.update({ where: { id }, data: { version: { increment: 1 } } });
      await this.auditService.writeAuditEvent({ entityType: 'candidate', entityId: id, actorUserId: currentUser.id,
        action: existing.length ? 'candidate.manager_reassigned' : 'candidate.manager_assigned',
        oldValues: { managers: existing.map((item) => ({ managerUserId: item.managerUserId, objectId: item.objectId })) },
        newValues: { managers: selections },
      }, tx);
    });
    return this.getById(currentUser, id);
  }

  async convertToEmployee(currentUser: CurrentAuthUser, id: string, payload: ConvertCandidateToEmployeeDto): Promise<CandidateCardResponseDto> {
    this.assertManage(currentUser);
    if (!canCreateEmployee(this.permissions(currentUser))) throw new ForbiddenException('Employee creation denied');
    await this.prisma.$transaction(async (tx) => {
      const candidate = await this.lockCandidate(tx, id);
      // A retried request must return the previously created employee, never create a duplicate.
      if (candidate.employeeId) return;
      this.assertVersion(candidate, payload.expectedVersion);
      if (candidate.deletedAt || candidate.status === 'rejected') throw new ConflictException('Кандидат закрыт или находится в архиве. Обновите карточку.');
      // All candidate numbers move to the employee; the first stays the main one.
      const phones = candidate.phones.length ? candidate.phones : candidate.phone ? [candidate.phone] : [];
      const employee = await tx.employee.create({ data: {
        fullName: candidate.fullName, phone: phones[0] ?? null, phones, notes: candidate.comment ?? null,
        employeeType: payload.employeeType ?? 'regular', employmentStatus: 'active',
      } });
      await tx.candidate.update({ where: { id }, data: { employeeId: employee.id, status: 'accepted', version: { increment: 1 } } });
      await tx.candidateManagerAssignment.updateMany({ where: { candidateId: id, endedAt: null }, data: { endedAt: new Date(), endedByUserId: currentUser.id } });
      await this.auditService.writeAuditEvent({ entityType: 'employee', entityId: employee.id, actorUserId: currentUser.id,
        action: 'employee.created', newValues: { fullName: employee.fullName, employeeType: employee.employeeType, sourceCandidateId: id } }, tx);
      await this.auditService.writeAuditEvent({ entityType: 'candidate', entityId: id, actorUserId: currentUser.id,
        action: 'candidate.employee_created', oldValues: { status: candidate.status }, newValues: { employeeId: employee.id, status: 'accepted' } }, tx);
    });
    return this.getById(currentUser, id);
  }

  async respond(currentUser: CurrentAuthUser, id: string, payload: CreateCandidateResponseDto): Promise<CandidateCardResponseDto> {
    this.assertRespond(currentUser);
    await this.prisma.$transaction(async (tx) => {
      const candidate = await this.lockCandidate(tx, id);
      if (
        candidate.deletedAt ||
        (!canManageCandidates(this.permissions(currentUser)) && ['accepted', 'rejected'].includes(candidate.status))
      ) {
        throw new ConflictException('Кандидат закрыт или находится в архиве. Обновите карточку.');
      }

      const assignment = await tx.candidateManagerAssignment.findFirst({
        where: {
          candidateId: id,
          managerUserId: currentUser.id,
          endedAt: null,
        },
      });
      if (!assignment && !canManageCandidates(this.permissions(currentUser))) {
        throw new ForbiddenException(
          'Active candidate manager assignment is required for feedback',
        );
      }

      const response = await tx.candidateResponse.create({
        data: {
          candidateId: id,
          assignmentId: assignment?.id ?? null,
          authorUserId: currentUser.id,
          text: payload.text,
        },
      });
      const now = new Date();
      if (assignment && !assignment.firstRespondedAt) {
        await tx.candidateManagerAssignment.updateMany({
          where: { id: assignment.id, firstRespondedAt: null },
          data: { firstRespondedAt: now },
        });
        if (candidate.status === 'new') {
          await tx.candidate.update({
            where: { id },
            data: { status: 'in_progress', version: { increment: 1 } },
          });
        } else {
          await tx.candidate.update({
            where: { id },
            data: { updatedAt: now },
          });
        }
      } else {
        await tx.candidate.update({
          where: { id },
          data: { updatedAt: now },
        });
      }

      await this.auditService.writeAuditEvent({
        entityType: 'candidate',
        entityId: id,
        actorUserId: currentUser.id,
        action: 'candidate.manager_feedback_added',
        newValues: {
          responseId: response.id,
          assignmentId: assignment?.id ?? null,
        },
      }, tx);
    });
    return this.getById(currentUser, id);
  }

  private async setArchive(currentUser: CurrentAuthUser, id: string, payload: CandidateVersionDto, archived: boolean): Promise<CandidateCardResponseDto> {
    this.assertManage(currentUser);
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.lockCandidate(tx, id);
      this.assertVersion(existing, payload.expectedVersion);
      if (Boolean(existing.deletedAt) === archived) return;
      const now = new Date();
      await tx.candidate.update({ where: { id }, data: { deletedAt: archived ? now : null, version: { increment: 1 } } });
      if (archived) await tx.candidateManagerAssignment.updateMany({ where: { candidateId: id, endedAt: null }, data: { endedAt: now, endedByUserId: currentUser.id } });
      await this.auditService.writeAuditEvent({ entityType: 'candidate', entityId: id, actorUserId: currentUser.id, action: archived ? 'candidate.archived' : 'candidate.restored' }, tx);
    });
    return this.getById(currentUser, id);
  }

  private buildWhere(query: ListCandidatesQueryDto, now: Date): Prisma.CandidateWhereInput {
    const activeAssignment: Prisma.CandidateManagerAssignmentWhereInput = { endedAt: null, ...(query.managerUserId ? { managerUserId: query.managerUserId } : {}) };
    const assignmentConditions: Prisma.CandidateWhereInput[] = [];
    const where: Prisma.CandidateWhereInput = {
      ...(query.archiveState === 'active' ? { deletedAt: null } : query.archiveState === 'archived' ? { deletedAt: { not: null } } : {}),
      ...(query.q ? { OR: [{ fullName: { contains: query.q, mode: 'insensitive' } }, { phone: { contains: query.q, mode: 'insensitive' } },
        ...(candidatePhoneSearchDigits(query.q).length >= 3 ? [{ phoneSearchText: { contains: candidatePhoneSearchDigits(query.q) } }] : [])] } : {}),
      ...(query.candidateType ? { candidateType: query.candidateType } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    if (query.managerUserId) assignmentConditions.push({ assignments: { some: activeAssignment } });
    if (query.slaState === 'unassigned') assignmentConditions.push({ assignments: { none: { endedAt: null } } });
    if (query.slaState === 'awaiting_response') assignmentConditions.push({ assignments: { some: { ...activeAssignment, firstRespondedAt: null, responseDueAt: { gt: now } } } });
    if (query.slaState === 'overdue') assignmentConditions.push({ assignments: { some: { ...activeAssignment, firstRespondedAt: null, responseDueAt: { lte: now } } } });
    if (query.slaState === 'responded') assignmentConditions.push({ assignments: { some: { ...activeAssignment, firstRespondedAt: { not: null } } } });
    if (assignmentConditions.length > 0) where.AND = assignmentConditions;
    return where;
  }

  private mapListItem(
    candidate: CandidateListView,
    now: Date,
  ): CandidateListItemDto {
    const activeAssignments = candidate.assignments.filter((assignment) => !assignment.endedAt);
    const currentAssignment = activeAssignments[0] ?? null;
    const latestFeedback =
      candidate.responses.length === 0
        ? null
        : candidate.responses.reduce((latest, response) =>
            response.createdAt > latest.createdAt ? response : latest,
          );

    return {
      id: candidate.id,
      fullName: candidate.fullName,
      phone: candidate.phone,
      phones: candidate.phones.length ? candidate.phones : candidate.phone ? [candidate.phone] : [],
      employeeId: candidate.employeeId,
      candidateType: candidate.candidateType,
      status: candidate.status,
      version: candidate.version,
      deletedAt: candidate.deletedAt?.toISOString() ?? null,
      updatedAt: candidate.updatedAt.toISOString(),
      object: candidate.object,
      currentAssignment: currentAssignment
        ? this.mapAssignment(currentAssignment)
        : null,
      currentAssignments: activeAssignments.map((assignment) => this.mapAssignment(assignment)),
      latestFeedback: latestFeedback ? this.mapResponse(latestFeedback) : null,
      slaState: !activeAssignments.length ? 'unassigned'
        : activeAssignments.some((item) => !item.firstRespondedAt && item.responseDueAt <= now) ? 'overdue'
        : activeAssignments.some((item) => !item.firstRespondedAt) ? 'awaiting_response' : 'responded',
    };
  }

  private mapAssignment(assignment: CandidateAssignmentView): CandidateAssignmentResponseDto {
    return { id: assignment.id, object: assignment.object, manager: assignment.manager, assignedBy: assignment.assignedBy, assignedAt: assignment.assignedAt.toISOString(), responseDueAt: assignment.responseDueAt.toISOString(), firstRespondedAt: assignment.firstRespondedAt?.toISOString() ?? null, reminderSentAt: assignment.reminderSentAt?.toISOString() ?? null, endedAt: assignment.endedAt?.toISOString() ?? null, endedBy: assignment.endedBy };
  }

  private mapResponse(response: { id: string; assignmentId: string | null; author: { id: string; login: string; fullName: string }; text: string; createdAt: Date }): CandidateResponseItemDto {
    return { id: response.id, assignmentId: response.assignmentId, author: response.author, text: response.text, createdAt: response.createdAt.toISOString() };
  }

  private async lockCandidate(tx: Prisma.TransactionClient, id: string): Promise<Candidate> {
    await tx.$queryRaw`SELECT "id" FROM "candidates" WHERE "id" = ${id} FOR UPDATE`;
    const candidate = await tx.candidate.findUnique({ where: { id } });
    if (!candidate) throw new NotFoundException('Candidate not found');
    return candidate;
  }

  private snapshot(candidate: Candidate) {
    return {
      fullName: candidate.fullName,
      phone: candidate.phone,
      phones: candidate.phones,
      employeeId: candidate.employeeId,
      comment: candidate.comment,
      candidateType: candidate.candidateType,
      objectId: candidate.objectId,
      status: candidate.status,
      version: candidate.version,
      deletedAt: candidate.deletedAt?.toISOString() ?? null,
    };
  }

  private async assertCandidateObjectAvailable(
    tx: Prisma.TransactionClient,
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<void> {
    const object = await tx.object.findFirst({
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
    if (
      !object ||
      !canViewObjectBasicProfile({
        currentUserId: currentUser.id,
        roleCodes:
          currentUser.roleCodes ??
          (currentUser.roleCode ? [currentUser.roleCode] : []),
        permissionCodes: this.permissions(currentUser),
        object,
      })
    ) {
      throw new BadRequestException('Candidate object is not available');
    }
  }

  private async loadEligibleManager(
    tx: Prisma.TransactionClient,
    managerUserId: string,
  ): Promise<{ id: string; login: string; fullName: string }> {
    const manager = await tx.user.findFirst({
      where: {
        id: managerUserId,
        permissions: { none: { permission: { code: 'candidates.denied' } } },
        isActive: true,
        deletedAt: null,
        roles: {
          some: {
            role: { code: { in: [...CANDIDATE_MANAGER_ROLE_CODES] } },
          },
        },
      },
      select: userSelect,
    });
    if (!manager) {
      throw new BadRequestException('Candidate manager is not eligible');
    }
    return manager;
  }
  private managerSelections(payload: { managerUserId?: string | null; managerUserIds?: string[]; assignments?: CandidateManagerSelectionDto[] }, defaultObjectId: string | null): Array<{ managerUserId: string; objectId: string | null }> {
    const provided = [payload.assignments !== undefined, payload.managerUserIds !== undefined, Boolean(payload.managerUserId)].filter(Boolean).length;
    if (provided > 1) throw new BadRequestException('Use one manager selection format');
    const selections = payload.assignments?.map((item) => ({ managerUserId: item.managerUserId, objectId: item.objectId === undefined ? defaultObjectId : item.objectId }))
      ?? (payload.managerUserIds ?? (payload.managerUserId ? [payload.managerUserId] : [])).map((managerUserId) => ({ managerUserId, objectId: defaultObjectId }));
    if (new Set(selections.map((item) => item.managerUserId)).size !== selections.length) throw new BadRequestException('Один и тот же менеджер выбран несколько раз.');
    return selections;
  }

  private normalizePhones(values: string[]): string[] {
    const phones = values.map((value) => value.trim());
    if (!phones.length || phones.some((value) => value.replace(/\D/g, '').length < 3)) throw new BadRequestException('Укажите корректные телефоны кандидата');
    const unique = new Map<string, string>();
    for (const phone of phones) unique.set(candidatePhoneSearchDigits(phone), phone);
    return [...unique.values()];
  }

  private phoneSearchText(phones: string[]): string { return phones.map((phone) => phone.replace(/\D/g, '')).join(' '); }
  private phoneData(values: string[]) {
    const phones = this.normalizePhones(values);
    return { phone: phones[0], phones, phoneSearchText: this.phoneSearchText(phones) };
  }
  private assertVersion(candidate: Candidate, expected: number): void { if (candidate.version !== expected) this.versionConflict(); }
  private versionConflict(): never { throw new ConflictException({ code: 'CANDIDATE_VERSION_CONFLICT', message: 'Candidate was changed concurrently' }); }
  private permissions(user: CurrentAuthUser): string[] { return user.permissionCodes ?? []; }
  private assertView(user: CurrentAuthUser): void { if (!canViewCandidates(this.permissions(user))) throw new ForbiddenException('Candidate access denied'); }
  private assertManage(user: CurrentAuthUser): void { if (!canManageCandidates(this.permissions(user))) throw new ForbiddenException('Candidate management denied'); }
  private assertRespond(user: CurrentAuthUser): void { if (!canRespondToCandidates(this.permissions(user))) throw new ForbiddenException('Candidate response denied'); }
}
