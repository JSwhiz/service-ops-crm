import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';

const ROUTE_LIMITS: Record<string, { limit: number; windowMs: number }> = {
  '/login': {
    limit: 5,
    windowMs: 60 * 1000,
  },
  '/refresh': {
    limit: 15,
    windowMs: 60 * 1000,
  },
};

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private static readonly routeHits = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const routePath =
      typeof request.route?.path === 'string' ? request.route.path : request.path;
    const routeLimit = ROUTE_LIMITS[routePath];

    if (!routeLimit) {
      return true;
    }

    const requestIp = request.ip || request.socket.remoteAddress || 'unknown';
    const key = `${routePath}:${requestIp}`;
    const now = Date.now();
    const windowStart = now - routeLimit.windowMs;
    const recentHits = (
      AuthRateLimitGuard.routeHits.get(key) ?? []
    ).filter((timestamp) => timestamp >= windowStart);

    if (recentHits.length >= routeLimit.limit) {
      throw new HttpException(
        'Too many authentication attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    recentHits.push(now);
    AuthRateLimitGuard.routeHits.set(key, recentHits);

    return true;
  }
}
