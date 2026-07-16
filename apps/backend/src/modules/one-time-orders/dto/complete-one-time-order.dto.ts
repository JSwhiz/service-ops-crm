import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Min,
} from 'class-validator';

export class CompleteOneTimeOrderDto {
  @IsInt()
  @Min(1)
  workCycle!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  completionComment?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  clientRequestId?: string;
}
