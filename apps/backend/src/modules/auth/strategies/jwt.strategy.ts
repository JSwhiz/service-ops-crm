import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { UsersService } from '../../users-access/users.service';

import { AUTH_JWT_STRATEGY } from '../constants/auth.constants';
import { ACCESS_TOKEN_COOKIE } from '../constants/auth.constants';
import { getCookieValue } from '../utils/auth-cookie.util';

interface JwtPayload {
  sub: string;
  login: string;
  roleCode?: string;
  roleCodes?: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, AUTH_JWT_STRATEGY) {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    const cookieExtractor = (request: Request | undefined): string | null => {
      if (!request) {
        return null;
      }

      return getCookieValue(request.headers.cookie, ACCESS_TOKEN_COOKIE);
    };

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.accessSecret'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.usersService.findById(payload.sub);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User is not available');
    }

    const safeUser = this.usersService.sanitizeUser(user);

    return {
      ...safeUser,
      roleCode: safeUser.roleCodes[0] ?? 'unknown',
    };
  }
}
