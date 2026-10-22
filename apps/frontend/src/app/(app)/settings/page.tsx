import React from 'react';

import { PageTitle } from '@/shared/ui/page-title/page-title';
import { Surface } from '@/shared/ui/foundation';

export default function SettingsPage(): React.JSX.Element {
  return (
    <>
      <PageTitle title="Настройки" />
      <Surface padding="md">
        <p className="ui-text-muted">
          Здесь позже будут настройки пользователя, доступа и системной конфигурации.
        </p>
      </Surface>
    </>
  );
}
