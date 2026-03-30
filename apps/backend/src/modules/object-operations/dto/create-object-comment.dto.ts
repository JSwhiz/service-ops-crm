import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateObjectCommentDto {
  @IsString()
  @MinLength(2)
  content!: string;

  @IsOptional()
  @IsString()
  commentType?: string;
}
