import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable, catchError, mergeMap } from 'rxjs';
import { AuditService } from '../audit/audit.service';
import { UserSubstitutionsService } from './user-substitutions.service';
import { objectDelegationContext, usedObjectDelegations } from './object-delegation.context';

@Injectable()
export class ObjectDelegationInterceptor implements NestInterceptor {
  constructor(private readonly substitutions: UserSubstitutionsService, private readonly audit: AuditService) {}
  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<{ user?: { id: string }; method: string; path: string }>();
    if (!request.user) return next.handle();
    const actorUserId = request.user.id;
    const grants = await this.substitutions.resolveGrants(actorUserId);
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const operationId = randomUUID();
    // A durable intent precedes the domain write. A crash between mutation and
    // completion leaves an explicit unresolved attempt, not an unaudited action.
    if (mutation && grants.length) {
      await this.audit.writeAuditEvent({ entityType: 'user_substitution', entityId: grants[0].substitutionId, actorUserId, action: 'user_substitution.action_started', metadata: { operationId, method: request.method, path: request.path, candidateDelegations: grants.map(({ substitutionId, principalUserId, objectId }) => ({ substitutionId, principalUserId, objectId })) } });
    }
    return new Observable((subscriber) => objectDelegationContext.run({ actorUserId, grants, used: new Map() }, () => {
      const subscription = next.handle().pipe(mergeMap(async (result: unknown) => {
        const delegations = usedObjectDelegations();
        if (mutation && grants.length) {
          await this.audit.writeAuditEvent({ entityType: 'user_substitution', entityId: delegations[0]?.substitutionId ?? grants[0].substitutionId, actorUserId, action: delegations.length ? 'user_substitution.action' : 'user_substitution.own_action', metadata: { operationId, delegations, method: request.method, path: request.path } });
        }
        return result;
      }), catchError(async (error: unknown) => {
        if (mutation && grants.length) {
          await this.audit.writeAuditEvent({ entityType: 'user_substitution', entityId: grants[0].substitutionId, actorUserId, action: 'user_substitution.action_failed', metadata: { operationId, method: request.method, path: request.path, delegations: usedObjectDelegations() } });
        }
        throw error;
      })).subscribe(subscriber);
      return () => subscription.unsubscribe();
    }));
  }
}
