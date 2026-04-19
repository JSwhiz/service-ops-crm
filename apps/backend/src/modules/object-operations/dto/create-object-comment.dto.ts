import { IsOptional, IsString } from 'class-validator';

export class CreateObjectCommentDto {
  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  commentType?: string;
}
