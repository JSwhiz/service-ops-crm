import React from 'react';

export function TimesheetLegend(): React.JSX.Element {
  return (
    <div className="page-card">
      <div style={{ fontWeight: 600, marginBottom: 12 }}>Как читать табель</div>

      <div
        style={{
          display: 'grid',
          gap: 8,
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}
      >
        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            padding: 10,
          }}
        >
          Пустая ячейка — значение 0
        </div>

        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            padding: 10,
          }}
        >
          В ячейке указывается цифра за день
        </div>

        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            padding: 10,
          }}
        >
          Справа показывается итог по сотруднику
        </div>

        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            padding: 10,
          }}
        >
          Сверху и внизу можно сверять месячный объем
        </div>
      </div>
    </div>
  );
}
