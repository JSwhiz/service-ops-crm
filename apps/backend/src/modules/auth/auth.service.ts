import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { UsersService } from '../users-access/users.service';

import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async login(payload: LoginDto): Promise<AuthResponseDto> {
    const user = this.usersService.findByLogin(payload.login);

    if (!user || !user.isActive || user.password !== payload.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const safeUser = this.usersService.sanitizeUser(user);

    const jwtPayload = {
      sub: safeUser.id,
      login: safeUser.login,
      roleCode: safeUser.roleCode,
    };

    return {
      accessToken: await this.jwtService.signAsync(jwtPayload),
      refreshToken: await this.jwtService.signAsync(jwtPayload, {
        expiresIn: '30d',
      }),
      user: safeUser,
    };
  }

  async refresh(refreshToken: string): Promise<AuthResponseDto> {
    try {
      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        login: string;
        roleCode: string;
      }>(refreshToken);

      const user = this.usersService.findById(payload.sub);

      if (!user || !user.isActive) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const safeUser = this.usersService.sanitizeUser(user);

      const jwtPayload = {
        sub: safeUser.id,
        login: safeUser.login,
        roleCode: safeUser.roleCode,
      };

      return {
        accessToken: await this.jwtService.signAsync(jwtPayload),
        refreshToken: await this.jwtService.signAsync(jwtPayload, {
          expiresIn: '30d',
        }),
        user: safeUser,
      };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }
}
