import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { decideAccess, type AccessSubject } from '../users-access/utils/access-policy.util';
import { lockActorAccessRevision } from '../../common/access/lock-actor-access-revision';
import { projectCommittedWrite } from '../../common/access/project-committed-write';
import { loadAccessSubject } from '../../common/access/notification-access';

import { PrismaService } from "../prisma/prisma.service";
import {
  CreateSpecificationCatalogItemDto,
  CreateSpecificationTemplateDto,
  SpecificationCatalogItemResponseDto,
  SpecificationTemplateResponseDto,
  UpdateSpecificationCatalogItemDto,
  UpdateSpecificationTemplateDto,
} from "./dto/specification-catalog.dto";

interface CurrentAuthUser extends AccessSubject {
  id: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
}

const LEADERSHIP_ROLES = [
  "founder",
  "deputy_founder",
  "director",
  "corporate_director",
] as const;

@Injectable()
export class OneTimeOrderSpecificationCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listItems(
    user: CurrentAuthUser,
  ): Promise<SpecificationCatalogItemResponseDto[]> {
    this.assertCanRead(user);
    const rows =
      await this.prisma.oneTimeOrderSpecificationCatalogItem.findMany({
        where: this.isLeadership(user) ? {} : { isArchived: false },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      });
    return rows.map((row) => this.mapItem(row));
  }

  async createItem(
    user: CurrentAuthUser,
    payload: CreateSpecificationCatalogItemDto,
  ) {
    this.assertLeadership(user);
    this.assertLeaf(user, 'specification_catalog.create');
    const created = await this.prisma.$transaction(async (tx) => {
      await this.lockCatalogWrite(tx, user);
      this.assertLeaf(user, 'specification_catalog.create');
      const row = await tx.oneTimeOrderSpecificationCatalogItem.create({
        data: {
          title: payload.title.trim(),
          description: payload.description?.trim() || null,
          sortOrder: payload.sortOrder ?? 0,
          createdByUserId: user.id,
          updatedByUserId: user.id,
        },
      });
      await this.audit(
        tx,
        user.id,
        row.id,
        "one_time_order.specification_catalog_item_created",
        null,
        row,
      );
      return row;
    });
    return this.projectCatalogResult(user, this.mapItem(created));
  }

  async updateItem(
    user: CurrentAuthUser,
    id: string,
    payload: UpdateSpecificationCatalogItemDto,
  ) {
    this.assertLeadership(user);
    this.assertMutation(user, payload);
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockCatalogWrite(tx, user, 'item', id);
      this.assertMutation(user, payload);
      const existing = await tx.oneTimeOrderSpecificationCatalogItem.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException("Specification catalog item not found");
      const row = await tx.oneTimeOrderSpecificationCatalogItem.update({
        where: { id },
        data: {
          ...(payload.title !== undefined
            ? { title: payload.title.trim() }
            : {}),
          ...(payload.description !== undefined
            ? { description: payload.description?.trim() || null }
            : {}),
          ...(payload.sortOrder !== undefined
            ? { sortOrder: payload.sortOrder }
            : {}),
          ...(payload.isArchived !== undefined
            ? { isArchived: payload.isArchived }
            : {}),
          updatedByUserId: user.id,
        },
      });
      const action =
        payload.isArchived === true
          ? "one_time_order.specification_catalog_item_archived"
          : payload.isArchived === false
            ? "one_time_order.specification_catalog_item_restored"
            : "one_time_order.specification_catalog_item_updated";
      await this.audit(tx, user.id, id, action, existing, row);
      return row;
    });
    return this.projectCatalogResult(user, this.mapItem(updated));
  }

  async archiveItem(user: CurrentAuthUser, id: string) {
    this.assertLeadership(user);
    this.assertLeaf(user, 'specification_catalog.archive');
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockCatalogWrite(tx, user, 'item', id);
      this.assertLeaf(user, 'specification_catalog.archive');
      const existing = await tx.oneTimeOrderSpecificationCatalogItem.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException("Specification catalog item not found");
      const row = await tx.oneTimeOrderSpecificationCatalogItem.update({
        where: { id },
        data: { isArchived: true, updatedByUserId: user.id },
      });
      await this.audit(
        tx,
        user.id,
        id,
        "one_time_order.specification_catalog_item_archived",
        existing,
        row,
      );
      return row;
    });
    return this.projectCatalogResult(user, this.mapItem(updated));
  }

  async listTemplates(
    user: CurrentAuthUser,
  ): Promise<SpecificationTemplateResponseDto[]> {
    this.assertCanRead(user);
    const rows = await this.prisma.oneTimeOrderSpecificationTemplate.findMany({
      where: this.isLeadership(user) ? {} : { isArchived: false },
      include: {
        items: {
          include: { catalogItem: true },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => this.mapTemplate(row));
  }

  async createTemplate(
    user: CurrentAuthUser,
    payload: CreateSpecificationTemplateDto,
  ) {
    this.assertLeadership(user);
    this.assertLeaf(user, 'specification_catalog.create');
    const created = await this.prisma.$transaction(async (tx) => {
      await this.lockCatalogWrite(tx, user);
      this.assertLeaf(user, 'specification_catalog.create');
      await this.assertCatalogItemIds(
        tx,
        payload.items.map((item) => item.catalogItemId),
      );
      const row = await tx.oneTimeOrderSpecificationTemplate.create({
        data: {
          name: payload.name.trim(),
          createdByUserId: user.id,
          updatedByUserId: user.id,
          items: {
            create: payload.items.map((item) => ({
              catalogItemId: item.catalogItemId,
              sortOrder: item.sortOrder,
            })),
          },
        },
        include: {
          items: {
            include: { catalogItem: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      });
      await this.audit(
        tx,
        user.id,
        row.id,
        "one_time_order.specification_template_created",
        null,
        this.templateAuditValues(row),
      );
      return row;
    }).catch((error: unknown) => this.rethrowTemplateNameConflict(error));
    return this.projectCatalogResult(user, this.mapTemplate(created));
  }

  async updateTemplate(
    user: CurrentAuthUser,
    id: string,
    payload: UpdateSpecificationTemplateDto,
  ) {
    this.assertLeadership(user);
    this.assertMutation(user, payload);
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockCatalogWrite(tx, user, 'template', id);
      this.assertMutation(user, payload);
      const existing = await tx.oneTimeOrderSpecificationTemplate.findUnique({
        where: { id }, include: { items: { include: { catalogItem: true }, orderBy: { sortOrder: "asc" } } },
      });
      if (!existing) throw new NotFoundException("Specification template not found");
      if (payload.items)
        await this.assertCatalogItemIds(
          tx,
          payload.items.map((item) => item.catalogItemId),
        );
      const claim = await tx.oneTimeOrderSpecificationTemplate.updateMany({
        where: { id, version: payload.expectedVersion },
        data: {
          version: { increment: 1 },
          ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
          ...(payload.isArchived !== undefined
            ? { isArchived: payload.isArchived }
            : {}),
          updatedByUserId: user.id,
        },
      });
      if (claim.count === 0)
        throw new ConflictException(
          "Шаблон уже изменён другим пользователем. Обновите данные и повторите правку.",
        );
      if (payload.items) {
        await tx.oneTimeOrderSpecificationTemplateItem.deleteMany({
          where: { templateId: id },
        });
        await tx.oneTimeOrderSpecificationTemplateItem.createMany({
          data: payload.items.map((item) => ({
            templateId: id,
            catalogItemId: item.catalogItemId,
            sortOrder: item.sortOrder,
          })),
        });
      }
      const row = await tx.oneTimeOrderSpecificationTemplate.findUniqueOrThrow({
        where: { id },
        include: {
          items: {
            include: { catalogItem: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      });
      const action =
        payload.isArchived === true
          ? "one_time_order.specification_template_archived"
          : payload.isArchived === false
            ? "one_time_order.specification_template_restored"
            : "one_time_order.specification_template_updated";
      await this.audit(
        tx,
        user.id,
        id,
        action,
        this.templateAuditValues(existing),
        this.templateAuditValues(row),
      );
      return row;
    }).catch((error: unknown) => this.rethrowTemplateNameConflict(error));
    return this.projectCatalogResult(user, this.mapTemplate(updated));
  }

  async archiveTemplate(
    user: CurrentAuthUser,
    id: string,
    expectedVersion: number,
  ) {
    this.assertLeadership(user);
    return this.updateTemplate(user, id, { expectedVersion, isArchived: true });
  }

  private rethrowTemplateNameConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      Array.isArray(error.meta?.target) &&
      error.meta.target.length === 1 &&
      error.meta.target[0] === "name"
    ) {
      throw new ConflictException({
        code: "SPECIFICATION_TEMPLATE_NAME_CONFLICT",
        message: "Шаблон с таким названием уже существует. Введите другое название.",
      });
    }
    throw error;
  }

  private async lockCatalogWrite(tx: Prisma.TransactionClient, user: CurrentAuthUser, kind?: 'item' | 'template', id?: string): Promise<void> {
    if (id && kind === 'item') await tx.$queryRaw`SELECT "id" FROM "one_time_order_specification_catalog_items" WHERE "id" = ${id} FOR UPDATE`;
    if (id && kind === 'template') await tx.$queryRaw`SELECT "id" FROM "one_time_order_specification_templates" WHERE "id" = ${id} FOR UPDATE`;
    await lockActorAccessRevision(tx, user);
    this.assertLeadership(user);
  }

  private projectCatalogResult<T>(user: CurrentAuthUser, value: T) {
    return projectCommittedWrite(this.prisma, user, async () => {
      const subject = await loadAccessSubject(this.prisma, user.id);
      if (!subject?.isActive) throw new ForbiddenException('Доступ к каталогу изменился');
      this.assertCanRead({ ...user, ...subject, roleCode: subject.roleCodes?.[0] ?? '',
        roleCodes: [...(subject.roleCodes ?? [])], permissionCodes: [...(subject.permissionCodes ?? [])] });
      return value;
    });
  }

  private assertCanRead(user: CurrentAuthUser) {
    this.assertLeadership(user);
    if (!decideAccess(user, 'specification_catalog.read', true)) throw new ForbiddenException('Specification catalog read denied');
  }

  private assertMutation(user: CurrentAuthUser, payload: object & { isArchived?: boolean }): void {
    if (payload.isArchived === true) this.assertLeaf(user, 'specification_catalog.archive');
    if (payload.isArchived !== true || Object.keys(payload).some(key => !['expectedVersion', 'isArchived'].includes(key))) this.assertLeaf(user, 'specification_catalog.update');
  }

  private assertLeaf(user: CurrentAuthUser, actionCode: string): void {
    if (!decideAccess(user, actionCode, this.isLeadership(user))) throw new ForbiddenException('Specification catalog action denied');
  }

  private isLeadership(user: CurrentAuthUser) {
    return (user.roleCodes ?? [user.roleCode]).some((role) =>
      LEADERSHIP_ROLES.includes(role as never),
    );
  }

  private assertLeadership(user: CurrentAuthUser) {
    if (!decideAccess(user, 'specification_catalog.access', this.isLeadership(user)))
      throw new ForbiddenException("Leadership circle access required");
  }

  private async assertCatalogItemIds(
    tx: Prisma.TransactionClient,
    ids: string[],
  ) {
    const found = await tx.oneTimeOrderSpecificationCatalogItem.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (found.length !== new Set(ids).size)
      throw new NotFoundException("Specification catalog item not found");
  }

  private async audit(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    entityId: string,
    action: string,
    oldValues: unknown,
    newValues: unknown,
  ) {
    await tx.auditEvent.create({
      data: {
        entityType: "one_time_order_specification_catalog",
        entityId,
        actorUserId,
        action,
        oldValues:
          oldValues === null
            ? Prisma.JsonNull
            : (oldValues as Prisma.InputJsonValue),
        newValues:
          newValues === null
            ? Prisma.JsonNull
            : (newValues as Prisma.InputJsonValue),
      },
    });
  }

  private mapItem(row: {
    id: string;
    title: string;
    description: string | null;
    sortOrder: number;
    isArchived: boolean;
    updatedAt: Date;
  }): SpecificationCatalogItemResponseDto {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      sortOrder: row.sortOrder,
      isArchived: row.isArchived,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapTemplate(row: any): SpecificationTemplateResponseDto {
    return {
      id: row.id,
      name: row.name,
      isArchived: row.isArchived,
      version: row.version,
      items: row.items.map((item: any) => ({
        catalogItemId: item.catalogItemId,
        title: item.catalogItem.title,
        description: item.catalogItem.description,
        sortOrder: item.sortOrder,
      })),
    };
  }

  private templateAuditValues(row: any) {
    return {
      name: row.name,
      isArchived: row.isArchived,
      items: row.items.map((item: any) => ({
        catalogItemId: item.catalogItemId,
        sortOrder: item.sortOrder,
        title: item.catalogItem.title,
      })),
    };
  }
}
