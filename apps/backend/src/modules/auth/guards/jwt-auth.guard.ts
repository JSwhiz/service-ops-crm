import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { AUTH_JWT_STRATEGY } from '../constants/auth.constants';

@Injectable()
export class JwtAuthGuard extends AuthGuard(AUTH_JWT_STRATEGY) {}
