import { IsOptional, IsString } from 'class-validator';

export class ApproveApprovalRequestDto {
  @IsOptional()
  @IsString()
  comment?: string;
}

export class RejectApprovalRequestDto {
  @IsString()
  comment!: string;
}

export class CancelApprovalRequestDto {
  @IsOptional()
  @IsString()
  comment?: string;
}
