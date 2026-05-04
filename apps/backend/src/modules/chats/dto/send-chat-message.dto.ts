import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SendChatMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  text?: string;
}
