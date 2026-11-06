import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AccessSubject } from '../users-access/types/access-policy.type';
import { buildAccessWhere, decideAccess } from '../users-access/utils/access-policy.util';

import { AuditService } from '../audit/audit.service';
import { canViewObjectByScope, hasWideObjectAccess } from '../objects/utils/object-access.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserSubstitutionDto, ListUserSubstitutionsQueryDto, SubstitutionOptionsQueryDto } from './user-substitutions.dto';
import type { ObjectDelegationGrant } from './object-delegation.context';
import { resolveObjectDelegationGrants } from './resolve-object-delegation-grants.util';

export const SUBSTITUTION_MANAGE_PERMISSION = 'objects.substitution.manage';
type Actor = AccessSubject;
const userSelect = { id: true, fullName: true, login: true } as const;
const substitutionInclude = {
  principal: { select: userSelect }, replacement: { select: userSelect },
  createdBy: { select: userSelect }, revokedBy: { select: userSelect },
  objects: { include: { object: { select: { id: true, name: true, deletedAt: true } } } },
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
    return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  async options(actor: Actor, query: SubstitutionOptionsQueryDto = {}) {
    const principalUserId = query.principalUserId ?? actor.id;
    this.assertCanCreate(actor, principalUserId);
    const principal = await this.prisma.user.findFirst({ where: { id: principalUserId, isActive: true, deletedAt: null }, include: { roles: { include: { role: true } } } });
    if (!principal) throw new NotFoundException('Исходный пользователь недоступен');
    const roles = principal.roles.map((entry) => entry.role.code);
    const objectSearch = query.objectSearch?.trim(), userSearch = query.userSearch?.trim();
    const [objects, users] = await Promise.all([
      this.prisma.object.findMany({
        where: { deletedAt: null, AND: [
          ...(hasWideObjectAccess(roles) ? [] : [{ OR: [{ createdByUserId: principalUserId }, { assignments: { some: { userId: principalUserId, isActive: true } } }] }]),
          ...(objectSearch ? [{ OR: [{ name: { contains: objectSearch, mode: 'insensitive' as const } }, { address: { contains: objectSearch, mode: 'insensitive' as const } }] }] : []),
        ] },
        select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 100,
      }),
      this.prisma.user.findMany({
        where: { isActive: true, deletedAt: null, id: { not: principalUserId }, ...(userSearch ? { OR: [{ fullName: { contains: userSearch, mode: 'insensitive' as const } }, { login: { contains: userSearch, mode: 'insensitive' as const } }] } : {}) },
        select: userSelect, orderBy: [{ fullName: 'asc' }, { id: 'asc' }], take: 100,
      }),
    ]);
    return { users, objects, resultLimit: 100 };
  }

  async create(actor: Actor, payload: CreateUserSubstitutionDto) {
    const principalUserId = payload.principalUserId ?? actor.id;
    this.assertCanCreate(actor, principalUserId);
    if (principalUserId === payload.replacementUserId) throw new BadRequestException('Нельзя заместить самого себя');
    const startsAt = new Date(payload.startsAt), endsAt = new Date(payload.endsAt);
    const now = Date.now();
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt || endsAt.getTime() <= now || startsAt.getTime() < now - 60000) throw new BadRequestException('Укажите действующий период замещения без заднего числа');
    const reason = payload.reason.trim();
    if (!reason) throw new BadRequestException('Причина обязательна');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${principalUserId} FOR UPDATE`;
      const principal = await tx.user.findFirst({ where: { id: principalUserId, isActive: true, deletedAt: null }, include: { roles: { include: { role: true } } } });
      const replacement = await tx.user.findFirst({ where: { id: payload.replacementUserId, isActive: true, deletedAt: null }, select: { id: true } });
      if (!principal || !replacement) throw new BadRequestException('Оба пользователя должны быть активны');
      const objects = await tx.object.findMany({ where: { id: { in: payload.objectIds }, deletedAt: null }, include: { assignments: { where: { isActive: true } } } });
      const roles = principal.roles.map((entry) => entry.role.code);
      if (objects.length !== payload.objectIds.length || objects.some((object) => !canViewObjectByScope({ currentUserId: principalUserId, roleCodes: roles, object, ownScopeOnly: true }))) throw new ForbiddenException('Можно заместить только собственный доступ к выбранным объектам');
      const overlap = await tx.userSubstitution.findFirst({ where: { principalUserId, replacementUserId: payload.replacementUserId, revokedAt: null, startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, objects: { some: { objectId: { in: payload.objectIds } } } } });
      if (overlap) throw new ConflictException('Уже есть пересекающееся замещение этих объектов');
      const record = await tx.userSubstitution.create({ data: { principalUserId, replacementUserId: payload.replacementUserId, createdByUserId: actor.id, startsAt, endsAt, reason, objects: { create: payload.objectIds.map((objectId) => ({ objectId })) } } });
      await this.audit.writeAuditEvent({ entityType: 'user_substitution', entityId: record.id, actorUserId: actor.id, action: 'user_substitution.created', newValues: { principalUserId, replacementUserId: record.replacementUserId, objectIds: payload.objectIds, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), reason } }, tx);
    });
    return this.list(actor);
  }

  async revoke(actor: Actor, id: string, reason: string) {
    if (!reason.trim()) throw new BadRequestException('Причина отзыва обязательна');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "user_substitutions" WHERE "id" = ${id} FOR UPDATE`;
      const record = await tx.userSubstitution.findUnique({ where: { id } });
      if (!record) throw new NotFoundException('Замещение не найдено');
      const scopes = await tx.userSubstitutionObject.findMany({ where: { substitutionId: record.id }, select: { objectId: true } });
      if (!this.recordAction(actor, 'user_substitutions.revoke', { ...record, objects: scopes }, this.isAdmin(actor) || actor.id === record.principalUserId || actor.id === record.replacementUserId)) throw new ForbiddenException('Отзыв замещения недоступен');
      if (record.revokedAt) return;
      await tx.userSubstitution.update({ where: { id }, data: { revokedAt: new Date(), revokedByUserId: actor.id, revocationReason: reason.trim() } });
      await this.audit.writeAuditEvent({ entityType: 'user_substitution', entityId: id, actorUserId: actor.id, action: 'user_substitution.revoked', metadata: { principalUserId: record.principalUserId, replacementUserId: record.replacementUserId, reason: reason.trim() } }, tx);
    });
    return this.list(actor);
  }

  private isAdmin(actor: Actor) { return decideAccess(actor, 'user_substitutions.manage', actor.permissionCodes?.includes(SUBSTITUTION_MANAGE_PERMISSION) ?? false); }
  private assertCanCreate(actor: Actor, principalUserId: string) {
    if (actor.id !== principalUserId && !this.isAdmin(actor)) throw new ForbiddenException('Создавать замещение другого пользователя нельзя');
    if (!decideAccess(actor, 'user_substitutions.create', actor.id === principalUserId || this.isAdmin(actor), { resourceType: 'object', ownerUserId: principalUserId })) throw new ForbiddenException('Создавать замещение другого пользователя нельзя');
  }

  private recordAction(actor: Actor, code: string, record: { principalUserId: string; objects: Array<{ objectId: string }> }, legacy: boolean) {
    return record.objects.length > 0 && record.objects.every(scope => decideAccess(actor, code, legacy, { resourceType: 'object', resourceId: scope.objectId, ownerUserId: record.principalUserId }));
  }
}
