import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class ResponseTimeInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const startedAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        const responseTimeMs = Date.now() - startedAt;
        // eslint-disable-next-line no-console
        console.log(`Response time: ${responseTimeMs}ms`);
      }),
    );
  }
}
