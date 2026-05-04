import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { AuditModule } from '../audit/audit.module';
import { FilesModule } from '../files/files.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { UsersAccessModule } from '../users-access/users-access.module';

import { ChatRealtimeService } from './chat-realtime.service';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    UsersAccessModule,
    FilesModule,
    AuditModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.accessSecret'),
      }),
    }),
  ],
  controllers: [ChatsController],
  providers: [ChatsService, ChatRealtimeService],
  exports: [ChatsService, ChatRealtimeService],
})
export class ChatsModule {}
