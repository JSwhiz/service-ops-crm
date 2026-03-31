'use client';

import React from 'react';

import type { TimesheetMonth } from '@/entities/timesheet/model/timesheet.types';
import { ATTENDANCE_OPTIONS } from '@/shared/lib/timesheet-presentation';

function getEntryStatus(
  row: TimesheetMonth['rows'][number],
  dayOfMonth: number,
): string {
  return row.entries.find((entry) => entry.dayOfMonth === dayOfMonth)?.attendanceStatus ?? '';
}

export function TimesheetGrid({
  timesheet,
  onChangeEntry,
}: {
  timesheet: TimesheetMonth;
  onChangeEntry: (payload: {
    employeeId: string;
    dayOfMonth: number;
    attendanceStatus: 'present' | 'absent' | 'sick' | 'vacation' | 'day_off';
  }) => Promise<void>;
}): React.JSX.Element {
  const days = Array.from({ length: timesheet.daysInMonth }, (_, index) => index + 1);

  return (
    <div className="page-card" style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          minWidth: Math.max(1200, timesheet.daysInMonth * 56),
        }}
      >
        <thead>
          <tr>
            <th style={stickyThStyle}>Сотрудник</th>
            {days.map((day) => (
              <th key={day} style={thStyle}>
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {timesheet.rows.map((row) => (
            <tr key={row.employeeId}>
              <td style={stickyTdStyle}>{row.employeeName}</td>
              {days.map((day) => {
                const currentValue = getEntryStatus(row, day);

                return (
                  <td key={day} style={tdStyle}>
                    <select
                      value={currentValue}
                      onChange={async (event) => {
                        const value = event.target.value as
                          | 'present'
                          | 'absent'
                          | 'sick'
                          | 'vacation'
                          | 'day_off';

                        if (!value) {
                          return;
                        }

                        await onChangeEntry({
                          employeeId: row.employeeId,
                          dayOfMonth: day,
                          attendanceStatus: value,
                        });
                      }}
                      style={{
                        width: 52,
                        padding: 6,
                        fontSize: 12,
                      }}
                    >
                      <option value="">—</option>
                      {ATTENDANCE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.shortLabel}
                        </option>
                      ))}
                    </select>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '8px 6px',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'center',
  fontSize: 12,
};

const tdStyle: React.CSSProperties = {
  padding: '8px 6px',
  borderBottom: '1px solid #f0f2f5',
  textAlign: 'center',
};

const stickyThStyle: React.CSSProperties = {
  ...thStyle,
  position: 'sticky',
  left: 0,
  background: '#fff',
  zIndex: 2,
  minWidth: 220,
  textAlign: 'left',
};

const stickyTdStyle: React.CSSProperties = {
  ...tdStyle,
  position: 'sticky',
  left: 0,
  background: '#fff',
  zIndex: 1,
  minWidth: 220,
  textAlign: 'left',
  fontWeight: 500,
};
