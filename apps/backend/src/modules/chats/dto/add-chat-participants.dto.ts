import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

export class AddChatParticipantsDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  userIds!: string[];
}
