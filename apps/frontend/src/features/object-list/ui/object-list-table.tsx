'use client';

import React from 'react';
import Link from 'next/link';

import type {
  ObjectAssignedUser,
  ServiceObject,
} from '@/entities/object/model/object.types';

interface ObjectListTableProps {
  items: ServiceObject[];
}

function renderPeople(items: ObjectAssignedUser[]): string {
  if (!items.length) {
    return '—';
  }

  return items.map((item) => item.fullName).join(', ');
}

function getStatusLabel(status: string): string {
  if (status === 'active') {
    return 'Активный';
  }

  if (status === 'frozen') {
    return 'Заморожен';
  }

  if (status === 'archived') {
    return 'Архив';
  }

  return status;
}

export function ObjectListTable({
  items,
}: ObjectListTableProps): React.JSX.Element {
  if (!items.length) {
    return <div className="page-card">Объекты не найдены.</div>;
  }

  return (
    <div className="page-card" style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
            <th style={{ padding: '10px 8px' }}>Название</th>
            <th style={{ padding: '10px 8px' }}>Внутреннее имя</th>
            <th style={{ padding: '10px 8px' }}>Адрес</th>
            <th style={{ padding: '10px 8px' }}>Статус</th>
            <th style={{ padding: '10px 8px' }}>Ответственные</th>
            <th style={{ padding: '10px 8px' }}>Менеджеры</th>
          </tr>
        </thead>

        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              style={{ borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' }}
            >
              <td style={{ padding: '12px 8px' }}>
                <Link
                  href={`/objects/${item.id}`}
                  style={{ textDecoration: 'none', fontWeight: 600 }}
                >
                  {item.name}
                </Link>
              </td>

              <td style={{ padding: '12px 8px' }}>{item.internalName ?? '—'}</td>

              <td style={{ padding: '12px 8px' }}>{item.address}</td>

              <td style={{ padding: '12px 8px' }}>
                <span className="status-pill" data-status={item.status}>
                  {getStatusLabel(item.status)}
                </span>
              </td>

              <td style={{ padding: '12px 8px' }}>
                {renderPeople(item.responsibles)}
              </td>

              <td style={{ padding: '12px 8px' }}>
                {renderPeople(item.managers)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
