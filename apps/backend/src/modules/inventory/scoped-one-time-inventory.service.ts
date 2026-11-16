import { Injectable } from '@nestjs/common';
import { AccessSubject } from '../users-access/types/access-policy.type';
import { CreateOrderInventoryIssueDto } from './dto/create-order-inventory-issue.dto';
import type { OrderInventoryIssueResponseDto, OrderInventoryIssueResult } from './dto/order-inventory-issue-response.dto';
import { OrderInventoryResponseDto } from './dto/order-inventory-response.dto';
import { InventoryService } from './inventory.service';

export type ScopedOneTimeInventoryIssueResponse = Pick<OrderInventoryIssueResponseDto,
  'id' | 'inventoryItemId' | 'oneTimeOrderId' | 'quantity' | 'unitPriceSnapshot' |
  'totalAmountSnapshot' | 'status' | 'evidenceRequired' | 'createdAt'>;

interface CurrentAuthUser extends AccessSubject {
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
}

@Injectable()
export class ScopedOneTimeInventoryService {
  constructor(private readonly inventoryService: InventoryService) {}

  listOrderMovements(user: CurrentAuthUser, orderId: string): Promise<OrderInventoryResponseDto> {
    return this.inventoryService.listOneTimeOrderInventory(user, orderId);
  }

  issueToOrder(user: CurrentAuthUser, orderId: string, payload: CreateOrderInventoryIssueDto): Promise<OrderInventoryIssueResult> {
    return this.inventoryService.createOneTimeOrderIssueMovement(user, orderId, payload);
  }
}
