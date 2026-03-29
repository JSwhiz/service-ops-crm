import React from 'react';

import { PageTitle } from '@/shared/ui/page-title/page-title';

export default function SettingsPage(): React.JSX.Element {
  return (
    <>
      <PageTitle title="Настройки" />
      <div className="page-card">
        <p className="page-muted">
          Здесь позже будут настройки пользователя, доступа и системной конфигурации.
        </p>
      </div>
    </>
  );
}
