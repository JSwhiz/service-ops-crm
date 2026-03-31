import React from 'react';

import type { ServiceObject } from '@/entities/object/model/object.types';

export function ObjectSummaryCard({
  item,
}: {
  item: ServiceObject;
}): React.JSX.Element {
  return (
    <div
      className="page-card"
      style={{
        display: 'grid',
        gap: 16,
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      }}
    >
      <Field label="Название" value={item.name} />
      <Field label="Внутреннее имя" value={item.internalName ?? '—'} />
      <Field label="Адрес" value={item.address} />
      <Field label="Статус" value={item.status} />
      <Field label="Сезон" value={item.seasonMode} />
      <Field label="Ставка за день" value={`${item.dailyRate}`} />
      <Field
        label="Ответственные"
        value={
          item.managers.length > 0
            ? item.managers
                .map((manager) => `${manager.fullName} (${manager.roleCode})`)
                .join(', ')
            : '—'
        }
      />
      <Field label="Комментарий" value={item.notes ?? '—'} />
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 15 }}>{value}</div>
    </div>
  );
}
