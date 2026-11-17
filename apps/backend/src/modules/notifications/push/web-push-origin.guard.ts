import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/** Browser-only subscription mutations require the configured CRM origin. */
@Injectable()
export class WebPushOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.method === 'GET' || request.method === 'HEAD') return true;
    let expected: string | null = null;
    try { expected = new URL(this.config.get<string>('app.baseUrl') ?? '').origin; } catch { /* Fail closed. */ }
    if (!expected || request.headers.origin !== expected) throw new ForbiddenException('Откройте настройки уведомлений в самой CRM и повторите действие.');
    return true;
  }
}
