import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { VisitPlanUser } from "../visit-plans/visit-plans.service";
import {
  SaveOrderDeadlineDto,
  SaveOrderEscortsDto,
  SaveOrderServiceLinesDto,
} from "./dto/order-operations.dto";
import { OneTimeOrderOperationsService } from "./one-time-order-operations.service";

@UseGuards(JwtAuthGuard)
@Controller("one-time-orders/:orderId")
export class OneTimeOrderOperationsController {
  constructor(private readonly operations: OneTimeOrderOperationsService) {}

  @Get("escorts")
  escorts(
    @CurrentUser() user: VisitPlanUser,
    @Param("orderId", ParseUUIDPipe) id: string,
    @Query("date") date: string,
  ) {
    return this.operations.escorts(user, id, date);
  }

  @Put("escorts")
  saveEscorts(
    @CurrentUser() user: VisitPlanUser,
    @Param("orderId", ParseUUIDPipe) id: string,
    @Body() input: SaveOrderEscortsDto,
  ) {
    return this.operations.saveEscorts(user, id, input);
  }

  @Get("service-lines")
  serviceLines(
    @CurrentUser() user: VisitPlanUser,
    @Param("orderId", ParseUUIDPipe) id: string,
  ) {
    return this.operations.serviceLines(user, id);
  }

  @Put("service-lines")
  saveServiceLines(
    @CurrentUser() user: VisitPlanUser,
    @Param("orderId", ParseUUIDPipe) id: string,
    @Body() input: SaveOrderServiceLinesDto,
  ) {
    return this.operations.saveServiceLines(user, id, input);
  }

  @Get("deadline")
  deadline(
    @CurrentUser() user: VisitPlanUser,
    @Param("orderId", ParseUUIDPipe) id: string,
  ) {
    return this.operations.getDeadline(user, id);
  }

  @Put("deadline")
  saveDeadline(
    @CurrentUser() user: VisitPlanUser,
    @Param("orderId", ParseUUIDPipe) id: string,
    @Body() input: SaveOrderDeadlineDto,
  ) {
    return this.operations.saveDeadline(user, id, input);
  }
}
