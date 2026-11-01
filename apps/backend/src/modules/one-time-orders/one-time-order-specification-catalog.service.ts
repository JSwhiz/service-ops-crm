import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import {
  CreateSpecificationCatalogItemDto,
  CreateSpecificationTemplateDto,
  SpecificationCatalogItemResponseDto,
  SpecificationTemplateResponseDto,
  UpdateSpecificationCatalogItemDto,
  UpdateSpecificationTemplateDto,
} from "./dto/specification-catalog.dto";

interface CurrentAuthUser {
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
    const created = await this.prisma.$transaction(async (tx) => {
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
    return this.mapItem(created);
  }

  async updateItem(
    user: CurrentAuthUser,
    id: string,
    payload: UpdateSpecificationCatalogItemDto,
  ) {
    this.assertLeadership(user);
    const existing =
      await this.prisma.oneTimeOrderSpecificationCatalogItem.findUnique({
        where: { id },
      });
    if (!existing)
      throw new NotFoundException("Specification catalog item not found");
    const updated = await this.prisma.$transaction(async (tx) => {
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
    return this.mapItem(updated);
  }

  async archiveItem(user: CurrentAuthUser, id: string) {
    this.assertLeadership(user);
    const existing =
      await this.prisma.oneTimeOrderSpecificationCatalogItem.findUnique({
        where: { id },
      });
    if (!existing)
      throw new NotFoundException("Specification catalog item not found");
    const updated = await this.prisma.$transaction(async (tx) => {
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
    return this.mapItem(updated);
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
    const created = await this.prisma.$transaction(async (tx) => {
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
    });
    return this.mapTemplate(created);
  }

  async updateTemplate(
    user: CurrentAuthUser,
    id: string,
    payload: UpdateSpecificationTemplateDto,
  ) {
    this.assertLeadership(user);
    const existing =
      await this.prisma.oneTimeOrderSpecificationTemplate.findUnique({
        where: { id },
        include: {
          items: {
            include: { catalogItem: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      });
    if (!existing)
      throw new NotFoundException("Specification template not found");
    const updated = await this.prisma.$transaction(async (tx) => {
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
    });
    return this.mapTemplate(updated);
  }

  async archiveTemplate(
    user: CurrentAuthUser,
    id: string,
    expectedVersion: number,
  ) {
    this.assertLeadership(user);
    return this.updateTemplate(user, id, { expectedVersion, isArchived: true });
  }

  private assertCanRead(user: CurrentAuthUser) {
    this.assertLeadership(user);
  }

  private isLeadership(user: CurrentAuthUser) {
    return (user.roleCodes ?? [user.roleCode]).some((role) =>
      LEADERSHIP_ROLES.includes(role as never),
    );
  }

  private assertLeadership(user: CurrentAuthUser) {
    if (!this.isLeadership(user))
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
