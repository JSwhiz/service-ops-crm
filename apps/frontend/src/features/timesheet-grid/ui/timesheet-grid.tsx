'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import type { TimesheetMonth } from '@/entities/timesheet/model/timesheet.types';
import { getCellDisplayValue } from '@/shared/lib/timesheet-presentation';

function buildKey(employeeId: string, dayOfMonth: number): string {
  return `${employeeId}:${dayOfMonth}`;
}

function getCellClassNames(params: {
  isChangedManually: boolean;
  hasFact: boolean;
}): string {
  return [
    params.isChangedManually ? 'timesheet-table__changed-cell' : '',
    params.hasFact ? 'timesheet-table__fact-cell' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function getCellTitle(params: {
  isChangedManually: boolean;
  hasFact: boolean;
  comment: string | null;
}): string | undefined {
  if (params.isChangedManually && params.hasFact && params.comment) {
    return `Ручная корректировка поверх attendance. Комментарий: ${params.comment}`;
  }

  if (params.isChangedManually && params.comment) {
    return `Ручная корректировка. Комментарий: ${params.comment}`;
  }

  if (params.isChangedManually) {
    return 'Ручная корректировка';
  }

  if (params.hasFact) {
    return 'Есть факт присутствия';
  }

  return undefined;
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
    comment?: string;
  }) => Promise<void>;
}): React.JSX.Element {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const days = useMemo(
    () => Array.from({ length: timesheet.daysInMonth }, (_, index) => index + 1),
    [timesheet.daysInMonth],
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = 0;
    }

    setDrafts({});
    setError(null);
    setSavingKey(null);
  }, [timesheet.objectId, timesheet.year, timesheet.month]);

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

      {error ? (
        <div
          className="page-card"
          style={{ color: '#b91c1c', marginBottom: 12 }}
        >
          {error}
        </div>
      ) : null}

      <div className="timesheet-shell">
        <div className="timesheet-scroll" ref={scrollRef}>
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
                    const currentValue =
                      drafts[key] ?? getCellDisplayValue(entry.dayValue);

                    const cellTitle = getCellTitle({
                      isChangedManually: entry.isChangedManually,
                      hasFact: entry.hasFact,
                      comment: entry.comment,
                    });

                    return (
                      <td
                        key={entry.dayOfMonth}
                        className={getCellClassNames({
                          isChangedManually: entry.isChangedManually,
                          hasFact: entry.hasFact,
                        })}
                        title={cellTitle}
                        style={{ position: 'relative' }}
                      >
                        {entry.isChangedManually ? (
                          <span
                            title={
                              entry.comment
                                ? `Ручная корректировка: ${entry.comment}`
                                : 'Ручная корректировка'
                            }
                            style={{
                              position: 'absolute',
                              top: 4,
                              right: 6,
                              fontSize: 10,
                              lineHeight: 1,
                              color: '#1d4ed8',
                              fontWeight: 700,
                              pointerEvents: 'none',
                            }}
                          >
                            M
                          </span>
                        ) : null}

                        <input
                          type="number"
                          inputMode="numeric"
                          value={currentValue}
                          disabled={savingKey === key}
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
                              setError('Введите корректное числовое значение.');
                              return;
                            }

                            if (parsed === entry.dayValue) {
                              setDrafts((prev) => {
                                const next = { ...prev };
                                delete next[key];
                                return next;
                              });
                              setError(null);
                              return;
                            }

                            const expectedAutoValue = entry.hasFact
                              ? timesheet.objectDailyRate
                              : 0;

                            let comment: string | undefined;

                            if (parsed !== expectedAutoValue) {
                              const promptResult = window.prompt(
                                'Укажите причину ручной корректировки табеля',
                                entry.comment ?? '',
                              );

                              if (promptResult === null) {
                                setError(
                                  'Корректировка отменена: причина изменения не указана.',
                                );
                                return;
                              }

                              const normalizedComment = promptResult.trim();

                              if (!normalizedComment) {
                                setError(
                                  'Для ручной корректировки табеля комментарий обязателен.',
                                );
                                return;
                              }

                              comment = normalizedComment;
                            }

                            setSavingKey(key);
                            setError(null);

                            try {
                              await onChangeEntry({
                                employeeId: row.employeeId,
                                dayOfMonth: entry.dayOfMonth,
                                dayValue: parsed,
                                comment,
                              });

                              setDrafts((prev) => {
                                const next = { ...prev };
                                delete next[key];
                                return next;
                              });
                            } catch (caughtError) {
                              if (
                                caughtError instanceof Error &&
                                caughtError.message.trim()
                              ) {
                                setError(caughtError.message);
                              } else {
                                setError('Не удалось сохранить изменение табеля.');
                              }
                            } finally {
                              setSavingKey(null);
                            }
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
                    const entry = row.entries.find(
                      (item) => item.dayOfMonth === day,
                    );
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
