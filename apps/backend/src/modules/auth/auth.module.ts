import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { PrismaModule } from '../prisma/prisma.module';
import { UsersAccessModule } from '../users-access/users-access.module';

import { AuthSessionsService } from './auth-sessions.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRateLimitGuard } from './guards/auth-rate-limit.guard';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PrismaModule,
    UsersAccessModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.accessSecret'),
        signOptions: {
          expiresIn: configService.get<string>('jwt.accessExpiresIn', '15m'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthSessionsService, AuthRateLimitGuard, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
