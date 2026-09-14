import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import {
  CreateCounterpartyDto,
  UpdateCounterpartyDto,
} from './dto/counterparty-mutations.dto';
import {
  ListCounterpartiesQueryDto,
  ListCounterpartyReferencesQueryDto,
} from './dto/list-counterparties-query.dto';
import { CounterpartiesService } from './counterparties.service';

interface CurrentAuthUser {
  id: string;
  roleCode?: string;
  roleCodes?: string[];
  permissionCodes?: string[];
}

@UseGuards(JwtAuthGuard)
@Controller('counterparties')
export class CounterpartiesController {
  constructor(private readonly service: CounterpartiesService) {}

  @Get()
  list(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: ListCounterpartiesQueryDto,
  ) {
    return this.service.list(user, query);
  }

  @Get('references')
  references(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: ListCounterpartyReferencesQueryDto,
  ) {
    return this.service.listReferences(user, query);
  }

  @Get(':id')
  get(@CurrentUser() user: CurrentAuthUser, @Param('id') id: string) {
    return this.service.getById(user, id);
  }

  @Get(':id/history')
  history(@CurrentUser() user: CurrentAuthUser, @Param('id') id: string) {
    return this.service.history(user, id);
  }

  @Post()
  create(
    @CurrentUser() user: CurrentAuthUser,
    @Body() payload: CreateCounterpartyDto,
  ) {
    return this.service.create(user, payload);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: UpdateCounterpartyDto,
  ) {
    return this.service.update(user, id, payload);
  }

  @Post(':id/archive')
  archive(@CurrentUser() user: CurrentAuthUser, @Param('id') id: string) {
    return this.service.setArchived(user, id, true);
  }

  @Post(':id/restore')
  restore(@CurrentUser() user: CurrentAuthUser, @Param('id') id: string) {
    return this.service.setArchived(user, id, false);
  }

  @Post(':id/objects/:objectId')
  linkObject(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Param('objectId') objectId: string,
  ) {
    return this.service.linkObject(user, id, objectId);
  }

  @Delete(':id/objects/:objectId')
  unlinkObject(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Param('objectId') objectId: string,
  ) {
    return this.service.unlinkObject(user, id, objectId);
  }
}
