import { IsString } from 'class-validator';

export class RejectAccountabilityClosureDto {
  @IsString()
  comment!: string;
}
