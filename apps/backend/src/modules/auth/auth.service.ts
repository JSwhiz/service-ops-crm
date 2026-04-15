import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { UsersService } from '../users-access/users.service';

import { LoginDto } from './dto/login.dto';
import { MeResponseDto } from './dto/me-response.dto';
import { AuthRequestMeta } from './types/auth-request-meta.type';
import { parseDurationToMs } from './utils/duration.util';
import { hashPassword, verifyPassword } from './utils/password-hash.util';

import { AuthSessionsService } from './auth-sessions.service';

interface IssuedAuthSession {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  user: MeResponseDto;
}

interface PasswordCheckUserRecord {
  id: string;
  password: string | null;
  passwordHash: string | null;
}

interface SanitizedAuthUserRecord {
  id: string;
  login: string;
  fullName: string;
  isActive: boolean;
  roleCodes: string[];
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly authSessionsService: AuthSessionsService,
  ) {}

  async login(
    payload: LoginDto,
    meta: AuthRequestMeta,
  ): Promise<IssuedAuthSession> {
    const user = await this.usersService.findByLogin(payload.login);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const hasValidPassword = await this.validatePassword(user, payload.password);

    if (!hasValidPassword) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const safeUser = this.buildMeResponse(this.usersService.sanitizeUser(user));

    return this.issueAuthSession(safeUser, meta);
  }

  async refresh(
    refreshToken: string,
    meta: AuthRequestMeta,
  ): Promise<IssuedAuthSession> {
    const existingSession =
      await this.authSessionsService.findActiveSessionByRawToken(refreshToken);

    if (!existingSession) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.usersService.findById(existingSession.userId);

    if (!user || !user.isActive) {
      await this.authSessionsService.revokeSessionByRawToken(refreshToken);
      throw new UnauthorizedException('Invalid refresh token');
    }

    const safeUser = this.buildMeResponse(this.usersService.sanitizeUser(user));
    const refreshExpiresAt = this.getRefreshExpiresAt();
    const rotatedSession = await this.authSessionsService.rotateSession(
      refreshToken,
      {
        expiresAt: refreshExpiresAt,
        meta,
      },
    );

    if (!rotatedSession) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return {
      accessToken: await this.signAccessToken(safeUser),
      refreshToken: rotatedSession.rawToken,
      accessExpiresAt: this.getAccessExpiresAt(),
      refreshExpiresAt,
      user: safeUser,
    };
  }

  async logout(refreshToken?: string): Promise<void> {
    if (!refreshToken) {
      return;
    }

    await this.authSessionsService.revokeSessionByRawToken(refreshToken);
  }

  private async validatePassword(
    user: PasswordCheckUserRecord,
    rawPassword: string,
  ): Promise<boolean> {
    if (user.passwordHash) {
      return verifyPassword(rawPassword, user.passwordHash);
    }

    if (!user.password || user.password !== rawPassword) {
      return false;
    }

    const passwordHash = await hashPassword(rawPassword);
    await this.usersService.setPasswordHash(user.id, passwordHash);
    return true;
  }

  private async issueAuthSession(
    user: MeResponseDto,
    meta: AuthRequestMeta,
  ): Promise<IssuedAuthSession> {
    const accessExpiresAt = this.getAccessExpiresAt();
    const refreshExpiresAt = this.getRefreshExpiresAt();
    const refreshSession = await this.authSessionsService.createSession({
      userId: user.id,
      expiresAt: refreshExpiresAt,
      meta,
    });

    return {
      accessToken: await this.signAccessToken(user),
      refreshToken: refreshSession.rawToken,
      accessExpiresAt,
      refreshExpiresAt,
      user,
    };
  }

  private async signAccessToken(user: MeResponseDto): Promise<string> {
    return this.jwtService.signAsync(this.buildJwtPayload(user));
  }

  private buildJwtPayload(user: MeResponseDto) {
    return {
      sub: user.id,
      login: user.login,
      roleCode: user.roleCode,
      roleCodes: user.roleCodes,
    };
  }

  private buildMeResponse(user: SanitizedAuthUserRecord): MeResponseDto {
    return {
      id: user.id,
      login: user.login,
      fullName: user.fullName,
      isActive: user.isActive,
      roleCode: user.roleCodes[0] ?? 'unknown',
      roleCodes: user.roleCodes,
    };
  }

  private getAccessExpiresAt(): Date {
    return new Date(
      Date.now() + parseDurationToMs(this.getConfigValue('jwt.accessExpiresIn')),
    );
  }

  private getRefreshExpiresAt(): Date {
    return new Date(
      Date.now() +
        parseDurationToMs(this.getConfigValue('jwt.refreshExpiresIn')),
    );
  }

  private getConfigValue(key: string): string {
    const value = this.configService.get<string>(key);

    if (!value) {
      throw new Error(`Missing configuration value: ${key}`);
    }

    return value;
  }
}
