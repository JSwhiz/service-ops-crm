import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateRubberMatSizeDto, SetRubberMatQuantityDto, UpdateRubberMatCostDto } from './dto/aggregate-rubber-mat.dto';
import { MatActor, RubberMatAggregateService } from './rubber-mat-aggregate.service';
import { ListRubberMatsQueryDto } from './dto/list-rubber-mats-query.dto';

@UseGuards(JwtAuthGuard)
@Controller('rubber-mats/aggregate')
export class RubberMatAggregateRegistryController {
  constructor(private readonly service: RubberMatAggregateService) {}
  @Get() list(@CurrentUser() user: MatActor, @Query() query: ListRubberMatsQueryDto) { return this.service.registry(user, query); }
}

@UseGuards(JwtAuthGuard)
@Controller('rubber-mats/catalog')
export class RubberMatCatalogController {
  constructor(private readonly service: RubberMatAggregateService) {}
  @Get() list(@CurrentUser() user: MatActor) { return this.service.catalog(user); }
  @Post() create(@CurrentUser() user: MatActor, @Body() body: CreateRubberMatSizeDto) { return this.service.createSize(user, body); }
  @Patch(':sizeId') update(@CurrentUser() user: MatActor, @Param('sizeId') id: string, @Body() body: UpdateRubberMatCostDto) { return this.service.updateCost(user, id, body); }
  @Get(':sizeId/history') history(@CurrentUser() user: MatActor, @Param('sizeId') id: string) { return this.service.costHistory(user, id); }
}

@UseGuards(JwtAuthGuard)
@Controller('objects/:objectId/rubber-mats/aggregate')
export class ObjectRubberMatAggregateController {
  constructor(private readonly service: RubberMatAggregateService) {}
  @Get() list(@CurrentUser() user: MatActor, @Param('objectId') id: string) { return this.service.aggregate(user, id); }
  @Get('history') history(@CurrentUser() user: MatActor, @Param('objectId') id: string) { return this.service.quantityHistory(user, id); }
  @Put(':sizeId') update(@CurrentUser() user: MatActor, @Param('objectId') objectId: string, @Param('sizeId') sizeId: string, @Body() body: SetRubberMatQuantityDto) { return this.service.setQuantity(user, objectId, sizeId, body); }
}
