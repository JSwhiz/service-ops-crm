import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateOneTimeOrderReviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  reviewText?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  reviewRating?: number | null;
}
