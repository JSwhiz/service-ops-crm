import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class AssignOneTimeOrderManagerDto {
  @IsUUID('4')
  userId!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  conflictFingerprint?: string;
}
