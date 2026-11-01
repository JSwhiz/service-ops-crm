import React from 'react';
import { LoadingState } from '@/shared/ui/foundation';

/** Keep the application shell visible while a route segment is loading. */
export default function AppLoading(): React.JSX.Element {
  return <LoadingState label="Загружаем раздел…" />;
}
