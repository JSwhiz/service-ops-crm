import type { PushTestState } from '../model/push-support';
import { fetcher } from '@/shared/api/fetcher';

export interface PushConfiguration { enabled: boolean; publicKey: string | null }
export interface DeviceState { connected: boolean; id: string | null; deviceName?: string; lastTest?: PushTestState | null }
export const getPushConfiguration = (): Promise<PushConfiguration> => fetcher('/auth/push/config');
export const getPushDeviceState = (endpoint: string): Promise<DeviceState> => fetcher('/auth/push/status', { method: 'POST', body: JSON.stringify({ endpoint }) });
export function connectPushDevice(subscription: PushSubscription, deviceName: string): Promise<DeviceState> {
  const json = subscription.toJSON();
  return fetcher('/auth/push/subscriptions', { method: 'POST', body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, deviceName }) });
}
export const disconnectPushDevice = (id: string): Promise<{ disconnected: true }> => fetcher(`/auth/push/subscriptions/${encodeURIComponent(id)}/disconnect`, { method: 'POST' });
export const testPushDevice = (id: string): Promise<{ queued: true }> => fetcher(`/auth/push/subscriptions/${encodeURIComponent(id)}/test`, { method: 'POST' });
export const resolvePushNotification = (id: string): Promise<{ targetUrl: string | null; test: boolean }> => fetcher(`/auth/push/open/${encodeURIComponent(id)}`);
