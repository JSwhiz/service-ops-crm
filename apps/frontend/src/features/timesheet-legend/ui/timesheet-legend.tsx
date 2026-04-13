import React from 'react';

export function TimesheetLegend(): React.JSX.Element {
  return (
    <div className="page-card">
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
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            padding: 10,
          }}
        >
          Факт присутствия по сотруднику создает базовое значение дня автоматически
          по ставке объекта.
        </div>

        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            padding: 10,
          }}
        >
          Если факта присутствия нет, день по умолчанию считается нулевым.
        </div>

        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            padding: 10,
          }}
        >
          Ручное изменение ячейки помечает запись как измененную вручную и не
          дает системе перезаписать ее автоматически.
        </div>

        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            padding: 10,
          }}
        >
          Табель за месяц не должен терять сотрудников, если в этом месяце у них
          уже были attendance-факты.
        </div>
      </div>
    </div>
  );
}
