import React from 'react';
import { Surface } from '@/shared/ui/foundation';

export function TimesheetLegend(): React.JSX.Element {
  return (
    <Surface padding="md">
      <div style={{ fontWeight: 600, marginBottom: 12 }}>Как работает табель</div>

      <div
        style={{
          display: 'grid',
          gap: 8,
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        }}
      >
        <div
          style={{
            border: '1px solid var(--ui-border)',
            borderRadius: 10,
            padding: 10,
          }}
        >
          Если по сотруднику есть факт присутствия, день автоматически получает
          ставку объекта.
        </div>

        <div
          style={{
            border: '1px solid var(--ui-border)',
            borderRadius: 10,
            padding: 10,
          }}
        >
          Если факта присутствия нет, автоматическое значение дня равно 0.
        </div>

        <div
          style={{
            border: '1px solid var(--ui-border)',
            borderRadius: 10,
            padding: 10,
          }}
        >
          Любая ручная корректировка, которая отклоняется от автоматического
          значения, требует обязательного комментария.
        </div>

        <div
          style={{
            border: '1px solid var(--ui-border)',
            borderRadius: 10,
            padding: 10,
          }}
        >
          Если вручную вернуть ячейку к автоматическому значению, ручная
          корректировка снимается.
        </div>
      </div>
    </Surface>
  );
}
