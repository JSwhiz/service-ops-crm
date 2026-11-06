import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AccessAdminService } from "./access-admin.service";
import {
  AccessAdminListQueryDto,
  AccessResourceQueryDto,
  PreviewAccessDto,
  SaveAccessDto,
} from "./dto/access-admin.dto";
import { AccessSubject } from "./types/access-policy.type";

@UseGuards(JwtAuthGuard)
@Controller("users-access/admin")
export class AccessAdminController {
  constructor(private readonly service: AccessAdminService) {}
  @Get("catalog") catalog(@CurrentUser() actor: AccessSubject) {
    return this.service.catalog(actor);
  }
  @Get("users") list(
    @CurrentUser() actor: AccessSubject,
    @Query() query: AccessAdminListQueryDto,
  ) {
    return this.service.list(actor, query);
  }
  @Get("resources") resources(
    @CurrentUser() actor: AccessSubject,
    @Query() query: AccessResourceQueryDto,
  ) {
    return this.service.resources(actor, query);
  }
  @Get("users/:id") detail(
    @CurrentUser() actor: AccessSubject,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.detail(actor, id);
  }
  @Get("users/:id/effective") effective(
    @CurrentUser() actor: AccessSubject,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.effective(actor, id);
  }
  @Get("users/:id/assignments") assignments(
    @CurrentUser() actor: AccessSubject,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.assignments(actor, id);
  }
  @Get("users/:id/history") history(
    @CurrentUser() actor: AccessSubject,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: AccessAdminListQueryDto,
  ) {
    return this.service.history(actor, id, query);
  }
  @Post("users/:id/preview") preview(
    @CurrentUser() actor: AccessSubject,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: PreviewAccessDto,
  ) {
    return this.service.preview(actor, id, input);
  }
  @Post("users/:id/save") save(
    @CurrentUser() actor: AccessSubject,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: SaveAccessDto,
  ) {
    return this.service.save(actor, id, input);
  }
}
