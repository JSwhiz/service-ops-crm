import { Type } from 'class-transformer';
import { IsString, Length, MaxLength, ValidateNested } from 'class-validator';

class SubscriptionKeysDto {
  @IsString() @Length(86, 90) p256dh!: string;
  @IsString() @Length(22, 24) auth!: string;
}
export class PushEndpointDto {
  @IsString() @Length(1, 2048) endpoint!: string;
}
export class ConnectWebPushDto extends PushEndpointDto {
  @ValidateNested() @Type(() => SubscriptionKeysDto) keys!: SubscriptionKeysDto;
  @IsString() @Length(1, 80) @MaxLength(80) deviceName!: string;
}
