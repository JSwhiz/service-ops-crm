'use client';

import React, { useMemo, useState } from 'react';

import type { TimesheetMonth } from '@/entities/timesheet/model/timesheet.types';
import { getCellDisplayValue } from '@/shared/lib/timesheet-presentation';

function buildKey(employeeId: string, dayOfMonth: number): string {
  return `${employeeId}:${dayOfMonth}`;
}

export function TimesheetGrid({
  timesheet,
  onChangeEntry,
}: {
  timesheet: TimesheetMonth;
  onChangeEntry: (payload: {
    employeeId: string;
    dayOfMonth: number;
    dayValue: number;
  }) => Promise<void>;
}): React.JSX.Element {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const days = useMemo(
    () => Array.from({ length: timesheet.daysInMonth }, (_, index) => index + 1),
    [timesheet.daysInMonth],
  );

  return (
    <div className="page-card" style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          minWidth: Math.max(1500, timesheet.daysInMonth * 76),
        }}
      >
        <thead>
          <tr>
            <th style={stickyLeftHeaderStyle}>Сотрудник</th>
            {days.map((day) => (
              <th key={day} style={headerCellStyle}>
                {day}
              </th>
            ))}
            <th style={stickyRightHeaderStyle}>Итого</th>
          </tr>
        </thead>

        <tbody>
          {timesheet.rows.map((row) => (
            <tr key={row.employeeId}>
              <td style={stickyLeftCellStyle}>{row.employeeName}</td>

              {row.entries.map((entry) => {
                const key = buildKey(row.employeeId, entry.dayOfMonth);
                const currentValue = drafts[key] ?? getCellDisplayValue(entry.dayValue);

                return (
                  <td
                    key={entry.dayOfMonth}
                    style={{
                      ...cellStyle,
                      background: entry.isChangedManually ? '#eff6ff' : '#fff',
                    }}
                  >
                    <input
                      type="number"
                      inputMode="numeric"
                      value={currentValue}
                      onChange={(event) => {
                        setDrafts((prev) => ({
                          ...prev,
                          [key]: event.target.value,
                        }));
                      }}
                      onBlur={async () => {
                        const raw = drafts[key];
                        if (raw === undefined) {
                          return;
                        }

                        const parsed = raw.trim() === '' ? 0 : Number(raw);
                        if (Number.isNaN(parsed)) {
                          return;
                        }

                        await onChangeEntry({
                          employeeId: row.employeeId,
                          dayOfMonth: entry.dayOfMonth,
                          dayValue: parsed,
                        });

                        setDrafts((prev) => {
                          const next = { ...prev };
                          delete next[key];
                          return next;
                        });
                      }}
                      style={{
                        width: 56,
                        padding: 6,
                        textAlign: 'center',
                        border: '1px solid #d1d5db',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                  </td>
                );
              })}

              <td style={stickyRightCellStyle}>{row.rowTotal}</td>
            </tr>
          ))}
        </tbody>

        <tfoot>
          <tr>
            <td style={stickyLeftFooterStyle}>Итого за месяц</td>
            {days.map((day) => {
              const dayTotal = timesheet.rows.reduce((sum, row) => {
                const entry = row.entries.find((item) => item.dayOfMonth === day);
                return sum + (entry?.dayValue ?? 0);
              }, 0);

              return (
                <td key={day} style={footerCellStyle}>
                  {dayTotal === 0 ? '' : dayTotal}
                </td>
              );
            })}
            <td style={stickyRightFooterStyle}>{timesheet.monthTotal}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const headerCellStyle: React.CSSProperties = {
  padding: '8px 6px',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'center',
  fontSize: 12,
  background: '#f8fafc',
};

const cellStyle: React.CSSProperties = {
  padding: '8px 6px',
  borderBottom: '1px solid #f0f2f5',
  textAlign: 'center',
};

const footerCellStyle: React.CSSProperties = {
  padding: '8px 6px',
  borderTop: '1px solid #e5e7eb',
  textAlign: 'center',
  fontSize: 12,
  background: '#f8fafc',
  fontWeight: 600,
};

const stickyLeftHeaderStyle: React.CSSProperties = {
  ...headerCellStyle,
  position: 'sticky',
  left: 0,
  zIndex: 3,
  minWidth: 220,
  textAlign: 'left',
};

const stickyLeftCellStyle: React.CSSProperties = {
  ...cellStyle,
  position: 'sticky',
  left: 0,
  zIndex: 2,
  minWidth: 220,
  textAlign: 'left',
  background: '#fff',
  fontWeight: 500,
};

const stickyLeftFooterStyle: React.CSSProperties = {
  ...footerCellStyle,
  position: 'sticky',
  left: 0,
  zIndex: 3,
  minWidth: 220,
  textAlign: 'left',
};

const stickyRightHeaderStyle: React.CSSProperties = {
  ...headerCellStyle,
  position: 'sticky',
  right: 0,
  zIndex: 3,
  minWidth: 100,
};

const stickyRightCellStyle: React.CSSProperties = {
  ...cellStyle,
  position: 'sticky',
  right: 0,
  zIndex: 2,
  minWidth: 100,
  background: '#fff',
  fontWeight: 600,
};

const stickyRightFooterStyle: React.CSSProperties = {
  ...footerCellStyle,
  position: 'sticky',
  right: 0,
  zIndex: 3,
  minWidth: 100,
};
