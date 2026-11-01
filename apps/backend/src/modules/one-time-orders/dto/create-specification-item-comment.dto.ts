import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateSpecificationItemCommentDto {
  @IsUUID()
  requestId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  content!: string;
}
