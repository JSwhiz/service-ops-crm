import { fetcher } from '@/shared/api/fetcher';
import type { ObjectSetupData, ObjectSetupResponse } from '../model/object-setup.types';

export const getObjectSetup = (id: string): Promise<ObjectSetupResponse> => fetcher(`/objects/${id}/setup`);
export const saveObjectSetup = (id: string, input: Partial<ObjectSetupData> & { expectedVersion: number }): Promise<ObjectSetupResponse> => fetcher(`/objects/${id}/setup`, { method: 'PATCH', body: JSON.stringify(input) });
