import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { GlobalSearchQueryDto } from './dto/global-search-query.dto';
import { GlobalSearchResponseDto } from './dto/global-search-response.dto';
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
}
