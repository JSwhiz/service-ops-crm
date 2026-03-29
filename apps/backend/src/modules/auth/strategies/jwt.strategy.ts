import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { UsersService } from '../../users-access/users.service';
import { AUTH_JWT_STRATEGY } from '../constants/auth.constants';

interface JwtPayload {
  sub: string;
  login: string;
  roleCode: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, AUTH_JWT_STRATEGY) {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.accessSecret'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = this.usersService.findById(payload.sub);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User is not available');
    }

    return this.usersService.sanitizeUser(user);
  }
}
