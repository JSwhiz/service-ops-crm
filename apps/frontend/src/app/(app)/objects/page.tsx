import React from 'react';

import { PageTitle } from '@/shared/ui/page-title/page-title';

export default function ObjectsPage(): React.JSX.Element {
  return (
    <>
      <PageTitle title="Объекты" />
      <div className="page-card">
        <p className="page-muted">
          Здесь позже будет список объектов, фильтры, статусы и переходы в карточки.
        </p>
      </div>
    </>
  );
}
