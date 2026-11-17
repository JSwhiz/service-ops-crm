import React, { Suspense } from 'react';
import { PushDeviceSettings } from '@/features/push-notifications/ui/push-device-settings';
import { LoadingState } from '@/shared/ui/foundation';

export default function NotificationSettingsPage(): React.JSX.Element {
  return <Suspense fallback={<LoadingState label="Загружаем настройки уведомлений…" />}><PushDeviceSettings /></Suspense>;
}
