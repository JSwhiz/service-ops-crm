import { IsOptional, IsString, MinLength } from 'class-validator';

export class ApproveOneTimeManagerAvailabilityDto {
  @IsOptional()
  @IsString()
  comment?: string;
}

export class RejectOneTimeManagerAvailabilityDto {
  @IsString()
  @MinLength(1)
  comment!: string;
}
