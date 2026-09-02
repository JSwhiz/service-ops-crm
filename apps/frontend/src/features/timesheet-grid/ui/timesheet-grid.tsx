'use client';

import React, { useMemo } from 'react';

import type { TimesheetMonth } from '@/entities/timesheet/model/timesheet.types';
import {
  TimesheetCellEditor,
  type TimesheetCellMutation,
} from '@/features/timesheet-cell-editing/ui/timesheet-cell-editor';
import { isTimesheetDateEditable } from '@/shared/lib/timesheet-edit-window';

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
});

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
  autoValue: number;
  finalValue: number;
  difference: number;
  calculationExplanation: string | null;
}): string | undefined {
  const base = [
    `Auto: ${params.autoValue}`,
    `Final: ${params.finalValue}`,
    params.difference !== 0 ? `Отклонение: ${params.difference}` : null,
    params.calculationExplanation,
  ]
    .filter(Boolean)
    .join('. ');

  if (params.isChangedManually && params.comment) {
    return `Ручная корректировка. Комментарий: ${params.comment}. ${base}`;
  }
  if (params.hasFact) return `Есть факт присутствия. ${base}`;
  return base || undefined;
}

export function TimesheetGrid({
  timesheet,
  canEditEntries,
  onDirectChange,
  onRequestCorrection,
  onOpenDetails,
}: {
  timesheet: TimesheetMonth;
  canEditEntries: boolean;
  onDirectChange: (payload: TimesheetCellMutation) => Promise<void>;
  onRequestCorrection: (payload: Required<TimesheetCellMutation>) => Promise<void>;
  onOpenDetails?: (employeeId: string) => void;
}): React.JSX.Element {
  const days = useMemo(
    () => Array.from({ length: timesheet.daysInMonth }, (_, index) => index + 1),
    [timesheet.daysInMonth],
  );

  return (
    <div className="timesheet-card">
      <div className="timesheet-card__meta">
        <div><strong>Объект:</strong> {timesheet.objectName}</div>
        <div><strong>Ставка объекта:</strong> {timesheet.objectDailyRate}</div>
        <div><strong>Аванс:</strong> {moneyFormatter.format(timesheet.advanceTotal)}</div>
        <div><strong>ЗП:</strong> {moneyFormatter.format(timesheet.salaryTotal)}</div>
        <div><strong>Итого:</strong> {moneyFormatter.format(timesheet.monthTotal)}</div>
      </div>

      <div className="timesheet-shell">
        <div className="timesheet-scroll">
          <table className="timesheet-table">
            <colgroup>
              <col style={{ width: 240 }} />
              {days.map((day) => <col key={day} style={{ width: 76 }} />)}
              <col style={{ width: 120 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 120 }} />
            </colgroup>

            <thead>
              <tr>
                <th className="timesheet-table__sticky-left">Сотрудник</th>
                {days.map((day) => <th key={day}>{day}</th>)}
                <th className="timesheet-table__summary">Аванс</th>
                <th className="timesheet-table__summary">ЗП</th>
                <th className="timesheet-table__summary timesheet-table__sticky-right">Итого</th>
              </tr>
            </thead>

            <tbody>
              {timesheet.rows.map((row) => (
                <tr key={row.employeeId}>
                  <td className="timesheet-table__sticky-left timesheet-table__name">{row.employeeName}</td>
                  {row.entries.map((entry) => (
                    <td
                      key={entry.dayOfMonth}
                      className={getCellClassNames({ isChangedManually: entry.isChangedManually, hasFact: entry.hasFact })}
                      title={getCellTitle({
                        isChangedManually: entry.isChangedManually,
                        hasFact: entry.hasFact,
                        comment: entry.comment,
                        autoValue: entry.autoValue,
                        finalValue: entry.finalValue,
                        difference: entry.difference,
                        calculationExplanation: entry.calculationExplanation,
                      })}
                    >
                      <TimesheetCellEditor
                        objectId={timesheet.objectId}
                        objectName={timesheet.objectName}
                        employeeId={row.employeeId}
                        employeeName={row.employeeName}
                        year={timesheet.year}
                        month={timesheet.month}
                        dayOfMonth={entry.dayOfMonth}
                        finalValue={entry.finalValue}
                        autoValue={entry.autoValue}
                        isChangedManually={entry.isChangedManually}
                        comment={entry.comment}
                        canDirectEdit={canEditEntries}
                        canRequestCorrection={!canEditEntries}
                        isEditableDate={isTimesheetDateEditable({ year: timesheet.year, month: timesheet.month, dayOfMonth: entry.dayOfMonth })}
                        onDirectChange={onDirectChange}
                        onRequestCorrection={onRequestCorrection}
                        onOpenDetails={onOpenDetails ? () => onOpenDetails(row.employeeId) : undefined}
                      />
                    </td>
                  ))}
                  <td className="timesheet-table__summary timesheet-table__total">{moneyFormatter.format(row.advanceTotal)}</td>
                  <td className="timesheet-table__summary timesheet-table__total">{moneyFormatter.format(row.salaryTotal)}</td>
                  <td className="timesheet-table__summary timesheet-table__sticky-right timesheet-table__total">{moneyFormatter.format(row.rowTotal)}</td>
                </tr>
              ))}
            </tbody>

            <tfoot>
              <tr>
                <td className="timesheet-table__sticky-left timesheet-table__footer-label">Итого</td>
                {days.map((day) => {
                  const dayTotal = timesheet.rows.reduce((sum, row) => {
                    const entry = row.entries.find((item) => item.dayOfMonth === day);
                    return sum + (entry?.dayValue ?? 0);
                  }, 0);
                  return <td key={day}>{dayTotal === 0 ? '' : dayTotal}</td>;
                })}
                <td className="timesheet-table__summary timesheet-table__grand-total">{moneyFormatter.format(timesheet.advanceTotal)}</td>
                <td className="timesheet-table__summary timesheet-table__grand-total">{moneyFormatter.format(timesheet.salaryTotal)}</td>
                <td className="timesheet-table__sticky-right timesheet-table__grand-total">{moneyFormatter.format(timesheet.monthTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
