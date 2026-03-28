import React from 'react';

import { PageTitle } from '@/shared/ui/page-title/page-title';

export default function TasksPage(): React.JSX.Element {
  return (
    <>
      <PageTitle title="Задачи" />
      <div className="page-card">
        <p className="page-muted">
          Здесь позже будет реестр задач, статусы, фильтры и карточка задачи.
        </p>
      </div>
    </>
  );
}
