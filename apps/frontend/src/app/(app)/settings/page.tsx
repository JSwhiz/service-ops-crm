import React from 'react';

import { PageTitle } from '@/shared/ui/page-title/page-title';
import { ButtonLink, EmptyState } from '@/shared/ui/foundation';

export default function SettingsPage(): React.JSX.Element {
  return (
    <div className="ui-page">
      <PageTitle title="Настройки" />
      <EmptyState title="Настройки пока недоступны" description="Рабочие разделы доступны в боковом меню." action={<ButtonLink href="/dashboard">На рабочий стол</ButtonLink>} />
    </div>
  );
}
