import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { lockActorAccessRevision } from "../../common/access/lock-actor-access-revision";
import { PrismaService } from "../prisma/prisma.service";
import {
  ACCESS_ACTION_CATALOG,
  getAccessAction,
} from "./access-action-catalog";
import {
  AccessAdminListQueryDto,
  AccessResourceQueryDto,
  PreviewAccessDto,
  SaveAccessDto,
} from "./dto/access-admin.dto";
import {
  AccessChange,
  AccessRule,
  AccessSubject,
} from "./types/access-policy.type";
import { decideAccess } from "./utils/access-policy.util";
import { summarizeAccess } from "./utils/access-summary.util";
import { resolveEffectivePermissionCodes } from "./utils/effective-permissions.util";
import {
  buildLegacyAccessProjection,
  LegacyAccessBaseline,
} from "./utils/legacy-access-projection.util";
import { canViewObjectByScope } from "../objects/utils/object-access.util";
import { objectPolicyContext } from "./utils/object-policy-context.util";

type Db = Prisma.TransactionClient;
const select = {
  id: true,
  login: true,
  fullName: true,
  isActive: true,
  deletedAt: true,
  accessVersion: true,
  accessRules: { orderBy: { actionCode: "asc" as const } },
  permissions: {
    orderBy: { permissionId: "asc" as const },
    select: { permission: { select: { code: true, name: true } } },
  },
  roles: {
    orderBy: { roleId: "asc" as const },
    select: {
      role: {
        select: {
          code: true,
          name: true,
          permissions: {
            orderBy: { permissionId: "asc" as const },
            select: { permission: { select: { code: true, name: true } } },
          },
        },
      },
    },
  },
} satisfies Prisma.UserSelect;
type Source = Prisma.UserGetPayload<{ select: typeof select }>;
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
const hash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
function rulesOf(user: Source): AccessRule[] {
  return user.accessRules.map((rule) => ({
    actionCode: rule.actionCode,
    effect: rule.effect as AccessRule["effect"],
    scope: rule.scope as AccessRule["scope"],
    selectedIds: [...rule.selectedIds].sort(),
  }));
}
function subjectOf(user: Source, rules = rulesOf(user)): AccessSubject {
  return {
    id: user.id,
    isActive: user.isActive,
    roleCodes: user.roles.map((r) => r.role.code),
    permissionCodes: resolveEffectivePermissionCodes(user),
    accessVersion: user.accessVersion,
    accessRules: rules,
  };
}

@Injectable()
export class AccessAdminService {
  constructor(private readonly prisma: PrismaService) {}

  private async accessTransaction<T>(work: (db: Db) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 15_000,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028") {
        throw new ConflictException("Проверка прав не завершилась вовремя. Обновите карточку пользователя, проверьте историю изменений и выполните предварительный просмотр заново.");
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || (error.code === "P2010" && String(error.meta?.code) === "40001"))) {
        throw new ConflictException("Concurrent access change; preview again");
      }
      throw error;
    }
  }

  private async user(db: Db, id: string) {
    const user = await db.user.findFirst({
      where: { id, deletedAt: null },
      select,
    });
    if (!user) throw new NotFoundException("User not found");
    return user;
  }
  private async assertFounder(db: Db, actorId: string) {
    const actor = await this.user(db, actorId);
    const subject = subjectOf(actor);
    if (
      !decideAccess(subject, "auth.access", true, {
        resourceType: "user", resourceId: actor.id, ownerUserId: actor.id,
      }) ||
      !decideAccess(subject, "users_access.manage", actor.roles.some((r) => r.role.code === "founder"))
    )
      throw new ForbiddenException("Founder access required");
    return actor;
  }
  async catalog(actor: AccessSubject) {
    await this.assertFounder(this.prisma, actor.id);
    return {
      actions: ACCESS_ACTION_CATALOG,
      scopes: ["own", "assigned", "selected", "all"],
    };
  }
  async resources(actor: AccessSubject, query: AccessResourceQueryDto) {
    await this.assertFounder(this.prisma, actor.id);
    type Delegate = {
      findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    };
    const registry: Record<
      string,
      {
        model: unknown;
        label: string;
        search: string[];
        softDelete?: boolean;
        description?: string;
      }
    > = {
      object: {
        model: this.prisma.object,
        label: "name",
        search: ["name", "address"],
        softDelete: true,
        description: "address",
      },
      one_time_order: {
        model: this.prisma.oneTimeOrder,
        label: "title",
        search: ["title", "executionAddress"],
        description: "executionAddress",
      },
      user: {
        model: this.prisma.user,
        label: "fullName",
        search: ["fullName", "login"],
        softDelete: true,
        description: "login",
      },
      inventory_item: {
        model: this.prisma.inventoryItem,
        label: "name",
        search: ["name"],
        softDelete: true,
        description: "unit",
      },
      equipment_unit: {
        model: this.prisma.equipmentUnit,
        label: "inventoryNumber",
        search: ["inventoryNumber", "serialNumber"],
        description: "serialNumber",
      },
      counterparty: {
        model: this.prisma.counterparty,
        label: "name",
        search: ["name", "legalName"],
        description: "legalName",
      },
      employee: {
        model: this.prisma.employee,
        label: "fullName",
        search: ["fullName"],
        softDelete: true,
      },
      candidate: {
        model: this.prisma.candidate,
        label: "fullName",
        search: ["fullName"],
        softDelete: true,
      },
      task: {
        model: this.prisma.task,
        label: "title",
        search: ["title"],
        description: "status",
      },
      approval: {
        model: this.prisma.approvalRequest,
        label: "approvalType",
        search: ["approvalType", "sourceEntityType"],
        description: "status",
      },
      chat_room: {
        model: this.prisma.chatRoom,
        label: "title",
        search: ["title", "code"],
        softDelete: true,
        description: "roomType",
      },
      file: {
        model: this.prisma.file,
        label: "originalName",
        search: ["originalName"],
        softDelete: true,
        description: "mimeType",
      },
    };
    const aliases: Record<string, string> = {
      order: "one_time_order",
      item: "inventory_item",
      unit: "equipment_unit",
    };
    const config = registry[aliases[query.resourceType] ?? query.resourceType];
    if (!config) throw new BadRequestException("Unsupported resource type");
    const ids =
      query.ids === undefined
        ? []
        : query.ids.split(",").map((id) => id.trim().toLowerCase());
    if (
      ids.length > 200 ||
      ids.some(
        (id) =>
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
            id,
          ),
      ) ||
      new Set(ids).size !== ids.length
    )
      throw new BadRequestException("Invalid selected resource IDs");
    const q = query.q?.trim();
    const selectedOnly = ids.length > 0 && !q;
    const where = {
      ...(config.softDelete ? { deletedAt: null } : {}),
      ...(selectedOnly
        ? { id: { in: ids } }
        : q
          ? {
              OR: [
                ...config.search.map((field) => ({
                  [field]: { contains: q, mode: "insensitive" },
                })),
                ...(/^[0-9a-f-]{36}$/i.test(q) ? [{ id: q }] : []),
              ],
            }
          : {}),
    };
    const limit = selectedOnly ? ids.length : 30;
    const rows = await (config.model as Delegate).findMany({
      where,
      select: {
        id: true,
        [config.label]: true,
        ...(config.description ? { [config.description]: true } : {}),
      },
      orderBy: [{ [config.label]: "asc" }, { id: "asc" }],
      take: limit + 1,
    });
    return {
      items: rows.slice(0, limit).map((row) => ({
        id: String(row.id),
        label: String(row[config.label] ?? row.id),
        ...(config.description && typeof row[config.description] === "string"
          ? { description: row[config.description] as string }
          : {}),
      })),
      hasMore: rows.length > limit,
    };
  }
  async list(actor: AccessSubject, query: AccessAdminListQueryDto) {
    await this.assertFounder(this.prisma, actor.id);
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.q?.trim()
        ? {
            OR: [
              { fullName: { contains: query.q.trim(), mode: "insensitive" } },
              { login: { contains: query.q.trim(), mode: "insensitive" } },
              {
                roles: {
                  some: {
                    role: {
                      OR: [
                        {
                          code: {
                            contains: query.q.trim(),
                            mode: "insensitive",
                          },
                        },
                        {
                          name: {
                            contains: query.q.trim(),
                            mode: "insensitive",
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select,
        orderBy: [{ fullName: "asc" }, { id: "asc" }],
        skip: query.offset,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items: users.map((user) => this.summary(user)), total };
  }
  private summary(user: Source) {
    return {
      id: user.id,
      login: user.login,
      fullName: user.fullName,
      isActive: user.isActive,
      roleCodes: user.roles.map((r) => r.role.code),
      accessVersion: user.accessVersion,
    };
  }
  private sources(user: Source) {
    return {
      roles: user.roles.map(({ role }) => ({
        code: role.code,
        name: role.name,
        permissionCodes: role.permissions.map((p) => p.permission.code).sort(),
      })),
      userPermissions: user.permissions.map(({ permission }) => ({
        ...permission,
        effect: permission.code === "candidates.denied" ? "deny" : "allow",
        source: "legacy_user_permission",
      })),
      rules: rulesOf(user),
    };
  }
  private async baseline(db: Db, user: Source) {
    const now = new Date();
    const [assignment, receipt, calendar, delegations] = await Promise.all([
      db.oneTimeOrderAssignment.findFirst({
        where: {
          userId: user.id,
          isActive: true,
          assignmentRoleCode: "one_time_manager",
        },
        select: { id: true },
      }),
      db.accountabilityFunding.findFirst({
        where: {
          fundingType: "one_time_order_receipt",
          accountabilityAccount: { userId: user.id },
        },
        select: { id: true },
      }),
      db.oneTimeOrderCalendarManager.findFirst({
        where: { userId: user.id, isVisible: true },
        select: { id: true },
      }),
      db.userSubstitution.findMany({
        where: {
          replacementUserId: user.id,
          revokedAt: null,
          startsAt: { lte: now },
          endsAt: { gt: now },
          principal: { isActive: true, deletedAt: null },
        },
        select: {
          id: true,
          principalUserId: true,
          endsAt: true,
          principal: { select },
          objects: {
            select: {
              object: {
                select: {
                  id: true,
                  deletedAt: true,
                  createdByUserId: true,
                  assignments: {
                    where: { isActive: true },
                    select: {
                      userId: true,
                      isActive: true,
                      assignmentRoleCode: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);
    const projection = buildLegacyAccessProjection(subjectOf(user, []), {
      hasActiveOneTimeManagerAssignment: !!assignment,
      hasHistoricalOneTimeOrderReceipt: !!receipt,
      isConfiguredCalendarManager: !!calendar,
    });
    for (const delegation of delegations) {
      const principal = subjectOf(delegation.principal);
      const defaults = buildLegacyAccessProjection(
        { ...principal, accessRules: [] },
        {
          hasActiveOneTimeManagerAssignment: false,
          hasHistoricalOneTimeOrderReceipt: false,
          isConfiguredCalendarManager: false,
        },
      );
      for (const { object } of delegation.objects) {
        if (object.deletedAt) continue;
        const context = objectPolicyContext(object);
        const legacyView = canViewObjectByScope({
          currentUserId: principal.id,
          roleCodes: [...(principal.roleCodes ?? [])],
          object,
          ownScopeOnly: true,
        });
        if (!decideAccess(principal, "objects.read", legacyView, context))
          continue;
        for (const action of ACCESS_ACTION_CATALOG.filter(
          (action) => action.delegation === "object_only",
        )) {
          const source = defaults.get(action.code);
          if (!source) continue;
          const legacyAllowed =
            source.allowed &&
            source.scopes.some(
              (scope) =>
                scope === "all" ||
                (scope === "own" && object.createdByUserId === principal.id) ||
                (scope === "assigned" &&
                  object.assignments.some(
                    (row) => row.userId === principal.id,
                  )),
            );
          if (!decideAccess(principal, action.code, legacyAllowed, context))
            continue;
          const current = projection.get(action.code);
          if (current?.allowed && current.scopes.includes("all")) continue;
          projection.set(action.code, {
            allowed: true,
            scope: current?.allowed ? current.scope : "selected",
            scopes: [
              ...new Set<LegacyAccessBaseline["scope"]>([
                ...(current?.allowed ? current.scopes : []),
                "selected",
              ]),
            ],
            source: current?.allowed ? current.source : "legacy_delegation",
            evaluator: current?.evaluator ?? "active_object_delegation",
            conditions: [
              ...(current?.conditions ?? []),
              "active_object_delegation",
              "principal_current_policy",
            ],
            selectedIds: [
              ...new Set([...(current?.selectedIds ?? []), object.id]),
            ].sort(),
            delegations: [
              ...(current?.delegations ?? []),
              {
                substitutionId: delegation.id,
                principalUserId: delegation.principalUserId,
                objectId: object.id,
                endsAt: delegation.endsAt.toISOString(),
              },
            ],
          });
        }
      }
    }
    return projection;
  }
  private effectiveRows(
    user: Source,
    rules = rulesOf(user),
    baselines: Map<string, LegacyAccessBaseline> = new Map(),
  ) {
    const subject = subjectOf(user, rules);
    return ACCESS_ACTION_CATALOG.map((action) => {
      const rule = rules.find((r) => r.actionCode === action.code) ?? null;
      const baseline = baselines.get(action.code) ?? null;
      const summary = summarizeAccess(subject, action.code, baseline);
      const blocked = summary.blocked;
      let allowed = summary.allowed;
      let source = blocked ? "deny" : baseline?.source ?? "legacy_policy";
      if (action.constraint === "logout_always_available") {
        allowed = true;
        source = "system_invariant";
      } else if (action.code === "candidates.denied") {
        allowed =
          subject.permissionCodes?.includes("candidates.denied") === true;
        source = "legacy_negative";
      } else if (
        ["users_access.access", "users_access.manage"].includes(action.code)
      ) {
        allowed = decideAccess(
          subject,
          action.code,
          user.roles.some((r) => r.role.code === "founder"),
        );
        source = "founder_role";
      } else if (!blocked && rule?.scope === "all") {
        source = "personal_" + rule.effect;
      } else if (!blocked && rule) {
        source = "personal_" + rule.effect + "_scoped";
      }
      const warnings: string[] = [];
      if (action.constraint) warnings.push(action.constraint);
      if (allowed === null)
        warnings.push("requires_legacy_policy_and_resource_context");
      if (rule?.effect === "allow" && blocked)
        warnings.push("ineffective_child_allow_parent_or_legacy_deny");
      if (summary.personalAllowFullyDenied)
        warnings.push("personal_allow_scope_fully_denied");
      if (
        rule?.effect === "allow" &&
        action.parentAction &&
        rules.some(
          (parent) =>
            parent.actionCode === action.parentAction &&
            parent.effect === "deny" &&
            parent.scope !== "all",
        )
      )
        warnings.push("parent_scope_deny_applies_where_scopes_overlap");
      return {
        actionCode: action.code,
        allowed,
        source,
        baseline,
        effectiveScopes: {
          inherited: baseline?.allowed ? baseline.scopes : [],
          personalAllow:
            rule?.effect === "allow"
              ? { scope: rule.scope, selectedIds: rule.selectedIds }
              : null,
          personalDeny:
            rule?.effect === "deny"
              ? { scope: rule.scope, selectedIds: rule.selectedIds }
              : null,
          parentDenies: rules.filter(
            (parent) =>
              parent.actionCode === action.parentAction &&
              parent.effect === "deny",
          ),
        },
        rule,
        scope: summary.scope,
        selectedIds: summary.selectedIds,
        warnings,
      };
    });
  }
  async effective(actor: AccessSubject, id: string) {
    await this.assertFounder(this.prisma, actor.id);
    const user = await this.user(this.prisma, id);
    return {
      accessVersion: user.accessVersion,
      rules: rulesOf(user),
      effective: this.effectiveRows(
        user,
        undefined,
        await this.baseline(this.prisma, user),
      ),
      sources: this.sources(user),
    };
  }
  async detail(actor: AccessSubject, id: string) {
    await this.assertFounder(this.prisma, actor.id);
    const user = await this.user(this.prisma, id);
    return {
      user: this.summary(user),
      accessVersion: user.accessVersion,
      rules: rulesOf(user),
      effective: this.effectiveRows(
        user,
        undefined,
        await this.baseline(this.prisma, user),
      ),
      sources: this.sources(user),
      assignments: await this.loadAssignments(this.prisma, id),
    };
  }
  private async loadAssignments(db: Db, id: string) {
    const [objects, oneTimeOrders, substitutions] = await Promise.all([
      db.objectAssignment.findMany({
        where: { userId: id },
        select: {
          id: true,
          objectId: true,
          assignmentRoleCode: true,
          isActive: true,
          createdAt: true,
          object: { select: { name: true, deletedAt: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      db.oneTimeOrderAssignment.findMany({
        where: { userId: id },
        select: {
          id: true,
          oneTimeOrderId: true,
          assignmentRoleCode: true,
          isActive: true,
          createdAt: true,
          oneTimeOrder: { select: { title: true, status: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      db.userSubstitution.findMany({
        where: { OR: [{ principalUserId: id }, { replacementUserId: id }] },
        include: { objects: { select: { objectId: true } } },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return {
      objects,
      oneTimeOrders,
      substitutions: substitutions.map((row) => ({
        ...row,
        objects: row.objects.sort((a, b) =>
          a.objectId.localeCompare(b.objectId),
        ),
      })),
    };
  }
  async assignments(actor: AccessSubject, id: string) {
    await this.assertFounder(this.prisma, actor.id);
    await this.user(this.prisma, id);
    return this.loadAssignments(this.prisma, id);
  }
  async history(
    actor: AccessSubject,
    id: string,
    query: AccessAdminListQueryDto,
  ) {
    await this.assertFounder(this.prisma, actor.id);
    await this.user(this.prisma, id);
    const where = { userId: id };
    const [items, total] = await Promise.all([
      this.prisma.userAccessAudit.findMany({
        where,
        include: {
          actor: { select: { id: true, fullName: true, login: true } },
        },
        orderBy: { versionAfter: "desc" },
        skip: query.offset,
        take: query.limit,
      }),
      this.prisma.userAccessAudit.count({ where }),
    ]);
    return { items, total };
  }
  private normalize(input: PreviewAccessDto): {
    expectedVersion: number;
    reason: string;
    changes: AccessChange[];
  } {
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 0
    )
      throw new BadRequestException("Invalid access version");
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (!reason || reason.length > 2000)
      throw new BadRequestException("Reason is required");
    if (
      !Array.isArray(input.changes) ||
      input.changes.length === 0 ||
      input.changes.length > 300
    )
      throw new BadRequestException("Changes required");
    const seen = new Set<string>();
    const changes = input.changes
      .map((change) => {
        const action = getAccessAction(change.actionCode);
        if (!action || seen.has(change.actionCode))
          throw new BadRequestException("Unknown or duplicate action code");
        seen.add(change.actionCode);
        if (
          !["allow", "deny", "default"].includes(change.effect) ||
          !action.allowedScopes.includes(change.scope)
        )
          throw new BadRequestException("Unsupported action scope or effect");
        if (change.effect !== "default" && !action.manageable)
          throw new BadRequestException(
            `Action is constrained: ${action.code}`,
          );
        if (
          change.effect !== "default" &&
          !(action.managementScopes ?? action.allowedScopes).includes(change.scope)
        )
          throw new BadRequestException(
            `Область «Назначенные» недоступна для новых или изменяемых правил «${action.name}». Прежнее правило сохраняется без изменения; для его снятия выберите «По умолчанию».`,
          );
        if (
          change.selectedIds !== undefined &&
          !Array.isArray(change.selectedIds)
        )
          throw new BadRequestException("Invalid selected IDs");
        const ids = change.selectedIds ?? [];
        if (
          ids.length > 200 ||
          ids.some(
            (id) =>
              typeof id !== "string" ||
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                id,
              ),
          ) ||
          new Set(ids.map((id) => id.toLowerCase())).size !== ids.length
        )
          throw new BadRequestException("Invalid selected IDs");
        if (
          (change.scope === "selected" && ids.length === 0) ||
          (change.scope !== "selected" && ids.length > 0)
        )
          throw new BadRequestException(
            "Selected scope requires nonempty IDs and only selected accepts IDs",
          );
        return {
          actionCode: change.actionCode,
          effect: change.effect,
          scope: change.scope,
          selectedIds: ids.map((id) => id.toLowerCase()).sort(),
        };
      })
      .sort((a, b) => a.actionCode.localeCompare(b.actionCode));
    return { expectedVersion: input.expectedVersion, reason, changes };
  }
  private apply(user: Source, changes: AccessChange[]) {
    const rules = new Map(rulesOf(user).map((rule) => [rule.actionCode, rule]));
    for (const change of changes) {
      if (change.effect === "default") rules.delete(change.actionCode);
      else
        rules.set(change.actionCode, {
          actionCode: change.actionCode,
          effect: change.effect,
          scope: change.scope,
          selectedIds: change.selectedIds ?? [],
        });
    }
    return [...rules.values()].sort((a, b) =>
      a.actionCode.localeCompare(b.actionCode),
    );
  }
  private async validateSelected(db: Db, changes: AccessChange[]) {
    for (const change of changes) {
      if (change.scope !== "selected") continue;
      const ids = change.selectedIds ?? [];
      const type = getAccessAction(change.actionCode)!.resourceType;
      let count: number;
      if (type === "object")
        count = await db.object.count({
          where: { id: { in: ids }, deletedAt: null },
        });
      else if (type === "one_time_order")
        count = await db.oneTimeOrder.count({ where: { id: { in: ids } } });
      else if (type === "user")
        count = await db.user.count({
          where: { id: { in: ids }, deletedAt: null },
        });
      else if (type === "inventory_item")
        count = await db.inventoryItem.count({ where: { id: { in: ids } } });
      else if (type === "equipment_unit")
        count = await db.equipmentUnit.count({ where: { id: { in: ids } } });
      else if (type === "counterparty")
        count = await db.counterparty.count({ where: { id: { in: ids } } });
      else if (type === "employee")
        count = await db.employee.count({ where: { id: { in: ids } } });
      else if (type === "candidate")
        count = await db.candidate.count({ where: { id: { in: ids } } });
      else if (type === "task")
        count = await db.task.count({ where: { id: { in: ids } } });
      else if (type === "approval")
        count = await db.approvalRequest.count({ where: { id: { in: ids } } });
      else if (type === "chat_room")
        count = await db.chatRoom.count({ where: { id: { in: ids } } });
      else if (type === "file")
        count = await db.file.count({ where: { id: { in: ids } } });
      else
        throw new BadRequestException(
          "Selected scope unsupported for resource",
        );
      if (count !== ids.length)
        throw new BadRequestException("Selected resource does not exist");
    }
  }
  private async protectFounder(db: Db, user: Source, rules: AccessRule[]) {
    const usable = (candidate: Source, candidateRules = rulesOf(candidate)) => {
      const subject = subjectOf(candidate, candidateRules);
      const context = {
        resourceType: "user",
        resourceId: candidate.id,
        ownerUserId: candidate.id,
      };
      return [
        "users_access.manage",
        "auth.access",
        "auth.login",
        "auth.me",
        "auth.refresh",
      ].every((code) => decideAccess(subject, code, true, context));
    };
    if (
      !user.isActive ||
      !user.roles.some((r) => r.role.code === "founder") ||
      usable(user, rules)
    )
      return;
    const founders = await db.user.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        roles: { some: { role: { code: "founder" } } },
      },
      select,
    });
    if (!founders.some((founder) => founder.id !== user.id && usable(founder)))
      throw new ForbiddenException(
        "Cannot deny access to the last active founder administrator",
      );
  }
  private async baseHash(db: Db, user: Source, baseline: Map<string, LegacyAccessBaseline>) {
    return hash({
      user,
      sources: this.sources(user),
      assignments: await this.loadAssignments(db, user.id),
      baseline: [...baseline.entries()],
    });
  }
  async preview(actor: AccessSubject, id: string, input: PreviewAccessDto) {
    const payload = this.normalize(input);
    return this.accessTransaction(
      async (db) => {
        const admin = await this.assertFounder(db, actor.id);
        const user = await this.user(db, id);
        if (user.accessVersion !== payload.expectedVersion)
          throw new ConflictException("Access version changed");
        await this.validateSelected(db, payload.changes);
        const rules = this.apply(user, payload.changes);
        await this.protectFounder(db, user, rules);
        const baseline = await this.baseline(db, user);
        const baseHash = await this.baseHash(db, user, baseline);
        const previewHash = hash({
          actorId: actor.id,
          actorAccessVersion: admin.accessVersion,
          userId: id,
          payload,
          baseHash,
          rules,
        });
        const previewToken = randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        await db.userAccessPreview.create({
          data: {
            userId: id,
            actorUserId: actor.id,
            tokenHash: hash(previewToken),
            previewHash,
            expectedVersion: user.accessVersion,
            baseHash,
            payload: payload as unknown as Prisma.InputJsonValue,
            expiresAt,
          },
        });
        const effective = this.effectiveRows(
          user,
          rules,
          baseline,
        );
        return {
          previewToken,
          previewHash,
          expiresAt,
          expectedVersion: user.accessVersion,
          changes: payload.changes,
          warnings: [
            ...new Set(
              effective
                .filter((row) =>
                  payload.changes.some((c) => c.actionCode === row.actionCode),
                )
                .flatMap((row) => row.warnings),
            ),
          ],
          effective,
        };
      },
    );
  }
  async save(actor: AccessSubject, id: string, input: SaveAccessDto) {
    const payload = this.normalize(input);
    if (
      !/^[0-9a-f]{64}$/.test(input.previewToken) ||
      !/^[0-9a-f]{64}$/.test(input.previewHash)
    )
      throw new BadRequestException("Invalid preview token/hash");
    try {
      return await this.accessTransaction(
        async (db) => {
          // Serializes administrative writes and last-founder checks across target users.
          // Do not return the lock function's PostgreSQL void value to Prisma.
          await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(20261106, 100000)`;
          const admin = await this.assertFounder(db, actor.id);
          // A serializable snapshot can predate the advisory-lock wait.
          // The row lock rejects that snapshot if this founder was changed first.
          await lockActorAccessRevision(db, { id: admin.id, accessVersion: admin.accessVersion });
          const user = await this.user(db, id);
          if (user.accessVersion !== payload.expectedVersion)
            throw new ConflictException("Access version changed");
          const preview = await db.userAccessPreview.findUnique({
            where: { tokenHash: hash(input.previewToken) },
          });
          if (
            !preview ||
            preview.actorUserId !== actor.id ||
            preview.userId !== id ||
            preview.usedAt ||
            preview.expiresAt <= new Date() ||
            preview.previewHash !== input.previewHash ||
            preview.expectedVersion !== payload.expectedVersion ||
            hash(preview.payload) !== hash(payload)
          )
            throw new ConflictException(
              "Preview is expired, changed or already used",
            );
          await this.validateSelected(db, payload.changes);
          const rules = this.apply(user, payload.changes);
          await this.protectFounder(db, user, rules);
          const baseline = await this.baseline(db, user);
          const baseHash = await this.baseHash(db, user, baseline);
          if (
            baseHash !== preview.baseHash ||
            hash({
              actorId: actor.id,
              actorAccessVersion: admin.accessVersion,
              userId: id,
              payload,
              baseHash,
              rules,
            }) !== preview.previewHash
          )
            throw new ConflictException(
              "Access sources or assignments changed; preview again",
            );
          const changed = await db.user.updateMany({
            where: { id, accessVersion: payload.expectedVersion },
            data: { accessVersion: { increment: 1 } },
          });
          if (changed.count !== 1)
            throw new ConflictException("Access version changed");
          for (const change of payload.changes) {
            if (change.effect === "default")
              await db.userAccessRule.deleteMany({
                where: { userId: id, actionCode: change.actionCode },
              });
            else
              await db.userAccessRule.upsert({
                where: {
                  userId_actionCode: {
                    userId: id,
                    actionCode: change.actionCode,
                  },
                },
                create: {
                  userId: id,
                  actionCode: change.actionCode,
                  effect: change.effect,
                  scope: change.scope,
                  selectedIds: change.selectedIds ?? [],
                },
                update: {
                  effect: change.effect,
                  scope: change.scope,
                  selectedIds: change.selectedIds ?? [],
                },
              });
          }
          if (payload.changes.some(({ actionCode, effect }) =>
            effect === "deny" && (actionCode === "auth.access" || actionCode === "auth.refresh")
          ) && !decideAccess(subjectOf(user, rules), "auth.refresh", true, {
            resourceType: "user", resourceId: id, ownerUserId: id,
          })) {
            // Include rotations committed before the deny whose Set-Cookie
            // headers might still be in transit.
            const now = new Date();
            await db.authSession.updateMany({
              where: { userId: id, revokedAt: null, expiresAt: { gt: now } },
              data: { revokedAt: now },
            });
          }
          await db.userAccessAudit.create({
            data: {
              userId: id,
              actorUserId: actor.id,
              versionBefore: user.accessVersion,
              versionAfter: user.accessVersion + 1,
              reason: payload.reason,
              before: rulesOf(user) as unknown as Prisma.InputJsonValue,
              after: rules as unknown as Prisma.InputJsonValue,
              changes: payload.changes as unknown as Prisma.InputJsonValue,
              previewHash: preview.previewHash,
            },
          });
          await db.userAccessPreview.update({
            where: { id: preview.id },
            data: { usedAt: new Date() },
          });
          return {
            accessVersion: user.accessVersion + 1,
            rules,
            effective: this.effectiveRows(
              user,
              rules,
              baseline,
            ),
          };
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      )
        throw new ConflictException("Concurrent access change; preview again");
      throw error;
    }
  }
}
