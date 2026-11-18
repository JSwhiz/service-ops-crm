'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError } from '@/shared/api/fetcher';
import { useAuth } from '@/shared/auth/use-auth';
import { getAccessSessionGeneration } from '@/shared/auth/access-generation';
import { getSafeLocalTarget } from '@/shared/lib/safe-local-target';
import { Alert, Badge, Button, ButtonLink, Field, LoadingState, PageHeader, Stack, Surface } from '@/shared/ui/foundation';
import { connectPushDevice, disconnectPushDevice, getPushConfiguration, getPushDeviceState, resolvePushNotification, testPushDevice, type DeviceState, type PushConfiguration } from '../api/push-client';
import { pushErrorMessage, pushSupport, pushTestFeedback, vapidApplicationKey, type PushSupport } from '../model/push-support';
import styles from './push-device-settings.module.css';

const emptyDevice: DeviceState = { connected: false, id: null };
function browserSupport(): PushSupport {
  return pushSupport({ secure: window.isSecureContext, serviceWorker: 'serviceWorker' in navigator, pushManager: 'PushManager' in window, notification: 'Notification' in window, userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints, standalone: window.matchMedia('(display-mode: standalone)').matches || !!(navigator as Navigator & { standalone?: boolean }).standalone });
}

export function PushDeviceSettings(): React.JSX.Element {
  const { user, capabilitiesRefreshError } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [config, setConfig] = useState<PushConfiguration | null>(null);
  const [device, setDevice] = useState<DeviceState>(emptyDevice);
  const [browserSubscription, setBrowserSubscription] = useState<PushSubscription | null>(null);
  const [readyRegistration, setReadyRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [deviceName, setDeviceName] = useState('Этот телефон или компьютер');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const actor = user?.id;
  const session = getAccessSessionGeneration();
  const context = useRef({ actor, session });
  context.current = { actor, session };
  const current = useCallback(() => mounted.current && !!actor && context.current.actor === actor && context.current.session === session && getAccessSessionGeneration() === session, [actor, session]);
  const allowed = !!user && user.capabilities?.canAccessNotifications !== false && !capabilitiesRefreshError;
  const allowedRef = useRef(allowed); allowedRef.current = allowed;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async () => {
    if (!current()) return;
    setLoading(true); setError(null);
    try {
      const environment = browserSupport();
      setSupport(environment);
      setPermission('Notification' in window ? Notification.permission : 'unsupported');
      const configuration = await getPushConfiguration();
      if (!current()) return;
      setConfig(configuration);
      setReadyRegistration(null);
      let subscription: PushSubscription | null = null;
      if (environment === 'supported') {
        const expectedScript = new URL('/push-worker.js', location.origin).href;
        const existing = await navigator.serviceWorker.getRegistration('/');
        if (existing?.active && existing.active.scriptURL !== expectedScript) throw new Error('Another service worker controls this application');
        let registration = existing;
        if (configuration.enabled) {
          await navigator.serviceWorker.register('/push-worker.js', { scope: '/', updateViaCache: 'none' });
          registration = await pushWorkerReady();
          if (registration.active?.scriptURL !== expectedScript) throw new Error('Unexpected service worker');
          if (current()) setReadyRegistration(registration);
        }
        if (registration?.active?.scriptURL === expectedScript) subscription = await registration.pushManager.getSubscription();
      }
      if (!current()) return;
      setBrowserSubscription(subscription);
      const state = subscription ? await getPushDeviceState(subscription.endpoint) : emptyDevice;
      if (current()) { setDevice(state); if (state.deviceName) setDeviceName(state.deviceName); }
    } catch (e) { if (current()) setError(e instanceof ApiError ? e.message : pushErrorMessage(e)); }
    finally { if (current()) setLoading(false); }
  }, [current]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const id = search.get('delivery');
    if (!id || !actor) return;
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) { setError('Ссылка уведомления недоступна.'); return; }
    let active = true;
    void resolvePushNotification(id).then(result => {
      if (!active || !current()) return;
      if (result.test) { setNotice('Проверочное уведомление открыто на этом устройстве.'); return; }
      const target = getSafeLocalTarget(result.targetUrl);
      if (target) router.replace(target);
      else setNotice('Уведомление доступно. Откройте список уведомлений в шапке — прямая ссылка для этой записи не предусмотрена.');
    }).catch(e => { if (active && current()) setError(e instanceof ApiError ? e.message : 'Не удалось проверить доступ к уведомлению. Повторите переход после обновления страницы.'); });
    return () => { active = false; };
  }, [search, actor, current, router]);

  const run = (label: string, job: () => Promise<void>): void => {
    if (!current() || inFlight.current) return;
    inFlight.current = true; setBusy(label); setError(null); setNotice(null);
    void job().catch(e => { if (current()) setError(e instanceof ApiError ? e.message : pushErrorMessage(e)); }).finally(() => { inFlight.current = false; if (current()) setBusy(null); });
  };
  const needsReset = !!browserSubscription && !!config?.enabled && (!device.id || config.publicKey !== bytesKey(browserSubscription.options.applicationServerKey));
  const connect = async (): Promise<void> => {
    if (!allowedRef.current || !config?.enabled || !config.publicKey || !readyRegistration || needsReset || browserSupport() !== 'supported') return;
    // No await, network or worker registration before this invocation. The
    // Push API itself asks for permission within the explicit user gesture.
    const request = readyRegistration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidApplicationKey(config.publicKey) });
    let subscription: PushSubscription;
    try { subscription = await request; }
    finally { if (current()) setPermission(Notification.permission); }
    if (!current() || !allowedRef.current) return;
    setBrowserSubscription(subscription);
    const state = await connectPushDevice(subscription, deviceName.trim() || 'Это устройство');
    if (current()) { setDevice(state); setNotice('Устройство подключено. Отправьте проверку и убедитесь, что уведомление появилось на этом устройстве.'); }
  };
  const disconnect = async (): Promise<void> => {
    if (device.id) await disconnectPushDevice(device.id);
    if (!current()) return;
    setDevice(emptyDevice);
    if (browserSubscription && !await browserSubscription.unsubscribe()) throw new DOMException('Browser subscription remains active', 'InvalidStateError');
    if (current()) { setBrowserSubscription(null); setNotice('Уведомления отключены на этом устройстве. Настройки других устройств не изменены.'); }
  };

  const lastTestFeedback = device.lastTest ? pushTestFeedback(device.lastTest) : null;

  return (
    <div className={`ui-page ${styles.page}`}>
      <PageHeader title="Уведомления на устройстве" description="Получайте общее уведомление, даже когда CRM закрыта. Содержимое записей открывается только после проверки доступа." />
      {notice ? <Alert tone="success" role="status">{notice}</Alert> : null}
      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
      <Surface as="section" padding="md" aria-labelledby="push-device-title">
        <Stack gap="lg">
          <div className="ui-section-header"><h2 className="ui-section-title" id="push-device-title">Это устройство</h2><Badge tone={device.connected ? 'success' : 'neutral'}>{device.connected ? 'Подключено' : 'Не подключено'}</Badge></div>
          {loading ? <LoadingState label="Проверяем настройки устройства…" /> : <>
            {config && !config.enabled ? <Alert title="Push-уведомления пока не настроены">Подключение появится после настройки сервиса администратором. Уведомления внутри CRM работают отдельно.</Alert> : null}
            {support === 'insecure' ? <Alert tone="warning" title="Нужно защищённое подключение">Откройте CRM по HTTPS. В обычной HTTP-сети телефон не разрешает push-уведомления.</Alert> : null}
            {support === 'unsupported' ? <Alert tone="warning" title="Этот браузер не поддерживает push">Обновите браузер или откройте CRM в актуальном Safari, Chrome либо Firefox.</Alert> : null}
            {support === 'ios-install' ? <Alert title="Сначала добавьте CRM на экран «Домой»">На iPhone и iPad push доступны в установленном веб-приложении. Выполните шаги ниже, затем откройте CRM с новой иконки.</Alert> : null}
            {permission === 'denied' ? <Alert tone="warning" title="Разрешение отключено">Разрешите уведомления для CRM в настройках браузера или в настройках уведомлений устройства. Затем нажмите «Обновить состояние».</Alert> : null}
            {needsReset ? <Alert tone="warning">Подписка браузера не связана с этой учётной записью или использует прежние настройки. Сначала обновите состояние. Если предупреждение осталось, явно отключите уведомления на этом устройстве и подключите их новым нажатием.</Alert> : null}
            {lastTestFeedback ? <Alert tone={lastTestFeedback.tone} role="status">{lastTestFeedback.text}</Alert> : null}
            {!allowed ? <Alert tone="warning">Доступ к доставке уведомлений изменился или требует обновления. Подключение и проверка недоступны; отключить собственное устройство можно.</Alert> : null}
            <Field label="Название устройства" description="Только для ваших настроек, например «Рабочий телефон»."><input value={deviceName} maxLength={80} disabled={!!busy || device.connected} onChange={event => setDeviceName(event.target.value)} /></Field>
            <div className={styles.actions}>
              {!device.connected ? <Button disabled={!!busy || !config?.enabled || support !== 'supported' || !readyRegistration || needsReset || !allowed || permission === 'denied'} pending={busy === 'connect'} onClick={() => run('connect', connect)}>Подключить уведомления</Button> : <Button disabled={!!busy || !config?.enabled || !allowed || permission !== 'granted'} pending={busy === 'test'} onClick={() => run('test', async () => { if (!device.id || !allowedRef.current) return; await testPushDevice(device.id); if (current()) setNotice('Проверка поставлена в очередь. Дождитесь уведомления на устройстве. Принятие запроса ещё не подтверждает доставку.'); })}>Отправить проверку</Button>}
              {device.id || browserSubscription ? <Button variant="default" disabled={!!busy} pending={busy === 'disconnect'} onClick={() => run('disconnect', disconnect)}>Отключить на этом устройстве</Button> : null}
              <Button variant="ghost" disabled={!!busy} onClick={() => run('refresh', load)}>Обновить состояние</Button>
            </div>
            <p className="ui-text-muted">Эти push-уведомления содержат только общее сообщение без имён, сумм и текста записи. Настройка уведомлений открытой вкладки в колокольчике остаётся отдельной. Выход из учётной записи прекращает дальнейшую серверную доставку. Уже отправленное системное уведомление может оставаться в центре уведомлений.</p>
          </>}
        </Stack>
      </Surface>
      <Surface as="section" padding="md" aria-labelledby="push-install-title">
        <Stack gap="md">
          <h2 id="push-install-title" className="ui-section-title">На телефоне</h2>
          <h3 className="ui-section-title">iPhone и iPad</h3>
          <ol className={styles.steps}><li>Обновите iOS/iPadOS до версии 16.4 или новее и откройте CRM в Safari по HTTPS.</li><li>Нажмите «Поделиться» → «На экран Домой» → «Добавить».</li><li>Откройте CRM с новой иконки, войдите и нажмите «Подключить уведомления». Разрешите уведомления в системном окне.</li></ol>
          <h3 className="ui-section-title">Android</h3>
          <p>Откройте CRM по HTTPS в актуальном Chrome или Firefox. Нажмите «Подключить уведомления» и разрешите их. Для отдельной иконки выберите «Установить приложение» или «Добавить на главный экран» в меню браузера.</p>
          <p className="ui-text-muted">Если проверка не появилась: проверьте разрешения браузера, режим «Не беспокоить»/«Фокусирование», подключение к сети и ограничения энергосбережения. Уведомления могут приходить с задержкой.</p>
          <div><ButtonLink variant="ghost" href="/dashboard">На рабочий стол</ButtonLink></div>
        </Stack>
      </Surface>
    </div>
  );
}
function bytesKey(key: ArrayBuffer | null): string | null {
  if (!key) return null;
  return btoa(String.fromCharCode(...new Uint8Array(key))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pushWorkerReady(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DOMException('Service worker activation timed out', 'AbortError')), 15_000); })]);
  } finally { clearTimeout(timer); }
}
