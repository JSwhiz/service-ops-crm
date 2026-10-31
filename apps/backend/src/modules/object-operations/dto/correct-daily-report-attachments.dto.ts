import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CorrectDailyReportAttachmentsDto {
  @IsInt() @Min(1) expectedRevision!: number;
  @IsUUID('4') requestId!: string;
  @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) removeAttachmentIds!: string[];
  @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) addFileIds!: string[];
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
