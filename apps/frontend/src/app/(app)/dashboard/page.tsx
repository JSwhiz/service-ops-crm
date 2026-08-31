import React from 'react';

import { PageTitle } from '@/shared/ui/page-title/page-title';

export default function DashboardPage(): React.JSX.Element {
  return (
    <div className="workspace-page dashboard-workspace">
      <PageTitle title="Рабочий стол" />
      <section className="page-card workspace-surface">
        <div className="section-title">Рабочая панель</div>
        <p className="page-muted">
          Здесь позже будет рабочий стол с ролевыми блоками, KPI, задачами и сигналами.
        </p>
      </section>
    </div>
  );
}
