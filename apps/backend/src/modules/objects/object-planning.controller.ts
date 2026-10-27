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
import { ObjectPlanningService } from "./object-planning.service";
import {
  ContactVersionDto,
  SaveObjectContactDto,
  SaveObjectPlanningDto,
} from "./dto/object-planning.dto";

type PlanningActor = Parameters<ObjectPlanningService["getPlanning"]>[0];

@UseGuards(JwtAuthGuard)
@Controller("objects")
export class ObjectPlanningController {
  constructor(private readonly service: ObjectPlanningService) {}
  @Get(":id/contacts")
  contacts(@CurrentUser() user: PlanningActor, @Param("id") id: string) {
    return this.service.listContacts(user, id);
  }
  @Post(":id/contacts")
  createContact(
    @CurrentUser() user: PlanningActor,
    @Param("id") id: string,
    @Body() payload: SaveObjectContactDto,
  ) {
    return this.service.saveContact(user, id, null, payload);
  }
  @Patch(":id/contacts/:contactId")
  updateContact(
    @CurrentUser() user: PlanningActor,
    @Param("id") id: string,
    @Param("contactId") contactId: string,
    @Body() payload: SaveObjectContactDto,
  ) {
    return this.service.saveContact(user, id, contactId, payload);
  }
  @Delete(":id/contacts/:contactId")
  deleteContact(
    @CurrentUser() user: PlanningActor,
    @Param("id") id: string,
    @Param("contactId") contactId: string,
    @Body() payload: ContactVersionDto,
  ) {
    return this.service.deleteContact(user, id, contactId, payload);
  }
  @Get(":id/planning")
  planning(@CurrentUser() user: PlanningActor, @Param("id") id: string) {
    return this.service.getPlanning(user, id);
  }
  @Patch(":id/planning")
  save(
    @CurrentUser() user: PlanningActor,
    @Param("id") id: string,
    @Body() payload: SaveObjectPlanningDto,
  ) {
    return this.service.savePlanning(user, id, payload);
  }
}
