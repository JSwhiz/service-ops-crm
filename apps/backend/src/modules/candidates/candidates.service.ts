import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Candidate, CandidateManagerAssignment, Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

import { CANDIDATE_MANAGER_ROLE_CODES, CANDIDATE_RESPONSE_SLA_MS } from './constants/candidate.constants';
import { CandidateAssignmentResponseDto, CandidateCardResponseDto, CandidateListItemDto, CandidateListResponseDto, CandidateResponseItemDto } from './dto/candidate-response.dto';
import { AssignCandidateManagerDto, CandidateVersionDto, ChangeCandidateStatusDto, CreateCandidateDto, CreateCandidateResponseDto, UpdateCandidateDto } from './dto/candidate-mutations.dto';
import { ListCandidateManagersQueryDto, ListCandidatesQueryDto } from './dto/list-candidates-query.dto';
import { canManageCandidates, canRespondToCandidates, canViewCandidates } from './utils/candidate-access.util';

interface CurrentAuthUser { id: string; permissionCodes?: string[]; }
const userSelect = { id: true, login: true, fullName: true } as const;
const assignmentInclude = { manager: { select: userSelect }, assignedBy: { select: userSelect }, endedBy: { select: userSelect } } as const;

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
    const where = this.buildWhere(query, now);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.candidate.findMany({
        where,
        include: { assignments: { include: assignmentInclude, orderBy: { assignedAt: 'desc' }, take: 1 } },
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
    const candidate = await this.prisma.candidate.findUnique({
      where: { id },
      include: {
        createdBy: { select: userSelect },
        assignments: { include: assignmentInclude, orderBy: { assignedAt: 'desc' } },
        responses: { include: { author: { select: userSelect } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!candidate) throw new NotFoundException('Candidate not found');
    const currentAssignment = candidate.assignments.find((assignment) => !assignment.endedAt) ?? null;
    return {
      ...this.mapListItem({ ...candidate, assignments: currentAssignment ? [currentAssignment] : candidate.assignments.slice(0, 1) }, new Date()),
      comment: candidate.comment,
      createdBy: candidate.createdBy,
      createdAt: candidate.createdAt.toISOString(),
      assignments: candidate.assignments.map((item) => this.mapAssignment(item)),
      responses: candidate.responses.map((item) => this.mapResponse(item)),
      capabilities: {
        canManage: canManageCandidates(this.permissions(currentUser)),
        canRespond: canRespondToCandidates(this.permissions(currentUser)) && !candidate.deletedAt && !['accepted', 'rejected'].includes(candidate.status),
        canArchive: canManageCandidates(this.permissions(currentUser)) && !candidate.deletedAt,
        canRestore: canManageCandidates(this.permissions(currentUser)) && Boolean(candidate.deletedAt),
      },
    };
  }

  async create(currentUser: CurrentAuthUser, payload: CreateCandidateDto): Promise<CandidateCardResponseDto> {
    this.assertManage(currentUser);
    const candidate = await this.prisma.$transaction(async (tx) => {
      const created = await tx.candidate.create({ data: {
        fullName: payload.fullName,
        phone: payload.phone || null,
        comment: payload.comment || null,
        candidateType: payload.candidateType,
        createdByUserId: currentUser.id,
      } });
      await this.auditService.writeAuditEvent({ entityType: 'candidate', entityId: created.id, actorUserId: currentUser.id, action: 'candidate.created', newValues: this.snapshot(created) }, tx);
      return created;
    });
    return this.getById(currentUser, candidate.id);
  }

  async update(currentUser: CurrentAuthUser, id: string, payload: UpdateCandidateDto): Promise<CandidateCardResponseDto> {
    this.assertManage(currentUser);
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.lockCandidate(tx, id);
      this.assertVersion(existing, payload.expectedVersion);
      const result = await tx.candidate.updateMany({ where: { id, version: payload.expectedVersion }, data: {
        ...(payload.fullName !== undefined ? { fullName: payload.fullName } : {}),
        ...(payload.phone !== undefined ? { phone: payload.phone || null } : {}),
        ...(payload.comment !== undefined ? { comment: payload.comment || null } : {}),
        ...(payload.candidateType !== undefined ? { candidateType: payload.candidateType } : {}),
        version: { increment: 1 },
      } });
      if (result.count !== 1) this.versionConflict();
      const updated = await tx.candidate.findUniqueOrThrow({ where: { id } });
      await this.auditService.writeAuditEvent({ entityType: 'candidate', entityId: id, actorUserId: currentUser.id, action: 'candidate.updated', oldValues: this.snapshot(existing), newValues: this.snapshot(updated) }, tx);
    });
    return this.getById(currentUser, id);
  }

  async changeStatus(currentUser: CurrentAuthUser, id: string, payload: ChangeCandidateStatusDto): Promise<CandidateCardResponseDto> {
    this.assertManage(currentUser);
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.lockCandidate(tx, id);
      this.assertVersion(existing, payload.expectedVersion);
      if (existing.status === payload.status) return;
      await tx.candidate.update({ where: { id }, data: { status: payload.status, version: { increment: 1 } } });
      if (['accepted', 'rejected'].includes(payload.status)) {
        await tx.candidateManagerAssignment.updateMany({ where: { candidateId: id, endedAt: null }, data: { endedAt: new Date(), endedByUserId: currentUser.id } });
      }
      await this.auditService.writeAuditEvent({ entityType: 'candidate', entityId: id, actorUserId: currentUser.id, action: 'candidate.status_changed', oldValues: { status: existing.status }, newValues: { status: payload.status } }, tx);
    });
    return this.getById(currentUser, id);
  }

  async archive(currentUser: CurrentAuthUser, id: string, payload: CandidateVersionDto): Promise<CandidateCardResponseDto> {
    return this.setArchive(currentUser, id, payload, true);
  }

  async restore(currentUser: CurrentAuthUser, id: string, payload: CandidateVersionDto): Promise<CandidateCardResponseDto> {
    return this.setArchive(currentUser, id, payload, false);
  }

  async assign(currentUser: CurrentAuthUser, id: string, payload: AssignCandidateManagerDto): Promise<CandidateCardResponseDto> {
    this.assertManage(currentUser);
    const manager = await this.prisma.user.findFirst({
      where: { id: payload.managerUserId, isActive: true, deletedAt: null, roles: { some: { role: { code: { in: [...CANDIDATE_MANAGER_ROLE_CODES] } } } } },
      select: userSelect,
    });
    if (!manager) throw new ConflictException('Candidate manager is not eligible');
    const assignment = await this.prisma.$transaction(async (tx) => {
      const candidate = await this.lockCandidate(tx, id);
      this.assertVersion(candidate, payload.expectedVersion);
      if (candidate.deletedAt || ['accepted', 'rejected'].includes(candidate.status)) throw new ConflictException('Candidate is not active');
      const now = new Date();
      const existing = await tx.candidateManagerAssignment.findFirst({ where: { candidateId: id, endedAt: null } });
      if (existing?.managerUserId === manager.id) return existing;
      if (existing) await tx.candidateManagerAssignment.update({ where: { id: existing.id }, data: { endedAt: now, endedByUserId: currentUser.id } });
      const created = await tx.candidateManagerAssignment.create({ data: {
        candidateId: id,
        managerUserId: manager.id,
        assignedByUserId: currentUser.id,
        assignedAt: now,
        responseDueAt: new Date(now.getTime() + CANDIDATE_RESPONSE_SLA_MS),
      } });
      await tx.candidate.update({ where: { id }, data: { version: { increment: 1 } } });
      await this.notificationsService.create({
        recipientUserId: manager.id,
        type: 'candidate.assigned',
        title: `Назначен кандидат ${candidate.fullName}`,
        entityType: 'candidate', entityId: id, targetUrl: `/candidates/${id}`,
        dedupeKey: `candidate:${id}:assignment:${created.id}:assigned`,
      }, tx);
      await this.auditService.writeAuditEvent({ entityType: 'candidate', entityId: id, actorUserId: currentUser.id, action: existing ? 'candidate.manager_reassigned' : 'candidate.manager_assigned', oldValues: existing ? { managerUserId: existing.managerUserId } : null, newValues: { managerUserId: manager.id, assignmentId: created.id } }, tx);
      return created;
    });
    void assignment;
    return this.getById(currentUser, id);
  }

  async respond(currentUser: CurrentAuthUser, id: string, payload: CreateCandidateResponseDto): Promise<CandidateCardResponseDto> {
    this.assertRespond(currentUser);
    await this.prisma.$transaction(async (tx) => {
      const candidate = await this.lockCandidate(tx, id);
      if (candidate.deletedAt || ['accepted', 'rejected'].includes(candidate.status)) throw new ConflictException('Candidate is not active');
      const assignment = await tx.candidateManagerAssignment.findFirst({ where: { candidateId: id, endedAt: null } });
      await tx.candidateResponse.create({ data: { candidateId: id, assignmentId: assignment?.id ?? null, authorUserId: currentUser.id, text: payload.text } });
      if (assignment?.managerUserId === currentUser.id && !assignment.firstRespondedAt) {
        const now = new Date();
        await tx.candidateManagerAssignment.updateMany({ where: { id: assignment.id, firstRespondedAt: null }, data: { firstRespondedAt: now } });
        if (candidate.status === 'new') await tx.candidate.update({ where: { id }, data: { status: 'in_progress', version: { increment: 1 } } });
        else await tx.candidate.update({ where: { id }, data: { updatedAt: now } });
      } else {
        await tx.candidate.update({ where: { id }, data: { updatedAt: new Date() } });
      }
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
    const activeAssignment = { endedAt: null };
    const assignmentConditions: Prisma.CandidateWhereInput[] = [];
    const where: Prisma.CandidateWhereInput = {
      ...(query.archiveState === 'active' ? { deletedAt: null } : query.archiveState === 'archived' ? { deletedAt: { not: null } } : {}),
      ...(query.q ? { OR: [{ fullName: { contains: query.q, mode: 'insensitive' } }, { phone: { contains: query.q, mode: 'insensitive' } }] } : {}),
      ...(query.candidateType ? { candidateType: query.candidateType } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    if (query.managerUserId) assignmentConditions.push({ assignments: { some: { ...activeAssignment, managerUserId: query.managerUserId } } });
    if (query.slaState === 'unassigned') assignmentConditions.push({ assignments: { none: activeAssignment } });
    if (query.slaState === 'awaiting_response') assignmentConditions.push({ assignments: { some: { ...activeAssignment, firstRespondedAt: null, responseDueAt: { gt: now } } } });
    if (query.slaState === 'overdue') assignmentConditions.push({ assignments: { some: { ...activeAssignment, firstRespondedAt: null, responseDueAt: { lte: now } } } });
    if (query.slaState === 'responded') assignmentConditions.push({ assignments: { some: { ...activeAssignment, firstRespondedAt: { not: null } } } });
    if (assignmentConditions.length > 0) where.AND = assignmentConditions;
    return where;
  }

  private mapListItem(candidate: Candidate & { assignments: Array<CandidateManagerAssignment & { manager: { id: string; login: string; fullName: string }; assignedBy: { id: string; login: string; fullName: string }; endedBy: { id: string; login: string; fullName: string } | null }> }, now: Date): CandidateListItemDto {
    const assignment = candidate.assignments[0] ?? null;
    const currentAssignment = assignment && !assignment.endedAt ? assignment : null;
    return {
      id: candidate.id, fullName: candidate.fullName, phone: candidate.phone,
      candidateType: candidate.candidateType, status: candidate.status,
      version: candidate.version, deletedAt: candidate.deletedAt?.toISOString() ?? null,
      updatedAt: candidate.updatedAt.toISOString(),
      currentAssignment: currentAssignment ? this.mapAssignment(currentAssignment) : null,
      slaState: currentAssignment ? currentAssignment.firstRespondedAt ? 'responded' : currentAssignment.responseDueAt <= now ? 'overdue' : 'awaiting_response' : 'unassigned',
    };
  }

  private mapAssignment(assignment: CandidateManagerAssignment & { manager: { id: string; login: string; fullName: string }; assignedBy: { id: string; login: string; fullName: string }; endedBy: { id: string; login: string; fullName: string } | null }): CandidateAssignmentResponseDto {
    return { id: assignment.id, manager: assignment.manager, assignedBy: assignment.assignedBy, assignedAt: assignment.assignedAt.toISOString(), responseDueAt: assignment.responseDueAt.toISOString(), firstRespondedAt: assignment.firstRespondedAt?.toISOString() ?? null, reminderSentAt: assignment.reminderSentAt?.toISOString() ?? null, endedAt: assignment.endedAt?.toISOString() ?? null, endedBy: assignment.endedBy };
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

  private snapshot(candidate: Candidate) { return { fullName: candidate.fullName, phone: candidate.phone, comment: candidate.comment, candidateType: candidate.candidateType, status: candidate.status, version: candidate.version, deletedAt: candidate.deletedAt?.toISOString() ?? null }; }
  private assertVersion(candidate: Candidate, expected: number): void { if (candidate.version !== expected) this.versionConflict(); }
  private versionConflict(): never { throw new ConflictException({ code: 'CANDIDATE_VERSION_CONFLICT', message: 'Candidate was changed concurrently' }); }
  private permissions(user: CurrentAuthUser): string[] { return user.permissionCodes ?? []; }
  private assertView(user: CurrentAuthUser): void { if (!canViewCandidates(this.permissions(user))) throw new ForbiddenException('Candidate access denied'); }
  private assertManage(user: CurrentAuthUser): void { if (!canManageCandidates(this.permissions(user))) throw new ForbiddenException('Candidate management denied'); }
  private assertRespond(user: CurrentAuthUser): void { if (!canRespondToCandidates(this.permissions(user))) throw new ForbiddenException('Candidate response denied'); }
}
