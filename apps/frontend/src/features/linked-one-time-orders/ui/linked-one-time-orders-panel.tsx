'use client';

import Link from 'next/link';
import React from 'react';

import type { LinkedOneTimeOrderProjection } from '@/entities/object/model/object-operations.types';
import { getOneTimeOrderStatusLabel } from '@/shared/lib/one-time-order-presentation';

export function LinkedOneTimeOrdersPanel({
  items,
}: {
  items: LinkedOneTimeOrderProjection[];
}): React.JSX.Element {
  return (
    <div className="page-card" style={{ display: 'grid', gap: 16 }}>
      <div style={{ fontWeight: 600 }}>Из разового заказа</div>

      {items.length === 0 ? (
        <div className="page-muted">
          Связанных разовых заказов для объекта пока нет.
        </div>
      ) : (
        <div className="record-list local-scroll">
          {items.map((item) => {
            const header = (
              <div style={{ display: 'grid', gap: 4 }}>
                <div style={{ fontWeight: 600 }}>{item.title}</div>
                <div className="page-muted">Заказ #{item.id}</div>
              </div>
            );

            return (
              <div
                key={item.id}
                style={{
                  display: 'grid',
                  gap: 10,
                }}
                className="record-card"
              >
                {item.canOpenOrderCard ? (
                  <Link
                    href={`/one-time-orders/${item.id}`}
                    style={{ color: 'inherit', textDecoration: 'none' }}
                  >
                    {header}
                  </Link>
                ) : (
                  header
                )}

                <div
                  style={{
                    display: 'grid',
                    gap: 8,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  }}
                >
                  <div>
                    <div className="page-muted">Статус</div>
                    <div>{getOneTimeOrderStatusLabel(item.status)}</div>
                  </div>
                  <div>
                    <div className="page-muted">Дата выполнения</div>
                    <div>
                      {item.executionDate
                        ? new Date(item.executionDate).toLocaleDateString('ru-RU')
                        : 'Не указана'}
                    </div>
                  </div>
                  <div>
                    <div className="page-muted">Финансовая сводка</div>
                    <div>
                      {item.agreedSum !== null ? `${item.agreedSum} ₽` : 'Не указана'}
                    </div>
                  </div>
                  <div>
                    <div className="page-muted">Менеджер заказа</div>
                    <div>
                      {item.managers.length > 0
                        ? item.managers.map((manager) => manager.fullName).join(', ')
                        : 'Не назначен'}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <span className="page-muted">
                    Комментарии: {item.summary.commentsCount}
                  </span>
                  <span className="page-muted">
                    Отчеты: {item.summary.reportsCount}
                  </span>
                  <span className="page-muted">
                    Фото: {item.summary.photosCount}
                  </span>
                  <span className="page-muted">
                    Файлы: {item.summary.filesCount}
                  </span>
                  <span className="page-muted">
                    Задачи: {item.summary.tasksCount}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
