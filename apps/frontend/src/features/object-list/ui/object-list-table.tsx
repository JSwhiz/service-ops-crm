'use client';

import React from 'react';
import Link from 'next/link';

import type {
  ServiceObject,
  ObjectAssignedUser,
} from '@/entities/object/model/object.types';

interface ObjectListTableProps {
  items: ServiceObject[];
}

function renderAssignedUsers(items: ObjectAssignedUser[]): string {
  if (!items.length) {
    return '—';
  }

  return items.map((item) => item.fullName).join(', ');
}

export function ObjectListTable({
  items,
}: ObjectListTableProps): React.JSX.Element {
  if (items.length === 0) {
    return <div className="page-card">Объекты не найдены.</div>;
  }

  return (
    <div className="page-card" style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          minWidth: 920,
        }}
      >
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
            <th style={{ padding: '12px 10px' }}>Название</th>
            <th style={{ padding: '12px 10px' }}>Внутреннее имя</th>
            <th style={{ padding: '12px 10px' }}>Адрес</th>
            <th style={{ padding: '12px 10px' }}>Статус</th>
            <th style={{ padding: '12px 10px' }}>Ответственные</th>
            <th style={{ padding: '12px 10px' }}>Менеджеры</th>
            <th style={{ padding: '12px 10px' }}>Ставка</th>
            <th style={{ padding: '12px 10px' }}>Карточка</th>
          </tr>
        </thead>

        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}
            >
              <td style={{ padding: '12px 10px', fontWeight: 600 }}>
                {item.name}
              </td>
              <td style={{ padding: '12px 10px' }}>
                {item.internalName ?? '—'}
              </td>
              <td style={{ padding: '12px 10px' }}>{item.address}</td>
              <td style={{ padding: '12px 10px' }}>{item.status}</td>
              <td style={{ padding: '12px 10px' }}>
                {renderAssignedUsers(item.responsibles)}
              </td>
              <td style={{ padding: '12px 10px' }}>
                {renderAssignedUsers(item.managers)}
              </td>
              <td style={{ padding: '12px 10px' }}>{item.dailyRate}</td>
              <td style={{ padding: '12px 10px' }}>
                <Link href={`/objects/${item.id}`}>Открыть</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
