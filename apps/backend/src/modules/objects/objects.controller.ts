import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApprovalRequestResponseDto } from '../approvals/dto/approval-request-response.dto';

import { AssignObjectUserDto } from './dto/assign-object-user.dto';
import { ChangeObjectStatusDto } from './dto/change-object-status.dto';
import { CreateObjectDto } from './dto/create-object.dto';
import { ListObjectsQueryDto } from './dto/list-objects-query.dto';
import { ObjectAuditLogResponseDto } from './dto/object-audit-log-response.dto';
import { ObjectResponseDto } from './dto/object-response.dto';
import { UpdateObjectDto } from './dto/update-object.dto';
import { ObjectsService } from './objects.service';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  isActive: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller('objects')
export class ObjectsController {
  constructor(private readonly objectsService: ObjectsService) {}

  @Get()
  listObjects(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: ListObjectsQueryDto,
  ): Promise<ObjectResponseDto[]> {
    return this.objectsService.listObjects(user, query);
  }

  @Get(':id')
  getObjectById(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<ObjectResponseDto> {
    return this.objectsService.getObjectById(user, id);
  }

  @Get(':id/audit')
  listObjectAuditLogs(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<ObjectAuditLogResponseDto[]> {
    return this.objectsService.listObjectAuditLogs(user, id);
  }

  @Post()
  createObject(
    @CurrentUser() user: CurrentAuthUser,
    @Body() payload: CreateObjectDto,
  ): Promise<ObjectResponseDto> {
    return this.objectsService.createObject(user, payload);
  }

  @Patch(':id')
  updateObject(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: UpdateObjectDto,
  ): Promise<ObjectResponseDto> {
    return this.objectsService.updateObject(user, id, payload);
  }

  @Patch(':id/status')
  changeStatus(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: ChangeObjectStatusDto,
  ): Promise<ApprovalRequestResponseDto> {
    return this.objectsService.changeStatus(user, id, payload);
  }

  @Post(':id/responsibles')
  addResponsibleToObject(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: AssignObjectUserDto,
  ): Promise<ObjectResponseDto> {
    return this.objectsService.addResponsibleToObject(user, id, payload.userId);
  }

  @Delete(':id/responsibles/:userId')
  removeResponsibleFromObject(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): Promise<ObjectResponseDto> {
    return this.objectsService.removeResponsibleFromObject(user, id, userId);
  }

  @Post(':id/managers')
  addManagerToObject(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: AssignObjectUserDto,
  ): Promise<ObjectResponseDto> {
    return this.objectsService.addManagerToObject(user, id, payload.userId);
  }

  @Delete(':id/managers/:userId')
  removeManagerFromObject(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): Promise<ObjectResponseDto> {
    return this.objectsService.removeManagerFromObject(user, id, userId);
  }
}
