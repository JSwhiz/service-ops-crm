import { appConfig } from '@/shared/config/app-config';
import { refreshSession } from '@/shared/auth/auth-session';
import { getAccessGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';
import { ApiError } from './fetcher';

export async function downloadFile(path: string, failureMessage: string): Promise<Blob> {
  const generation = getAccessGeneration();
  const assertCurrent = (): void => {
    if (!isAccessGenerationCurrent(generation)) {
      throw new ApiError('Права изменились. Повторите скачивание после обновления страницы.', 409, 'ACCESS_VERSION_CHANGED');
    }
  };
  const request = (): Promise<Response> => fetch(`${appConfig.apiUrl}${path}`, {
    method: 'GET', credentials: 'include', cache: 'no-store',
  });
  let response = await request();
  assertCurrent();
  if (response.status === 401 && await refreshSession()) {
    assertCurrent();
    response = await request();
    assertCurrent();
  }
  if (!response.ok) throw new Error(failureMessage);
  const blob = await response.blob();
  assertCurrent();
  return blob;
}
