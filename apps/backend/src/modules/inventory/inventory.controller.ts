import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { CreateInventoryMovementDto } from './dto/create-inventory-movement.dto';
import { InventoryItemResponseDto } from './dto/inventory-item-response.dto';
import { InventoryItemListResponseDto } from './dto/inventory-item-list-response.dto';
import { InventoryMovementListResponseDto } from './dto/inventory-movement-list-response.dto';
import { InventoryMovementResponseDto } from './dto/inventory-movement-response.dto';
import { InventoryReportSummaryDto } from './dto/inventory-report-summary.dto';
import { ListInventoryItemsQueryDto } from './dto/list-inventory-items-query.dto';
import { ListInventoryMovementsQueryDto } from './dto/list-inventory-movements-query.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { InventoryService } from './inventory.service';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  isActive: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('items')
  listItems(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: ListInventoryItemsQueryDto,
  ): Promise<InventoryItemListResponseDto> {
    return this.inventoryService.listItems(user, query);
  }

  @Get('items/:id')
  getItemById(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<InventoryItemResponseDto> {
    return this.inventoryService.getItemById(user, id);
  }

  @Post('items')
  createItem(
    @CurrentUser() user: CurrentAuthUser,
    @Body() payload: CreateInventoryItemDto,
  ): Promise<InventoryItemResponseDto> {
    return this.inventoryService.createItem(user, payload);
  }

  @Patch('items/:id')
  updateItem(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: UpdateInventoryItemDto,
  ): Promise<InventoryItemResponseDto> {
    return this.inventoryService.updateItem(user, id, payload);
  }

  @Get('movements')
  listMovements(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: ListInventoryMovementsQueryDto,
  ): Promise<InventoryMovementListResponseDto> {
    return this.inventoryService.listMovements(user, query);
  }

  @Get('reports/summary')
  getReportSummary(
    @CurrentUser() user: CurrentAuthUser,
  ): Promise<InventoryReportSummaryDto> {
    return this.inventoryService.getReportSummary(user);
  }

  @Post('movements')
  createMovement(
    @CurrentUser() user: CurrentAuthUser,
    @Body() payload: CreateInventoryMovementDto,
  ): Promise<InventoryMovementResponseDto> {
    return this.inventoryService.createMovement(user, payload);
  }

  @Post('movements/:id/resolve-missing-photo-approval')
  @HttpCode(200)
  resolveMissingPhotoApproval(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<InventoryMovementResponseDto> {
    return this.inventoryService.resolveMissingPhotoApproval(user, id);
  }

  @Get('reference/objects')
  listObjectReferenceOptions(
    @CurrentUser() user: CurrentAuthUser,
  ): Promise<Array<{ id: string; name: string; status: string }>> {
    return this.inventoryService.listObjectReferenceOptions(user);
  }

  @Get('reference/one-time-orders')
  listOneTimeOrderReferenceOptions(
    @CurrentUser() user: CurrentAuthUser,
  ): Promise<Array<{ id: string; title: string; status: string }>> {
    return this.inventoryService.listOneTimeOrderReferenceOptions(user);
  }
}
