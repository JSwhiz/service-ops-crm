import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { lockActorAccessRevision } from '../../common/access/lock-actor-access-revision';
import { loadAccessSubject } from '../../common/access/notification-access';
import { projectCommittedWrite } from '../../common/access/project-committed-write';
import type { AccessRule, AccessSubject } from '../users-access/types/access-policy.type';
import { buildAccessWhere, decideAccess, hasModuleDeny } from '../users-access/utils/access-policy.util';

import { AuditService } from '../audit/audit.service';
import { buildObjectAccessPolicyWhere, canViewObjectByScope, hasWideObjectAccess } from '../objects/utils/object-access.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserSubstitutionDto, ListUserSubstitutionsQueryDto, SubstitutionOptionsQueryDto } from './user-substitutions.dto';
import type { ObjectDelegationGrant } from './object-delegation.context';
import { resolveObjectDelegationGrants } from './resolve-object-delegation-grants.util';

export const SUBSTITUTION_MANAGE_PERMISSION = 'objects.substitution.manage';
type Actor = AccessSubject;
const userSelect = { id: true, fullName: true, login: true } as const;
const principalInclude = {
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
  permissions: { include: { permission: true } }, accessRules: true,
} as const;
type Principal = Prisma.UserGetPayload<{ include: typeof principalInclude }>;
const substitutionInclude = {
  principal: { select: userSelect }, replacement: { select: userSelect },
  createdBy: { select: userSelect }, revokedBy: { select: userSelect },
  objects: { include: { object: { select: { id: true, name: true, deletedAt: true, createdByUserId: true,
    assignments: { where: { isActive: true }, select: { userId: true, isActive: true } } } } } },
} as const;

@Injectable()
export class UserSubstitutionsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async resolveGrants(actorUserId: string): Promise<ObjectDelegationGrant[]> {
    return resolveObjectDelegationGrants(this.prisma, actorUserId);
  }

  async list(actor: Actor, query: ListUserSubstitutionsQueryDto = {}) {
    const page = query.page ?? 1, limit = query.limit ?? 20;
    const where = buildAccessWhere<Prisma.UserSubstitutionWhereInput>({
      subject: actor, actionCode: 'user_substitutions.read', invariantWhere: {},
      legacyWhere: this.isAdmin(actor) ? {} : { OR: [{ principalUserId: actor.id }, { replacementUserId: actor.id }] },
      parentActionCodes: ['objects.access', 'objects.read'],
      scopeWhere: (rule, code) => {
        if (code.startsWith('objects.')) {
          const object: Prisma.ObjectWhereInput = rule.scope === 'all' ? { id: { not: '' } }
            : rule.scope === 'selected' ? { id: { in: [...rule.selectedIds] } }
              : rule.scope === 'own' ? { createdByUserId: actor.id } : { assignments: { some: { userId: actor.id, isActive: true } } };
          return { objects: { some: { object } } };
        }
        return rule.scope === 'all' ? {} : rule.scope === 'own' ? { OR: [{ principalUserId: actor.id }, { replacementUserId: actor.id }] }
          : rule.scope === 'selected' ? { objects: { [rule.effect === 'allow' ? 'every' : 'some']: { objectId: { in: [...rule.selectedIds] } } } } : null;
      },
    }) as Prisma.UserSubstitutionWhereInput;
    const [records, total] = await this.prisma.$transaction([
      this.prisma.userSubstitution.findMany({ where, include: substitutionInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
      this.prisma.userSubstitution.count({ where }),
    ]);
    const now = Date.now();
    const items = records.map((record) => ({
      ...record, status: record.revokedAt ? 'revoked' : record.endsAt.getTime() <= now ? 'expired' : record.startsAt.getTime() > now ? 'scheduled' : 'active',
      objects: record.objects.map((scope) => ({ id: scope.object.id, name: scope.object.name, archived: !!scope.object.deletedAt })),
      canRevoke: !record.revokedAt && record.endsAt.getTime() > now && this.recordAction(actor, 'user_substitutions.revoke', record, this.isAdmin(actor) || record.principalUserId === actor.id || record.replacementUserId === actor.id),
    }));
    const canCreate = await this.canDiscoverCreate(actor, actor.id);
    const canCreateForOthers = (await this.discoverPrincipals(actor, undefined, 1)).length > 0;
    return { items, page, limit, total, totalPages: Math.ceil(total / limit), capabilities: { canCreate, canCreateForOthers } };
  }

  async options(actor: Actor, query: SubstitutionOptionsQueryDto = {}) {
    const principalUserId = query.principalUserId ?? actor.id;
    const principals = await this.discoverPrincipals(actor, query.principalSearch);
    const canCreateForOthers = query.principalSearch?.trim()
      ? (await this.discoverPrincipals(actor, undefined, 1)).length > 0 : principals.length > 0;
    // Keep foreign-ID probing behind the existing entry guard. A revoked
    // target returns empty options so the selector can recover without a directory leak.
    if (principalUserId !== actor.id) {
      try { this.assertCanCreate(actor, principalUserId); }
      catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
        return { users: [], objects: [], eligibleSelectedObjectIds: [], principals, resultLimit: 100, capabilities: { canCreate: false, canCreateForOthers } };
      }
    }
    const principal = await this.prisma.user.findFirst({ where: { id: principalUserId, isActive: true, deletedAt: null }, include: principalInclude });
    if (!principal) throw new NotFoundException('Исходный пользователь недоступен');
    const objectSearch = query.objectSearch?.trim(), userSearch = query.userSearch?.trim();
    const eligibleWhere = this.eligibleCreateObjectsWhere(actor, principal);
    const eligible = await this.prisma.object.findFirst({ where: eligibleWhere, select: { id: true } });
    if (!eligible) return { users: [], objects: [], eligibleSelectedObjectIds: [], principals, resultLimit: 100, capabilities: { canCreate: false, canCreateForOthers } };
    const [objects, users, eligibleSelected] = await Promise.all([
      this.prisma.object.findMany({
        where: { AND: [
          eligibleWhere,
          ...(objectSearch ? [{ OR: [{ name: { contains: objectSearch, mode: 'insensitive' as const } }, { address: { contains: objectSearch, mode: 'insensitive' as const } }] }] : []),
        ] },
        select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 100,
      }),
      this.prisma.user.findMany({
        where: { isActive: true, deletedAt: null, id: { not: principalUserId }, ...(userSearch ? { OR: [{ fullName: { contains: userSearch, mode: 'insensitive' as const } }, { login: { contains: userSearch, mode: 'insensitive' as const } }] } : {}) },
        select: userSelect, orderBy: [{ fullName: 'asc' }, { id: 'asc' }], take: 100,
      }),
      query.selectedObjectIds?.length ? this.prisma.object.findMany({
        where: { AND: [eligibleWhere, { id: { in: query.selectedObjectIds } }] }, select: { id: true },
      }) : Promise.resolve([]),
    ]);
    return { users, objects, eligibleSelectedObjectIds: eligibleSelected.map(object => object.id), principals, resultLimit: 100, capabilities: { canCreate: true, canCreateForOthers } };
  }

  private eligibleCreateObjectsWhere(actor: Actor, principal: Principal): Prisma.ObjectWhereInput {
    const roles = principal.roles.map(({ role }) => role.code);
    const subject: AccessSubject = { id: principal.id, isActive: principal.isActive, roleCodes: roles,
      permissionCodes: [...new Set([...principal.permissions.map(({ permission }) => permission.code),
        ...principal.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code))])],
      accessRules: principal.accessRules.map(rule => ({ ...rule, effect: rule.effect as AccessRule['effect'], scope: rule.scope as AccessRule['scope'] })),
    };
    // Canonical ownScopeOnly baseline plus fresh effective ACL. A read grant
    // cannot invent the ownership required by the unchanged create guard.
    const ownWhere: Prisma.ObjectWhereInput = hasWideObjectAccess(roles) ? {} : { OR: [
      { createdByUserId: principal.id }, { assignments: { some: { userId: principal.id, isActive: true } } },
    ] };
    return { deletedAt: null, AND: [this.createObjectWhere(actor, principal.id), ownWhere,
      buildObjectAccessPolicyWhere(subject, ownWhere),
    ] };
  }

  private async canDiscoverCreate(actor: Actor, principalUserId: string): Promise<boolean> {
    const principal = await this.prisma.user.findFirst({ where: { id: principalUserId, isActive: true, deletedAt: null },
      include: principalInclude });
    if (!principal) return false;
    return !!await this.prisma.object.findFirst({
      where: this.eligibleCreateObjectsWhere(actor, principal),
      select: { id: true },
    });
  }

  private async discoverPrincipals(actor: Actor, search?: string, limit = 100) {
    const results: Array<{ id: string; fullName: string; login: string }> = [];
    if (actor.isActive === false || hasModuleDeny(actor, 'user_substitutions.create', { resourceType: 'object' }) ||
      hasModuleDeny(actor, 'user_substitutions.manage', { resourceType: 'object' })) return results;
    if (!this.isAdmin(actor) && !actor.accessRules?.some(rule => rule.actionCode === 'user_substitutions.manage' &&
      rule.effect === 'allow' && rule.scope === 'selected' && rule.selectedIds.length > 0)) return results;
    // Stable keyset batches; never post-filter only the first 100 candidates.
    let after: { fullName: string; id: string } | undefined;
    const query = search?.trim();
    while (results.length < limit) {
      const candidates = await this.prisma.user.findMany({ where: { isActive: true, deletedAt: null, id: { not: actor.id }, AND: [
        ...(query ? [{ OR: [{ fullName: { contains: query, mode: 'insensitive' as const } }, { login: { contains: query, mode: 'insensitive' as const } }] }] : []),
        ...(after ? [{ OR: [{ fullName: { gt: after.fullName } }, { fullName: after.fullName, id: { gt: after.id } }] }] : []),
      ] }, include: principalInclude, orderBy: [{ fullName: 'asc' }, { id: 'asc' }], take: 100 });
      if (!candidates.length) break;
      for (const principal of candidates) {
        const eligible = await this.prisma.object.findFirst({ where: this.eligibleCreateObjectsWhere(actor, principal), select: { id: true } });
        if (eligible) results.push({ id: principal.id, fullName: principal.fullName, login: principal.login });
        if (results.length === limit) break;
      }
      const last = candidates[candidates.length - 1];
      after = { fullName: last.fullName, id: last.id };
      if (candidates.length < 100) break;
    }
    return results;
  }

  async create(actor: Actor, payload: CreateUserSubstitutionDto) {
    const principalUserId = payload.principalUserId ?? actor.id;
    this.assertCanCreate(actor, principalUserId, payload.objectIds);
    if (principalUserId === payload.replacementUserId) throw new BadRequestException('Нельзя заместить самого себя');
    const startsAt = new Date(payload.startsAt), endsAt = new Date(payload.endsAt);
    const now = Date.now();
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt || endsAt.getTime() <= now || startsAt.getTime() < now - 60000) throw new BadRequestException('Укажите действующий период замещения без заднего числа');
    const reason = payload.reason.trim();
    if (!reason) throw new BadRequestException('Причина обязательна');
    await this.prisma.$transaction(async (tx) => {
      // Source writers lock the object first. Keep membership and both user
      // eligibilities stable until the substitution and its audit commit.
      const objectIds = [...new Set(payload.objectIds.map(id => id.toLowerCase()))].sort();
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "objects" WHERE "id" IN (${Prisma.join(objectIds)}) ORDER BY "id" FOR SHARE`);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "object_assignments" WHERE "objectId" IN (${Prisma.join(objectIds)}) AND "isActive" = true ORDER BY "id" FOR SHARE`);
      const userIds = [...new Set([principalUserId, payload.replacementUserId, actor.id].map(id => id.toLowerCase()))].sort();
      for (const userId of userIds) {
        if (userId === principalUserId.toLowerCase()) {
          await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
        } else {
          await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR SHARE`;
        }
      }
      await lockActorAccessRevision(tx, actor);
      const principal = await tx.user.findFirst({ where: { id: principalUserId, isActive: true, deletedAt: null }, include: principalInclude });
      const replacement = await tx.user.findFirst({ where: { id: payload.replacementUserId, isActive: true, deletedAt: null }, select: { id: true } });
      if (!principal || !replacement) throw new BadRequestException('Оба пользователя должны быть активны');
      const objects = await tx.object.findMany({ where: { AND: [{ id: { in: payload.objectIds } }, this.eligibleCreateObjectsWhere(actor, principal)] }, include: { assignments: { where: { isActive: true } } } });
      const roles = principal.roles.map((entry) => entry.role.code);
      if (objects.length !== payload.objectIds.length || objects.some((object) => !canViewObjectByScope({ currentUserId: principalUserId, roleCodes: roles, object, ownScopeOnly: true }))) throw new ForbiddenException('Можно заместить только собственный доступ к выбранным объектам');
      this.assertCanCreate(actor, principalUserId, objects.map((object) => object.id));
      if (objects.some((object) => !this.canCreateForObject(actor, principalUserId, object.id, object))) {
        throw new ForbiddenException('Создавать замещение для выбранных объектов нельзя');
      }
      const overlap = await tx.userSubstitution.findFirst({ where: { principalUserId, replacementUserId: payload.replacementUserId, revokedAt: null, startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, objects: { some: { objectId: { in: payload.objectIds } } } } });
      if (overlap) throw new ConflictException('Уже есть пересекающееся замещение этих объектов');
      const record = await tx.userSubstitution.create({ data: { principalUserId, replacementUserId: payload.replacementUserId, createdByUserId: actor.id, startsAt, endsAt, reason, objects: { create: payload.objectIds.map((objectId) => ({ objectId })) } } });
      await this.audit.writeAuditEvent({ entityType: 'user_substitution', entityId: record.id, actorUserId: actor.id, action: 'user_substitution.created', newValues: { principalUserId, replacementUserId: record.replacementUserId, objectIds: payload.objectIds, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), reason } }, tx);
    });
    return this.mutationResponse(actor);
  }

  async revoke(actor: Actor, id: string, reason: string) {
    if (!reason.trim()) throw new BadRequestException('Причина отзыва обязательна');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "user_substitutions" WHERE "id" = ${id} FOR UPDATE`;
      await lockActorAccessRevision(tx, actor);
      const record = await tx.userSubstitution.findUnique({ where: { id } });
      if (!record) throw new NotFoundException('Замещение не найдено');
      const scopes = await tx.userSubstitutionObject.findMany({ where: { substitutionId: record.id }, select: { objectId: true,
        object: { select: { createdByUserId: true, assignments: { where: { isActive: true }, select: { userId: true, isActive: true } } } } } });
      if (!this.recordAction(actor, 'user_substitutions.revoke', { ...record, objects: scopes }, this.isAdmin(actor) || actor.id === record.principalUserId || actor.id === record.replacementUserId)) throw new ForbiddenException('Отзыв замещения недоступен');
      if (record.revokedAt) return;
      await tx.userSubstitution.update({ where: { id }, data: { revokedAt: new Date(), revokedByUserId: actor.id, revocationReason: reason.trim() } });
      await this.audit.writeAuditEvent({ entityType: 'user_substitution', entityId: id, actorUserId: actor.id, action: 'user_substitution.revoked', metadata: { principalUserId: record.principalUserId, replacementUserId: record.replacementUserId, reason: reason.trim() } }, tx);
    });
    return this.mutationResponse(actor);
  }

  private mutationResponse(actor: Actor) {
    return projectCommittedWrite(this.prisma, actor, async () => {
      const subject = await loadAccessSubject(this.prisma, actor.id);
      if (!subject?.isActive) throw new ForbiddenException('Доступ к замещениям изменился');
      return this.list(subject);
    });
  }

  private isAdmin(actor: Actor, objectId?: string, principalUserId?: string) {
    return decideAccess(actor, 'user_substitutions.manage', actor.permissionCodes?.includes(SUBSTITUTION_MANAGE_PERMISSION) ?? false,
      { resourceType: 'object', resourceId: objectId, ownerUserId: principalUserId });
  }
  private createObjectWhere(actor: Actor, principalUserId: string): Prisma.ObjectWhereInput {
    const none = { id: { in: [] as string[] } };
    const scopeWhere = (rule: AccessRule, code: string): Prisma.ObjectWhereInput | null => {
      if (rule.scope === 'all') return {};
      if (rule.scope === 'selected') return { id: { in: [...rule.selectedIds] } };
      if (rule.scope === 'own') return code.startsWith('objects.')
        ? { createdByUserId: actor.id } : principalUserId === actor.id ? {} : none;
      return code.startsWith('objects.') ? { assignments: { some: { userId: actor.id, isActive: true } } } : null;
    };
    const admin = buildAccessWhere<Prisma.ObjectWhereInput>({ subject: actor, actionCode: 'user_substitutions.manage',
      legacyWhere: actor.permissionCodes?.includes(SUBSTITUTION_MANAGE_PERMISSION) ? {} : none,
      invariantWhere: {}, parentActionCodes: ['objects.access', 'objects.read'], scopeWhere }) as Prisma.ObjectWhereInput;
    return buildAccessWhere<Prisma.ObjectWhereInput>({ subject: actor, actionCode: 'user_substitutions.create',
      legacyWhere: principalUserId === actor.id ? {} : admin,
      invariantWhere: principalUserId === actor.id ? {} : admin,
      parentActionCodes: ['objects.access', 'objects.read'], scopeWhere }) as Prisma.ObjectWhereInput;
  }
  private objectContext(objectId: string, object?: { createdByUserId: string; assignments: Array<{ userId: string; isActive?: boolean }> }) {
    return { resourceType: 'object', resourceId: objectId, ownerUserId: object?.createdByUserId,
      assignedUserIds: object?.assignments.filter((assignment) => assignment.isActive !== false).map((assignment) => assignment.userId) };
  }
  private canCreateForObject(actor: Actor, principalUserId: string, objectId?: string,
    object?: { createdByUserId: string; assignments: Array<{ userId: string; isActive?: boolean }> }): boolean {
    if (objectId && hasModuleDeny(actor, 'objects.read', this.objectContext(objectId, object))) return false;
    const own = actor.id === principalUserId;
    const admin = this.isAdmin(actor, objectId, principalUserId);
    return (own || admin) && decideAccess(actor, 'user_substitutions.create', own || admin,
      { resourceType: 'object', resourceId: objectId, ownerUserId: principalUserId });
  }
  private assertCanCreate(actor: Actor, principalUserId: string, objectIds?: string[]) {
    if (objectIds) {
      if (!objectIds.length || objectIds.some((id) => !this.canCreateForObject(actor, principalUserId, id))) {
        throw new ForbiddenException('Создавать замещение для выбранных объектов нельзя');
      }
      return;
    }
    // Discovery can enter a selected administration grant, but each returned
    // object and each requested write still needs its own scoped decision.
    const context = { resourceType: 'object', ownerUserId: principalUserId };
    const selectedEntry = actor.isActive !== false && !hasModuleDeny(actor, 'user_substitutions.manage', context) &&
      !hasModuleDeny(actor, 'user_substitutions.create', context) && actor.accessRules?.some((rule) =>
        rule.actionCode === 'user_substitutions.manage' && rule.effect === 'allow' && rule.scope === 'selected' &&
        Array.isArray(rule.selectedIds) && rule.selectedIds.length > 0);
    if (!this.canCreateForObject(actor, principalUserId) && !selectedEntry) throw new ForbiddenException('Создавать замещение другого пользователя нельзя');
  }

  private recordAction(actor: Actor, code: string, record: { principalUserId: string; objects: Array<{ objectId: string;
    object?: { createdByUserId: string; assignments: Array<{ userId: string; isActive?: boolean }> } }> }, legacy: boolean) {
    return record.objects.length > 0 && record.objects.every(scope => decideAccess(actor, code,
      legacy || this.isAdmin(actor, scope.objectId, record.principalUserId),
      { resourceType: 'object', resourceId: scope.objectId, ownerUserId: record.principalUserId,
        parents: [{ actionCode: 'objects.read', context: this.objectContext(scope.objectId, scope.object) }] }));
  }
}
