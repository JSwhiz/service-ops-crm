import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { CandidateCardResponseDto, CandidateListResponseDto } from './dto/candidate-response.dto';
import { AssignCandidateManagerDto, CandidateVersionDto, ChangeCandidateStatusDto, CreateCandidateDto, CreateCandidateResponseDto, UpdateCandidateDto } from './dto/candidate-mutations.dto';
import { ListCandidateManagersQueryDto, ListCandidatesQueryDto } from './dto/list-candidates-query.dto';
import { CandidatesService } from './candidates.service';

interface CurrentAuthUser { id: string; permissionCodes?: string[]; }

@UseGuards(JwtAuthGuard)
@Controller('candidates')
export class CandidatesController {
  constructor(private readonly candidatesService: CandidatesService) {}

  @Get()
  list(@CurrentUser() user: CurrentAuthUser, @Query() query: ListCandidatesQueryDto): Promise<CandidateListResponseDto> { return this.candidatesService.list(user, query); }

  @Get('references/managers')
  listManagers(@CurrentUser() user: CurrentAuthUser, @Query() query: ListCandidateManagersQueryDto) { return this.candidatesService.listManagers(user, query); }

  @Get(':id')
  get(@CurrentUser() user: CurrentAuthUser, @Param('id') id: string): Promise<CandidateCardResponseDto> { return this.candidatesService.getById(user, id); }

  @Post()
  create(@CurrentUser() user: CurrentAuthUser, @Body() payload: CreateCandidateDto): Promise<CandidateCardResponseDto> { return this.candidatesService.create(user, payload); }

  @Patch(':id')
  update(@CurrentUser() user: CurrentAuthUser, @Param('id') id: string, @Body() payload: UpdateCandidateDto): Promise<CandidateCardResponseDto> { return this.candidatesService.update(user, id, payload); }

  @Post(':id/status')
  changeStatus(@CurrentUser() user: CurrentAuthUser, @Param('id') id: string, @Body() payload: ChangeCandidateStatusDto): Promise<CandidateCardResponseDto> { return this.candidatesService.changeStatus(user, id, payload); }

  @Post(':id/archive')
  archive(@CurrentUser() user: CurrentAuthUser, @Param('id') id: string, @Body() payload: CandidateVersionDto): Promise<CandidateCardResponseDto> { return this.candidatesService.archive(user, id, payload); }

  @Post(':id/restore')
  restore(@CurrentUser() user: CurrentAuthUser, @Param('id') id: string, @Body() payload: CandidateVersionDto): Promise<CandidateCardResponseDto> { return this.candidatesService.restore(user, id, payload); }

  @Post(':id/assignments')
  assign(@CurrentUser() user: CurrentAuthUser, @Param('id') id: string, @Body() payload: AssignCandidateManagerDto): Promise<CandidateCardResponseDto> { return this.candidatesService.assign(user, id, payload); }

  @Post(':id/responses')
  respond(@CurrentUser() user: CurrentAuthUser, @Param('id') id: string, @Body() payload: CreateCandidateResponseDto): Promise<CandidateCardResponseDto> { return this.candidatesService.respond(user, id, payload); }
}
