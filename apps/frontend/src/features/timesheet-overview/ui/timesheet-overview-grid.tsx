import React from 'react';

import type {
  TimesheetOverview,
  TimesheetOverviewEntry,
} from '@/entities/timesheet/model/timesheet.types';

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
});

function formatMoney(value: number): string {
  return moneyFormatter.format(Number.isFinite(value) ? value : 0);
}

function getEntryTitle(entry: TimesheetOverviewEntry): string {
  return [
    `Авто: ${entry.autoValue}`,
    `Итог: ${entry.finalValue}`,
    entry.workedHours !== null ? `Часы: ${entry.workedHours}` : null,
    entry.comment,
    entry.calculationExplanation,
  ]
    .filter(Boolean)
    .join('. ');
}

export function TimesheetOverviewGrid({
  overview,
}: {
  overview: TimesheetOverview;
}): React.JSX.Element {
  const days = Array.from(
    { length: overview.daysInMonth },
    (_unused, index) => index + 1,
  );

  return (
    <div className="timesheet-overview">
      <div className="timesheet-overview__totals" aria-label="Итоги табеля">
        <div><span>Аванс</span><strong>{formatMoney(overview.totals.advanceTotal)}</strong></div>
        <div><span>ЗП</span><strong>{formatMoney(overview.totals.salaryTotal)}</strong></div>
        <div><span>Итого за месяц</span><strong>{formatMoney(overview.totals.monthTotal)}</strong></div>
      </div>

      {overview.rows.length === 0 ? (
        <div className="page-card">За выбранный период начислений нет.</div>
      ) : (
        <>
          <div className="timesheet-overview__desktop">
            <div className="timesheet-overview__scroll">
              <table className="timesheet-overview__table">
                <thead>
                  <tr>
                    <th className="is-object">Объект</th>
                    <th className="is-employee">Сотрудник</th>
                    {days.map((day) => <th key={day}>{day}</th>)}
                    <th className="is-summary">Аванс</th>
                    <th className="is-summary">ЗП</th>
                    <th className="is-summary is-total">Итого</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.rows.map((row) => (
                    <tr key={`${row.objectId}:${row.employeeId}`}>
                      <td className="is-object">{row.objectName}</td>
                      <td className="is-employee">{row.employeeName}</td>
                      {row.entries.map((entry) => (
                        <td
                          key={entry.dayOfMonth}
                          className={entry.isChangedManually ? 'is-manual' : entry.hasFact ? 'has-fact' : undefined}
                          title={getEntryTitle(entry)}
                        >
                          {entry.finalValue === 0 ? '—' : entry.finalValue}
                        </td>
                      ))}
                      <td className="is-summary">{formatMoney(row.advanceTotal)}</td>
                      <td className="is-summary">{formatMoney(row.salaryTotal)}</td>
                      <td className="is-summary is-total">{formatMoney(row.monthTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="timesheet-overview__mobile">
            {overview.rows.map((row) => (
              <article className="timesheet-overview-card" key={`${row.objectId}:${row.employeeId}`}>
                <div className="timesheet-overview-card__header">
                  <span>{row.objectName}</span>
                  <strong>{row.employeeName}</strong>
                </div>
                <div className="timesheet-overview-card__totals">
                  <div><span>Аванс</span><strong>{formatMoney(row.advanceTotal)}</strong></div>
                  <div><span>ЗП</span><strong>{formatMoney(row.salaryTotal)}</strong></div>
                  <div><span>Итого</span><strong>{formatMoney(row.monthTotal)}</strong></div>
                </div>
                <details>
                  <summary>Дни месяца</summary>
                  <div className="timesheet-overview-card__days">
                    {row.entries.map((entry) => (
                      <div
                        key={entry.dayOfMonth}
                        className={entry.isChangedManually ? 'is-manual' : entry.hasFact ? 'has-fact' : undefined}
                        title={getEntryTitle(entry)}
                      >
                        <span>{entry.dayOfMonth}</span>
                        <strong>{entry.finalValue === 0 ? '—' : entry.finalValue}</strong>
                      </div>
                    ))}
                  </div>
                </details>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
