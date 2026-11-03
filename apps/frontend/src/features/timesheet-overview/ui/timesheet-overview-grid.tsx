import React from 'react';

import type {
  TimesheetOverview,
} from '@/entities/timesheet/model/timesheet.types';
import {
  TimesheetCellEditor,
  type TimesheetCellMutation,
} from '@/features/timesheet-cell-editing/ui/timesheet-cell-editor';
import { isTimesheetDateEditable } from '@/shared/lib/timesheet-edit-window';
import { Surface } from '@/shared/ui/foundation';
import timesheetStyles from '@/entities/timesheet/ui/timesheet-ui.module.css';
import { TimesheetIdentity } from '@/entities/timesheet/ui/timesheet-identity';
import { TimesheetScrollRegion } from '@/features/timesheet-grid/ui/timesheet-scroll-region';
import { TimesheetDayHeading } from '@/features/timesheet-grid/ui/timesheet-day-heading';

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
});

function formatMoney(value: number): string {
  return moneyFormatter.format(Number.isFinite(value) ? value : 0);
}

export function TimesheetOverviewGrid({
  overview,
  mutationsBlocked = false,
  refreshing = false,
  dataRevision = 0,
  onRefresh,
  onDirectChange,
  onRequestCorrection,
  onOpenDetails,
}: {
  overview: TimesheetOverview;
  mutationsBlocked?: boolean;
  refreshing?: boolean;
  dataRevision?: number;
  onRefresh?: () => void;
  onDirectChange: (payload: TimesheetCellMutation) => Promise<'pending' | void>;
  onRequestCorrection: (payload: Required<TimesheetCellMutation>) => Promise<void>;
  onOpenDetails: (objectId: string, employeeId: string) => void;
}): React.JSX.Element {
  const days = Array.from(
    { length: overview.daysInMonth },
    (_unused, index) => index + 1,
  );

  return (
    <div className={timesheetStyles.timesheetOverview} aria-busy={refreshing}>
      <div className={timesheetStyles.timesheetOverviewTotals} aria-label="Итоги табеля">
        <div><span>Аванс (начислено)</span><strong>{formatMoney(overview.totals.advanceTotal)}</strong></div>
        <div><span>Зарплата (начислено)</span><strong>{formatMoney(overview.totals.salaryTotal)}</strong></div>
        <div><span>Итого по выбранным фильтрам</span><strong>{formatMoney(overview.totals.monthTotal)}</strong></div>
      </div>

      {overview.rows.length === 0 ? (
        <Surface padding="md">По выбранным фильтрам строк табеля нет.</Surface>
      ) : (
        <>
          <div className={timesheetStyles.timesheetOverviewDesktop}>
            <TimesheetScrollRegion year={overview.year} month={overview.month} stickyWidth={240} className={timesheetStyles.timesheetOverviewScroll ?? ''}>
              <table className={timesheetStyles.timesheetOverviewTable}>
                <caption className={timesheetStyles.timesheetCaption}>Начисления по дням, ₽. Прочерк означает 0 ₽; маркер — ручная корректировка. Выберите ячейку для просмотра. Стрелки перемещают фокус.</caption>
                <colgroup>
                  <col style={{ width: 96 }} /><col style={{ width: 144 }} />
                  {days.map((day) => <col key={day} style={{ width: 76 }} />)}
                  <col style={{ width: 144 }} /><col style={{ width: 144 }} /><col style={{ width: 120 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col" className="is-object">Объект</th>
                    <th scope="col" className="is-employee">Сотрудник</th>
                    {days.map((day) => <TimesheetDayHeading key={day} year={overview.year} month={overview.month} day={day} />)}
                    <th scope="col" className="is-summary">Аванс (начислено)</th>
                    <th scope="col" className="is-summary">Зарплата (начислено)</th>
                    <th scope="col" className="is-summary is-total">Итого</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.rows.map((row) => (
                    <tr key={`${row.objectId}:${row.employeeId}`}>
                      <td className="is-object"><TimesheetIdentity name={row.objectName} /></td>
                      <th scope="row" className="is-employee"><TimesheetIdentity name={row.employeeName} person /></th>
                      {row.entries.map((entry) => (
                        <td
                          key={entry.dayOfMonth}
                          data-timesheet-day={entry.dayOfMonth}
                          className={entry.isChangedManually ? 'is-manual' : entry.hasFact ? 'has-fact' : undefined}
                        >
                          <TimesheetCellEditor
                            key={`${overview.year}:${overview.month}:${row.objectId}:${row.employeeId}:${entry.dayOfMonth}`}
                            mutationsBlocked={mutationsBlocked}
                            refreshing={refreshing}
                            dataRevision={dataRevision}
                            onRefresh={onRefresh}
                            entry={entry}
                            objectId={row.objectId}
                            objectName={row.objectName}
                            employeeId={row.employeeId}
                            employeeName={row.employeeName}
                            year={overview.year}
                            month={overview.month}
                            dayOfMonth={entry.dayOfMonth}
                            finalValue={entry.finalValue}
                            autoValue={entry.autoValue}
                            isChangedManually={entry.isChangedManually}
                            comment={entry.comment}
                            canDirectEdit={overview.capabilities.canManualCorrection}
                            canRequestCorrection={!overview.capabilities.canManualCorrection}
                            isEditableDate={isTimesheetDateEditable({ year: overview.year, month: overview.month, dayOfMonth: entry.dayOfMonth })}
                            onDirectChange={onDirectChange}
                            onRequestCorrection={onRequestCorrection}
                            onOpenDetails={() => onOpenDetails(row.objectId, row.employeeId)}
                          />
                        </td>
                      ))}
                      <td className="is-summary">{formatMoney(row.advanceTotal)}</td>
                      <td className="is-summary">{formatMoney(row.salaryTotal)}</td>
                      <td className="is-summary is-total">{formatMoney(row.monthTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TimesheetScrollRegion>
          </div>

        </>
      )}
    </div>
  );
}
