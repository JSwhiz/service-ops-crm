'use client';

import React from 'react';
import Link from 'next/link';

import type {
  ServiceObject,
  ObjectAssignmentPerson,
} from '@/entities/object/model/object.types';

interface ObjectListTableProps {
  items: ServiceObject[];
}

function formatPeople(items: ObjectAssignmentPerson[]): string {
  if (!items.length) {
    return '—';
  }

  return items.map((item) => item.fullName).join(', ');
}

export function ObjectListTable({
  items,
}: ObjectListTableProps): React.JSX.Element {
  const safeItems = items ?? [];

  return (
    <div className="page-card" style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 12 }}>Объект</th>
            <th style={{ textAlign: 'left', padding: 12 }}>Статус</th>
            <th style={{ textAlign: 'left', padding: 12 }}>Ответственные</th>
            <th style={{ textAlign: 'left', padding: 12 }}>Менеджеры</th>
            <th style={{ textAlign: 'left', padding: 12 }}>Ставка</th>
          </tr>
        </thead>

        <tbody>
          {safeItems.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ padding: 12 }}>
                Объекты не найдены.
              </td>
            </tr>
          ) : (
            safeItems.map((item) => (
              <tr key={item.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                <td style={{ padding: 12, verticalAlign: 'top' }}>
                  <div style={{ fontWeight: 600 }}>
                    <Link href={`/objects/${item.id}`}>{item.name}</Link>
                  </div>
                  <div className="page-muted">{item.address}</div>
                  {item.internalName ? (
                    <div className="page-muted">{item.internalName}</div>
                  ) : null}
                </td>

                <td style={{ padding: 12, verticalAlign: 'top' }}>
                  {item.status}
                </td>

                <td style={{ padding: 12, verticalAlign: 'top' }}>
                  {formatPeople(item.responsibles)}
                </td>

                <td style={{ padding: 12, verticalAlign: 'top' }}>
                  {formatPeople(item.managers)}
                </td>

                <td style={{ padding: 12, verticalAlign: 'top' }}>
                  {item.dailyRate}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
