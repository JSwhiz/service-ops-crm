import React from 'react';

import { PageTitle } from '@/shared/ui/page-title/page-title';

export default function DashboardPage(): React.JSX.Element {
  return (
    <>
      <PageTitle title="Рабочий стол" />
      <div className="page-card">
        <strong>Frontend shell готов.</strong>
        <p className="page-muted">
          Здесь позже будет рабочий стол с ролевыми блоками, KPI, задачами и сигналами.
        </p>
      </div>
    </>
  );
}
