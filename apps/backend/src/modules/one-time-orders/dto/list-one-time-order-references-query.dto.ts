import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ListOneTimeOrderReferencesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsUUID('4')
  selectedId?: string;
}
