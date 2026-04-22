import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { CreateEquipmentCatalogItemDto } from './dto/create-equipment-catalog-item.dto';
import { CreateEquipmentMovementDto } from './dto/create-equipment-movement.dto';
import { CreateEquipmentUnitDto } from './dto/create-equipment-unit.dto';
import {
  EquipmentCatalogItemResponseDto,
  EquipmentMovementResponseDto,
  EquipmentUnitResponseDto,
} from './dto/equipment-response.dto';
import { ListEquipmentUnitsQueryDto } from './dto/list-equipment-query.dto';
import { EquipmentService } from './equipment.service';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  isActive: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller('equipment')
export class EquipmentController {
  constructor(private readonly equipmentService: EquipmentService) {}

  @Get('catalog')
  listCatalog(
    @CurrentUser() user: CurrentAuthUser,
  ): Promise<EquipmentCatalogItemResponseDto[]> {
    return this.equipmentService.listCatalog(user);
  }

  @Post('catalog')
  createCatalogItem(
    @CurrentUser() user: CurrentAuthUser,
    @Body() payload: CreateEquipmentCatalogItemDto,
  ): Promise<EquipmentCatalogItemResponseDto> {
    return this.equipmentService.createCatalogItem(user, payload);
  }

  @Get('units')
  listUnits(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: ListEquipmentUnitsQueryDto,
  ): Promise<EquipmentUnitResponseDto[]> {
    return this.equipmentService.listUnits(user, query);
  }

  @Post('units')
  createUnit(
    @CurrentUser() user: CurrentAuthUser,
    @Body() payload: CreateEquipmentUnitDto,
  ): Promise<EquipmentUnitResponseDto> {
    return this.equipmentService.createUnit(user, payload);
  }

  @Get('units/:id')
  getUnitById(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<EquipmentUnitResponseDto> {
    return this.equipmentService.getUnitById(user, id);
  }

  @Get('units/:id/movements')
  listUnitMovements(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<EquipmentMovementResponseDto[]> {
    return this.equipmentService.listUnitMovements(user, id);
  }

  @Post('units/:id/movements')
  createMovement(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: CreateEquipmentMovementDto,
  ): Promise<EquipmentMovementResponseDto> {
    return this.equipmentService.createMovement(user, id, payload);
  }
}
