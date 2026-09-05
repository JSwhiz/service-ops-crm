import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { GlobalSearchQueryDto } from './dto/global-search-query.dto';
import {
  GlobalSearchItemDto,
  GlobalSearchResponseDto,
} from './dto/global-search-response.dto';
import { ResolveRecentSearchDto } from './dto/resolve-recent-search.dto';
import { SearchService } from './search.service';

interface CurrentAuthUser {
  id: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
}

@UseGuards(JwtAuthGuard)
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: GlobalSearchQueryDto,
  ): Promise<GlobalSearchResponseDto> {
    return this.searchService.search(user, query);
  }

  @Post('recent')
  @HttpCode(HttpStatus.OK)
  resolveRecent(
    @CurrentUser() user: CurrentAuthUser,
    @Body() payload: ResolveRecentSearchDto,
  ): Promise<GlobalSearchItemDto[]> {
    return this.searchService.resolveRecent(user, payload);
  }
}
