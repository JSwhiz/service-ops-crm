import { IsOptional, IsString, MinLength, IsUrl } from 'class-validator';

export class CreateArrivalPhotoDto {
  @IsOptional()
  @IsUrl()
  photoUrl?: string;

  @IsOptional()
  @IsString()
  photoType?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  comment?: string;
}
