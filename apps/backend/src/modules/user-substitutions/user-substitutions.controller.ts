import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SystemUser } from '../users-access/types/system-user.type';
import { CreateUserSubstitutionDto, ListUserSubstitutionsQueryDto, RevokeUserSubstitutionDto, SubstitutionOptionsQueryDto } from './user-substitutions.dto';
import { UserSubstitutionsService } from './user-substitutions.service';

@UseGuards(JwtAuthGuard)
@Controller('user-substitutions')
export class UserSubstitutionsController {
  constructor(private readonly service: UserSubstitutionsService) {}
  @Get() list(@CurrentUser() actor: SystemUser, @Query() query: ListUserSubstitutionsQueryDto) { return this.service.list(actor, query); }
  @Get('options') options(@CurrentUser() actor: SystemUser, @Query() query: SubstitutionOptionsQueryDto) { return this.service.options(actor, query); }
  @Post() create(@CurrentUser() actor: SystemUser, @Body() payload: CreateUserSubstitutionDto) { return this.service.create(actor, payload); }
  @Post(':id/revoke') revoke(@CurrentUser() actor: SystemUser, @Param('id') id: string, @Body() payload: RevokeUserSubstitutionDto) { return this.service.revoke(actor, id, payload.reason); }
}
