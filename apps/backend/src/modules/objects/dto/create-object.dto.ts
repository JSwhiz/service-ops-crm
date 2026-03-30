import { IsArray, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

import { OBJECT_SEASON_MODES } from '../types/object-status.type';

export class CreateObjectDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  internalName?: string;

  @IsString()
  @MinLength(3)
  address!: string;

  @IsOptional()
  @IsIn(OBJECT_SEASON_MODES)
  seasonMode?: 'summer' | 'winter';

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  managerUserIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  responsibleUserIds?: string[];
}
