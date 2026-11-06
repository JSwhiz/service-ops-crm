import { IsOptional, IsUUID } from 'class-validator';

import { CreateObjectInventoryIssueDto } from './create-object-inventory-issue.dto';

export class CreateOrderInventoryIssueDto extends CreateObjectInventoryIssueDto {
  @IsOptional()
  @IsUUID()
  requestId?: string;
}
