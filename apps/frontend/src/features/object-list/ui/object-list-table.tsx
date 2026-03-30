import Link from 'next/link';
import React from 'react';

import type { ServiceObject } from '@/entities/object/model/object.types';

interface ObjectListTableProps {
  items: ServiceObject[];
}

export function ObjectListTable({
  items,
}: ObjectListTableProps): React.JSX.Element {
  if (items.length === 0) {
    return (
      <div className="page-card">
        <div className="page-muted">Объекты не найдены.</div>
      </div>
    );
  }

  return (
    <div className="page-card" style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          minWidth: 720,
        }}
      >
        <thead>
          <tr>
            <th style={thStyle}>Название</th>
            <th style={thStyle}>Внутреннее имя</th>
            <th style={thStyle}>Адрес</th>
            <th style={thStyle}>Статус</th>
            <th style={thStyle}>Менеджеры</th>
            <th style={thStyle}>Ответственные</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td style={tdStyle}>
                <Link href={`/objects/${item.id}`}>{item.name}</Link>
              </td>
              <td style={tdStyle}>{item.internalName ?? '—'}</td>
              <td style={tdStyle}>{item.address}</td>
              <td style={tdStyle}>{renderStatus(item.status)}</td>
              <td style={tdStyle}>
                {item.managers.length > 0
                  ? item.managers.map((person) => person.fullName).join(', ')
                  : '—'}
              </td>
              <td style={tdStyle}>
                {item.responsibles.length > 0
                  ? item.responsibles.map((person) => person.fullName).join(', ')
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '12px 10px',
  borderBottom: '1px solid #e5e7eb',
  fontSize: 14,
};

const tdStyle: React.CSSProperties = {
  padding: '12px 10px',
  borderBottom: '1px solid #f0f2f5',
  verticalAlign: 'top',
  fontSize: 14,
};
