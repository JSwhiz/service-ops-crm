import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { FILE_ATTACHMENT_ENTITY_TYPES } from '../constants/file-attachment-policy.constants';

export class UploadFileBodyDto {
  @IsString()
  @IsIn(FILE_ATTACHMENT_ENTITY_TYPES)
  @MaxLength(100)
  entityType!: string;

  @IsUUID('4')
  entityId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fieldCode?: string;
}
