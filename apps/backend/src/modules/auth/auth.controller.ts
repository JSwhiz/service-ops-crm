import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';

import { AuthService } from './auth.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { MeResponseDto } from './dto/me-response.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() payload: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(payload);
  }

  @Post('refresh')
  refresh(@Headers('x-refresh-token') refreshToken?: string): Promise<AuthResponseDto> {
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    return this.authService.refresh(refreshToken);
  }

  @Post('logout')
  logout(): { success: true } {
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: MeResponseDto): MeResponseDto {
    return user;
  }
}
