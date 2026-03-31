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
    <div className="timesheet-card">
      <div className="timesheet-card__meta">
        <div>
          <strong>Объект:</strong> {timesheet.objectName}
        </div>
        <div>
          <strong>Ставка объекта:</strong> {timesheet.objectDailyRate}
        </div>
        <div>
          <strong>Итого за месяц:</strong> {timesheet.monthTotal}
        </div>
      </div>

      <div className="timesheet-shell">
        <div className="timesheet-scroll">
          <table className="timesheet-table">
            <colgroup>
              <col style={{ width: 240 }} />
              {days.map((day) => (
                <col key={day} style={{ width: 76 }} />
              ))}
              <col style={{ width: 120 }} />
            </colgroup>

            <thead>
              <tr>
                <th className="timesheet-table__sticky-left">Сотрудник</th>
                {days.map((day) => (
                  <th key={day}>{day}</th>
                ))}
                <th className="timesheet-table__sticky-right">Итого</th>
              </tr>
            </thead>

            <tbody>
              {timesheet.rows.map((row) => (
                <tr key={row.employeeId}>
                  <td className="timesheet-table__sticky-left timesheet-table__name">
                    {row.employeeName}
                  </td>

                  {row.entries.map((entry) => {
                    const key = buildKey(row.employeeId, entry.dayOfMonth);
                    const currentValue = drafts[key] ?? getCellDisplayValue(entry.dayValue);

                    return (
                      <td
                        key={entry.dayOfMonth}
                        className={[
                          entry.isChangedManually ? 'timesheet-table__changed-cell' : '',
                          entry.hasFact ? 'timesheet-table__fact-cell' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
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
                          className="timesheet-table__input"
                        />
                      </td>
                    );
                  })}

                  <td className="timesheet-table__sticky-right timesheet-table__total">
                    {row.rowTotal}
                  </td>
                </tr>
              ))}
            </tbody>

            <tfoot>
              <tr>
                <td className="timesheet-table__sticky-left timesheet-table__footer-label">
                  Итого
                </td>
                {days.map((day) => {
                  const dayTotal = timesheet.rows.reduce((sum, row) => {
                    const entry = row.entries.find((item) => item.dayOfMonth === day);
                    return sum + (entry?.dayValue ?? 0);
                  }, 0);

                  return <td key={day}>{dayTotal === 0 ? '' : dayTotal}</td>;
                })}
                <td className="timesheet-table__sticky-right timesheet-table__grand-total">
                  {timesheet.monthTotal}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
