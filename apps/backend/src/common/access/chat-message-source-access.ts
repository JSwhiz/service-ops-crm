import type {Prisma} from '@prisma/client';
import {decideAccess, type AccessSubject} from '../../modules/users-access/utils/access-policy.util';
import {resourceAccessTarget, type ResourceAccessTarget} from './resource-access-context';
const relevant = new Set(['objects.access','objects.read','objects.reports.read','objects.budget.read','one_time_orders.access','one_time_orders.read','one_time_orders.reports.read']);
export function hasChatSourceDeny(subject: AccessSubject): boolean {
  return subject.accessRules?.some(rule => rule.effect === 'deny' && relevant.has(rule.actionCode)) ?? false;
}
type SourceMessage = {messageType: string; metadata: Prisma.JsonValue | null};
type Database = Pick<Prisma.TransactionClient,'chatMessage'|'object'|'oneTimeOrder'>;
/** Published text remains an immutable room-visible snapshot. Its source is an
 * additional explicit-deny boundary, never a new role or membership grant. */
export async function isChatMessageSourceAllowed(
  database: Database,
  subject: AccessSubject,
  message: SourceMessage,
  cache = new Map<string, Promise<ResourceAccessTarget | null>>(),
): Promise<boolean> {
  if (message.messageType !== 'system' || !hasChatSourceDeny(subject)) return true;
  const metadata = message.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return true;
  const refs: Array<{kind:'object'|'one_time_order';id:string;leaf?:string}> = [];
  if (typeof metadata.objectId === 'string' && metadata.objectId) refs.push({kind:'object',id:metadata.objectId,
    ...(typeof metadata.reportId === 'string' ? {leaf:'objects.reports.read'} : typeof metadata.budgetAlertId === 'string' ? {leaf:'objects.budget.read'} : {})});
  if (typeof metadata.oneTimeOrderId === 'string' && metadata.oneTimeOrderId) refs.push({kind:'one_time_order',id:metadata.oneTimeOrderId,
    ...(typeof metadata.reportId === 'string' ? {leaf:'one_time_orders.reports.read'} : {})});
  for (const ref of refs) {
    const key=ref.kind+':'+ref.id;
    if (!cache.has(key)) cache.set(key, resourceAccessTarget(database as Prisma.TransactionClient,ref.kind,ref.id));
    const resolved=await cache.get(key);
    // Retained publications keep their identity even if a legacy source row is
    // missing; selected/all denies must not disappear with that row.
    const target: ResourceAccessTarget=resolved ?? {actionCode:ref.kind==='object'?'objects.read':'one_time_orders.read',context:{resourceType:ref.kind,resourceId:ref.id}};
    if (!decideAccess(subject,target.actionCode,true,target.context)) return false;
    if (ref.leaf && !decideAccess(subject,ref.leaf,true,{...target.context,parents:[target]})) return false;
  }
  return true;
}
/** Filter before take/count/cursor. A positive set for system rows prevents a
 * newly inserted unchecked source from slipping between lookup and projection.
 * Ordinary user chat text and unlinked system events retain their room policy. */
export async function chatMessageSourceWhere(database: Database,subject: AccessSubject,base: Prisma.ChatMessageWhereInput): Promise<Prisma.ChatMessageWhereInput> {
  if (!hasChatSourceDeny(subject)) return base;
  const system=await database.chatMessage.findMany({where:{AND:[base,{messageType:'system'}]},select:{id:true,messageType:true,metadata:true}});
  const cache=new Map<string,Promise<ResourceAccessTarget|null>>(),allowed:string[]=[];
  for(const message of system)if(await isChatMessageSourceAllowed(database,subject,message,cache))allowed.push(message.id);
  return{AND:[base,{OR:[{messageType:{not:'system'}},{id:{in:allowed}}]}]};
}
