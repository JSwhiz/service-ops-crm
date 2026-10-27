import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
export class CorrectInventoryMovementDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(2) @MaxLength(2000)
  reason!: string;
}
