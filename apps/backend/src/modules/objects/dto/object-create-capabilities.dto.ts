import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';

export class ObjectCreateCapabilitiesDto {
  @IsIn(['active', 'frozen', 'archived'])
  status!: 'active' | 'frozen' | 'archived';

  @IsOptional()
  @IsUUID('4')
  responsibleUserId?: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  managerUserIds!: string[];

  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  employeeIds!: string[];
}
