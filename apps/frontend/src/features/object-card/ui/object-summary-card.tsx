import React from 'react';

import type { ServiceObject } from '@/entities/object/model/object.types';

interface ObjectSummaryCardProps {
  item: ServiceObject;
}

export function ObjectSummaryCard({
  item,
}: ObjectSummaryCardProps): React.JSX.Element {
  return (
    <div
      className="page-card"
      style={{
        display: 'grid',
        gap: 16,
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      }}
    >
      <Field label="Название" value={item.name} />
      <Field label="Внутреннее имя" value={item.internalName ?? '—'} />
      <Field label="Адрес" value={item.address} />
      <Field label="Статус" value={renderStatus(item.status)} />
      <Field label="Сезон" value={renderSeason(item.seasonMode)} />
      <Field
        label="Менеджеры"
        value={
          item.managers.length > 0
            ? item.managers.map((person) => person.fullName).join(', ')
            : '—'
        }
      />
      <Field
        label="Ответственные"
        value={
          item.responsibles.length > 0
            ? item.responsibles.map((person) => person.fullName).join(', ')
            : '—'
        }
      />
      <Field label="Заметки" value={item.notes ?? '—'} />
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

function renderStatus(status: string): string {
  switch (status) {
    case 'active':
      return 'Активный';
    case 'frozen':
      return 'Заморожен';
    case 'archived':
      return 'Архив';
    default:
      return status;
  }
}

function renderSeason(seasonMode: string): string {
  switch (seasonMode) {
    case 'summer':
      return 'Летний';
    case 'winter':
      return 'Зимний';
    default:
      return seasonMode;
  }
}
