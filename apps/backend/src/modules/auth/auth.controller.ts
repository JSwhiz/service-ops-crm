import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';

import { AuthService } from './auth.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { MeResponseDto } from './dto/me-response.dto';
import { AuthRateLimitGuard } from './guards/auth-rate-limit.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthRequestMeta } from './types/auth-request-meta.type';
import {
  clearAuthCookies,
  getCookieValue,
  setAuthCookies,
} from './utils/auth-cookie.util';
import { REFRESH_TOKEN_COOKIE } from './constants/auth.constants';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @UseGuards(AuthRateLimitGuard)
  @Post('login')
  async login(
    @Body() payload: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const issuedSession = await this.authService.login(
      payload,
      this.getRequestMeta(request),
    );

    setAuthCookies(response, this.configService, issuedSession);

    return {
      user: issuedSession.user,
    };
  }

  @UseGuards(AuthRateLimitGuard)
  @Post('refresh')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const refreshToken = getCookieValue(
      request.headers.cookie,
      REFRESH_TOKEN_COOKIE,
    );

    if (!refreshToken) {
      clearAuthCookies(response, this.configService);
      throw new UnauthorizedException('Missing refresh token');
    }

    try {
      const issuedSession = await this.authService.refresh(
        refreshToken,
        this.getRequestMeta(request),
      );

      setAuthCookies(response, this.configService, issuedSession);

      return {
        user: issuedSession.user,
      };
    } catch (error) {
      clearAuthCookies(response, this.configService);
      throw error;
    }
  }

  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ success: true }> {
    const refreshToken = getCookieValue(
      request.headers.cookie,
      REFRESH_TOKEN_COOKIE,
    );

    await this.authService.logout(refreshToken ?? undefined);
    clearAuthCookies(response, this.configService);

    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: MeResponseDto): MeResponseDto {
    return user;
  }

  private getRequestMeta(request: Request): AuthRequestMeta {
    const rawUserAgent = request.headers['user-agent'];

    return {
      userAgent: Array.isArray(rawUserAgent)
        ? rawUserAgent[0]
        : rawUserAgent,
      ipAddress: request.ip || request.socket.remoteAddress || undefined,
    };
  }
}
