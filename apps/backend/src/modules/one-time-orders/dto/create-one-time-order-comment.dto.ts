import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateOneTimeOrderCommentDto {
  @IsString()
  @MinLength(1)
  content!: string;

  @IsOptional()
  @IsString()
  commentType?: string;
}
