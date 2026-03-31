import Link from 'next/link';
import React from 'react';

import type { ServiceObject, ObjectAssignmentPerson } from '@/entities/object/model/object.types';

export function ObjectListTable({
  items,
}: {
  items: ServiceObject[];
}): React.JSX.Element {
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
          minWidth: 900,
        }}
      >
        <thead>
          <tr>
            <th style={thStyle}>Название</th>
            <th style={thStyle}>Адрес</th>
            <th style={thStyle}>Статус</th>
            <th style={thStyle}>Ставка</th>
            <th style={thStyle}>Менеджеры</th>
            <th style={thStyle}>Ответственные</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item: ServiceObject) => {
            const managers = item.managers ?? [];
            const responsibles = item.responsibles ?? [];

            return (
              <tr key={item.id}>
                <td style={tdStyle}>
                  <Link href={`/objects/${item.id}`}>{item.name}</Link>
                </td>
                <td style={tdStyle}>{item.address}</td>
                <td style={tdStyle}>{item.status}</td>
                <td style={tdStyle}>{item.dailyRate}</td>
                <td style={tdStyle}>
                  {managers.length > 0
                    ? managers
                        .map((person: ObjectAssignmentPerson) => person.fullName)
                        .join(', ')
                    : '—'}
                </td>
                <td style={tdStyle}>
                  {responsibles.length > 0
                    ? responsibles
                        .map((person: ObjectAssignmentPerson) => person.fullName)
                        .join(', ')
                    : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
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
