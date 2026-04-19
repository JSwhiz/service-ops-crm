import { IsIn, IsOptional, IsString } from 'class-validator';

export const ONE_TIME_ORDER_MEDIA_CATEGORIES = [
  'before',
  'after',
  'report',
  'comment',
  'other',
] as const;

export class CreateOneTimeOrderPhotoDto {
  @IsIn(ONE_TIME_ORDER_MEDIA_CATEGORIES)
  category!: (typeof ONE_TIME_ORDER_MEDIA_CATEGORIES)[number];

  @IsOptional()
  @IsString()
  comment?: string;
}
