export type PushSupport = 'supported' | 'insecure' | 'ios-install' | 'unsupported';
export interface PushEnvironment {
  secure: boolean; serviceWorker: boolean; pushManager: boolean; notification: boolean;
  userAgent: string; platform: string; maxTouchPoints: number; standalone: boolean;
}
export function pushSupport(env: PushEnvironment): PushSupport {
  if (!env.secure) return 'insecure';
  const ios = /iPhone|iPad|iPod/.test(env.userAgent) || (env.platform === 'MacIntel' && env.maxTouchPoints > 1);
  if (ios && !env.standalone) return 'ios-install';
  return env.serviceWorker && env.pushManager && env.notification ? 'supported' : 'unsupported';
}
export function pushErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError') return 'Уведомления запрещены. Разрешите их в настройках браузера или устройства и вернитесь сюда.';
  if (name === 'NotSupportedError') return 'Этот браузер не поддерживает push-уведомления. Попробуйте актуальную версию Safari, Chrome или Firefox.';
  if (name === 'InvalidStateError') return 'Подписка браузера изменилась. Отключите уведомления на этом устройстве и подключите их заново.';
  if (name === 'AbortError') return 'Подключение прервано. Проверьте сеть и попробуйте ещё раз.';
  return 'Не удалось связаться с сервисом уведомлений. Проверьте сеть и обновите состояние устройства. Повторная отправка автоматически не выполняется.';
}
export function vapidApplicationKey(value: string): ArrayBuffer {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, char => char.charCodeAt(0)).buffer;
}

export interface PushTestState { status: string; errorCode: string | null; finishedAt: string | null }
export function pushTestFeedback(test: PushTestState): { tone: 'info' | 'warning'; text: string } {
  if (test.status === 'sent') return { tone: 'info', text: 'Push-служба приняла проверку. Это ещё не подтверждает получение на телефоне: найдите уведомление на устройстве и откройте его.' };
  if (test.status === 'pending') return { tone: 'info', text: 'Проверка ожидает отправки. Через несколько секунд обновите состояние устройства.' };
  if (test.errorCode === 'endpoint_expired') return { tone: 'warning', text: 'Подписка браузера устарела. Отключите уведомления на этом устройстве и подключите их заново.' };
  if (test.errorCode === 'session_unavailable') return { tone: 'warning', text: 'Сеанс подключения завершён. Войдите заново и подключите устройство.' };
  if (test.errorCode === 'push_http_401' || test.errorCode === 'push_http_403') return { tone: 'warning', text: 'Push-служба не приняла настройки доставки. Обратитесь к администратору.' };
  if (test.status === 'skipped') return { tone: 'warning', text: 'Проверка не отправлена: доступ или подключение устройства изменились. Обновите состояние перед новой ручной проверкой.' };
  return { tone: 'warning', text: 'Не удалось отправить проверку. Проверьте сеть или обратитесь к администратору. Новая проверка отправляется только вручную.' };
}
