import {
  IsIn,
  IsNumber,
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
  @IsNumber({ maxDecimalPlaces: 1 })
  @IsIn([1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5])
  @Min(1)
  @Max(5)
  reviewRating?: number | null;
}
