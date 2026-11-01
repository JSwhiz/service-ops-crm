'use client';

import React, { useMemo } from 'react';

import type { TimesheetMonth } from '@/entities/timesheet/model/timesheet.types';
import {
  TimesheetCellEditor,
  type TimesheetCellMutation,
} from '@/features/timesheet-cell-editing/ui/timesheet-cell-editor';
import { isTimesheetDateEditable } from '@/shared/lib/timesheet-edit-window';
import timesheetStyles from '@/entities/timesheet/ui/timesheet-ui.module.css';
import { TimesheetIdentity } from '@/entities/timesheet/ui/timesheet-identity';
import { TimesheetScrollRegion } from './timesheet-scroll-region';
import { TimesheetDayHeading } from './timesheet-day-heading';

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
    params.isChangedManually ? timesheetStyles.timesheetTableChangedCell : '',
    params.hasFact ? timesheetStyles.timesheetTableFactCell : '',
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
    `Автоматическое значение: ${params.autoValue}`,
    `Начислено: ${params.finalValue}`,
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
    <div className={timesheetStyles.timesheetCard}>
      <div className={timesheetStyles.timesheetCardMeta}>
        <div><strong>Объект:</strong> {timesheet.objectName}</div>
        <div>
          <strong>Оплата:</strong>{' '}
          {timesheet.objectPaymentType === 'monthly'
            ? `${moneyFormatter.format(timesheet.objectMonthlySalary)} / месяц`
            : `${moneyFormatter.format(timesheet.objectDailyRate)} / выход`}
        </div>
        <div><strong>Аванс (начислено):</strong> {moneyFormatter.format(timesheet.advanceTotal)}</div>
        <div><strong>Зарплата (начислено):</strong> {moneyFormatter.format(timesheet.salaryTotal)}</div>
        <div><strong>Итого:</strong> {moneyFormatter.format(timesheet.monthTotal)}</div>
      </div>

      <div className={timesheetStyles.timesheetShell}>
        <TimesheetScrollRegion year={timesheet.year} month={timesheet.month} stickyWidth={160} className={timesheetStyles.timesheetScroll ?? ''}>
          <table className={timesheetStyles.timesheetTable}>
            <caption className={timesheetStyles.timesheetCaption}>Начисления по дням, ₽. Прочерк означает 0 ₽; маркер — ручная корректировка. Выберите ячейку для просмотра. Стрелки перемещают фокус.</caption>
            <colgroup>
              <col style={{ width: 160 }} />
              {days.map((day) => <col key={day} style={{ width: 76 }} />)}
              <col style={{ width: 120 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 120 }} />
            </colgroup>

            <thead>
              <tr>
                <th scope="col" className={timesheetStyles.timesheetTableStickyLeft}>Сотрудник</th>
                {days.map((day) => <TimesheetDayHeading key={day} year={timesheet.year} month={timesheet.month} day={day} />)}
                <th scope="col" className={timesheetStyles.timesheetTableSummary}>Аванс (начислено)</th>
                <th scope="col" className={timesheetStyles.timesheetTableSummary}>Зарплата (начислено)</th>
                <th scope="col" data-sticky-total className={`${timesheetStyles.timesheetTableSummary} ${timesheetStyles.timesheetTableStickyRight}`}>Итого</th>
              </tr>
            </thead>

            <tbody>
              {timesheet.rows.map((row) => (
                <tr key={row.employeeId}>
                  <th scope="row" className={`${timesheetStyles.timesheetTableStickyLeft} ${timesheetStyles.timesheetTableName}`}><TimesheetIdentity name={row.employeeName} person /></th>
                  {row.entries.map((entry) => (
                    <td
                      key={entry.dayOfMonth}
                      data-timesheet-day={entry.dayOfMonth}
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
                        entry={entry}
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
                  <td className={`${timesheetStyles.timesheetTableSummary} ${timesheetStyles.timesheetTableTotal}`}>{moneyFormatter.format(row.advanceTotal)}</td>
                  <td className={`${timesheetStyles.timesheetTableSummary} ${timesheetStyles.timesheetTableTotal}`}>{moneyFormatter.format(row.salaryTotal)}</td>
                  <td className={`${timesheetStyles.timesheetTableSummary} ${timesheetStyles.timesheetTableStickyRight} ${timesheetStyles.timesheetTableTotal}`}>{moneyFormatter.format(row.rowTotal)}</td>
                </tr>
              ))}
            </tbody>

            <tfoot>
              <tr>
                <td className={`${timesheetStyles.timesheetTableStickyLeft} ${timesheetStyles.timesheetTableFooterLabel}`}>Итого</td>
                {days.map((day) => {
                  const dayTotal = timesheet.rows.reduce((sum, row) => {
                    const entry = row.entries.find((item) => item.dayOfMonth === day);
                    return sum + (entry?.dayValue ?? 0);
                  }, 0);
                  return <td key={day}>{dayTotal === 0 ? '' : dayTotal}</td>;
                })}
                <td className={`${timesheetStyles.timesheetTableSummary} ${timesheetStyles.timesheetTableGrandTotal}`}>{moneyFormatter.format(timesheet.advanceTotal)}</td>
                <td className={`${timesheetStyles.timesheetTableSummary} ${timesheetStyles.timesheetTableGrandTotal}`}>{moneyFormatter.format(timesheet.salaryTotal)}</td>
                <td className={`${timesheetStyles.timesheetTableStickyRight} ${timesheetStyles.timesheetTableGrandTotal}`}>{moneyFormatter.format(timesheet.monthTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </TimesheetScrollRegion>
      </div>
    </div>
  );
}
