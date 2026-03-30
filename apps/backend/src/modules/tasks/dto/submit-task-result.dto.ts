import { IsString, MinLength } from 'class-validator';

export class SubmitTaskResultDto {
  @IsString()
  @MinLength(2)
  resultText!: string;
}
