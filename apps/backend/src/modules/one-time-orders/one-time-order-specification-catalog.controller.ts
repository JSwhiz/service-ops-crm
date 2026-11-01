import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";

import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import {
  CreateSpecificationCatalogItemDto,
  CreateSpecificationTemplateDto,
  UpdateSpecificationCatalogItemDto,
  UpdateSpecificationTemplateDto,
} from "./dto/specification-catalog.dto";
import { OneTimeOrderSpecificationCatalogService } from "./one-time-order-specification-catalog.service";

interface CurrentAuthUser {
  id: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
}

@UseGuards(JwtAuthGuard)
@Controller("one-time-orders")
export class OneTimeOrderSpecificationCatalogController {
  constructor(
    private readonly catalog: OneTimeOrderSpecificationCatalogService,
  ) {}

  @Get("specification-catalog")
  listItems(@CurrentUser() user: CurrentAuthUser) {
    return this.catalog.listItems(user);
  }

  @Post("specification-catalog")
  createItem(
    @CurrentUser() user: CurrentAuthUser,
    @Body() payload: CreateSpecificationCatalogItemDto,
  ) {
    return this.catalog.createItem(user, payload);
  }

  @Patch("specification-catalog/:id")
  updateItem(
    @CurrentUser() user: CurrentAuthUser,
    @Param("id") id: string,
    @Body() payload: UpdateSpecificationCatalogItemDto,
  ) {
    return this.catalog.updateItem(user, id, payload);
  }

  @Delete("specification-catalog/:id")
  archiveItem(@CurrentUser() user: CurrentAuthUser, @Param("id") id: string) {
    return this.catalog.archiveItem(user, id);
  }

  @Get("specification-templates")
  listTemplates(@CurrentUser() user: CurrentAuthUser) {
    return this.catalog.listTemplates(user);
  }

  @Post("specification-templates")
  createTemplate(
    @CurrentUser() user: CurrentAuthUser,
    @Body() payload: CreateSpecificationTemplateDto,
  ) {
    return this.catalog.createTemplate(user, payload);
  }

  @Patch("specification-templates/:id")
  updateTemplate(
    @CurrentUser() user: CurrentAuthUser,
    @Param("id") id: string,
    @Body() payload: UpdateSpecificationTemplateDto,
  ) {
    return this.catalog.updateTemplate(user, id, payload);
  }

  @Delete("specification-templates/:id")
  archiveTemplate(
    @CurrentUser() user: CurrentAuthUser,
    @Param("id") id: string,
    @Body() payload: UpdateSpecificationTemplateDto,
  ) {
    return this.catalog.archiveTemplate(user, id, payload.expectedVersion);
  }
}
