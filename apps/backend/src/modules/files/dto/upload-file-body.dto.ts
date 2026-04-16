import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UploadFileBodyDto {
  @IsString()
  @MaxLength(100)
  entityType!: string;

  @IsUUID('4')
  entityId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fieldCode?: string;
}
