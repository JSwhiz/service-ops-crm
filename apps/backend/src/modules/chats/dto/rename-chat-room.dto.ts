import { IsString, MaxLength, MinLength } from 'class-validator';

export class RenameChatRoomDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;
}
