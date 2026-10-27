import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import {
  CreateVisitPlanDto,
  RecordVisitDto,
  SaveVisitPlanEntryDto,
  SaveVisitPlanReportDto,
  SaveVisitPlanDeadlineDto,
  VisitPlanVersionDto,
  VisitPlanQueryDto,
} from "./dto/visit-plan.dto";
import { VisitPlansService, VisitPlanUser } from "./visit-plans.service";

@UseGuards(JwtAuthGuard)
@Controller("visit-plans")
export class VisitPlansController {
  constructor(private readonly plans: VisitPlansService) {}

  @Get("managers")
  managers(@CurrentUser() user: VisitPlanUser) {
    return this.plans.listManagers(user);
  }

  @Get()
  day(@CurrentUser() user: VisitPlanUser, @Query() query: VisitPlanQueryDto) {
    return this.plans.getDay(user, query.date, query.managerUserId);
  }

  @Post()
  create(
    @CurrentUser() user: VisitPlanUser,
    @Body() input: CreateVisitPlanDto,
  ) {
    return this.plans.create(user, input);
  }

  @Post(":id/entries")
  add(
    @CurrentUser() user: VisitPlanUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: SaveVisitPlanEntryDto,
  ) {
    return this.plans.addEntry(user, id, input);
  }

  @Patch(":id/entries/:entryId/visit")
  visit(
    @CurrentUser() user: VisitPlanUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("entryId", ParseUUIDPipe) entryId: string,
    @Body() input: RecordVisitDto,
  ) {
    return this.plans.recordVisit(user, id, entryId, input);
  }

  @Patch(":id/report")
  report(
    @CurrentUser() user: VisitPlanUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: SaveVisitPlanReportDto,
  ) {
    return this.plans.saveReport(user, id, input);
  }

  @Get(":id/history")
  history(
    @CurrentUser() user: VisitPlanUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.plans.history(user, id);
  }

  @Patch(':id/deadline')
  deadline(@CurrentUser() user: VisitPlanUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: SaveVisitPlanDeadlineDto) { return this.plans.saveDeadline(user, id, input); }

  @Delete(':id/entries/:entryId')
  remove(@CurrentUser() user: VisitPlanUser, @Param('id', ParseUUIDPipe) id: string, @Param('entryId', ParseUUIDPipe) entryId: string, @Body() input: VisitPlanVersionDto) { return this.plans.removeEntry(user, id, entryId, input.expectedVersion); }
}
