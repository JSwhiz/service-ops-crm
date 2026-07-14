import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeleteOneTimeOrderPhotoDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
