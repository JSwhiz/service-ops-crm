'use client';

import Link from 'next/link';
import React from 'react';

import type { LinkedOneTimeOrderProjection } from '@/entities/object/model/object-operations.types';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { getOneTimeOrderStatusLabel } from '@/shared/lib/one-time-order-presentation';
import { Stack, Surface } from '@/shared/ui/foundation';

export function LinkedOneTimeOrdersPanel({
  items,
}: {
  items: LinkedOneTimeOrderProjection[];
}): React.JSX.Element {
  return (
    <Surface padding="md" style={{ display: 'grid', gap: 16 }}>
      <div style={{ fontWeight: 600 }}>Из разового заказа</div>

      {items.length === 0 ? (
        <div className="ui-text-muted">
          Связанных разовых заказов для объекта пока нет.
        </div>
      ) : (
        <div className="record-list local-scroll">
          {items.map((item) => {
            const header = (
              <Stack gap="xs">
                <div style={{ fontWeight: 600 }}>{item.title}</div>
                <div className="ui-text-muted">Заказ #{item.id}</div>
              </Stack>
            );

            return (
              <Surface padding="sm"
                key={item.id}
                style={{
                  display: 'grid',
                  gap: 10,
                }}

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
                    <div className="ui-text-muted">Статус</div>
                    <div>{getOneTimeOrderStatusLabel(item.status)}</div>
                  </div>
                  <div>
                    <div className="ui-text-muted">Дата выполнения</div>
                    <div>
                      {item.executionDate
                        ? new Date(item.executionDate).toLocaleDateString('ru-RU')
                        : 'Не указана'}
                    </div>
                  </div>
                  <div>
                    <div className="ui-text-muted">Финансовая сводка</div>
                    <div>
                      {item.agreedSum !== null ? `${item.agreedSum} ₽` : 'Не указана'}
                    </div>
                  </div>
                  <div>
                    <div className="ui-text-muted">Менеджер заказа</div>
                    <div>
                      {item.managers.length > 0
                        ? item.managers.map(getUserDisplayName).join(', ')
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
                  <span className="ui-text-muted">
                    Комментарии: {item.summary.commentsCount}
                  </span>
                  <span className="ui-text-muted">
                    Отчеты: {item.summary.reportsCount}
                  </span>
                  <span className="ui-text-muted">
                    Фото: {item.summary.photosCount}
                  </span>
                  <span className="ui-text-muted">
                    Файлы: {item.summary.filesCount}
                  </span>
                  <span className="ui-text-muted">
                    Задачи: {item.summary.tasksCount}
                  </span>
                </div>
              </Surface>
            );
          })}
        </div>
      )}
    </Surface>
  );
}
