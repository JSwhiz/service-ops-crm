import { IsOptional, IsString } from 'class-validator';

export class CreateOneTimeOrderCommentDto {
  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  commentType?: string;
}
