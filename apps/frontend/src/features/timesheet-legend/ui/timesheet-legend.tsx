import React from 'react';

import { ATTENDANCE_OPTIONS } from '@/shared/lib/timesheet-presentation';

export function TimesheetLegend(): React.JSX.Element {
  return (
    <div className="page-card">
      <div style={{ fontWeight: 600, marginBottom: 12 }}>Легенда статусов</div>

      <div
        style={{
          display: 'grid',
          gap: 8,
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        }}
      >
        {ATTENDANCE_OPTIONS.map((option) => (
          <div
            key={option.value}
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              padding: 10,
            }}
          >
            <strong>{option.shortLabel}</strong>
            <span>{option.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
