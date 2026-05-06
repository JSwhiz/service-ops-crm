'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { listObjects } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import {
  downloadTimesheetExcel,
  getTimesheet,
  getTimesheetCorrections,
  requestTimesheetManualException,
  upsertTimesheetEntry,
} from '@/entities/timesheet/api/timesheet-client';
import type {
  TimesheetCorrectionItem,
  TimesheetMonth,
} from '@/entities/timesheet/model/timesheet.types';
import { TimesheetCorrectionsPanel } from '@/features/timesheet-corrections/ui/timesheet-corrections-panel';
import { TimesheetFilters } from '@/features/timesheet-filters/ui/timesheet-filters';
import { TimesheetGrid } from '@/features/timesheet-grid/ui/timesheet-grid';
import { TimesheetLegend } from '@/features/timesheet-legend/ui/timesheet-legend';
import { PageTitle } from '@/shared/ui/page-title/page-title';

export default function TimesheetPage(): React.JSX.Element {
  const searchParams = useSearchParams();
  const initialObjectId = searchParams.get('objectId') ?? '';
  const initialYear = Number(searchParams.get('year') ?? '2026');
  const initialMonth = Number(searchParams.get('month') ?? '4');
  const [objects, setObjects] = useState<ServiceObject[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState(initialObjectId);
  const [selectedYear, setSelectedYear] = useState(
    Number.isFinite(initialYear) ? initialYear : 2026,
  );
  const [selectedMonth, setSelectedMonth] = useState(
    Number.isFinite(initialMonth) && initialMonth >= 1 && initialMonth <= 12
      ? initialMonth
      : 4,
  );

  const [timesheet, setTimesheet] = useState<TimesheetMonth | null>(null);
  const [corrections, setCorrections] = useState<TimesheetCorrectionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exceptionEmployeeId, setExceptionEmployeeId] = useState('');
  const [exceptionDayOfMonth, setExceptionDayOfMonth] = useState('1');
  const [exceptionDayValue, setExceptionDayValue] = useState('0');
  const [exceptionComment, setExceptionComment] = useState('');
  const [exceptionMessage, setExceptionMessage] = useState<string | null>(null);
  const [exceptionApprovalsHref, setExceptionApprovalsHref] = useState<string | null>(null);
  const [isSubmittingException, setIsSubmittingException] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);

  useEffect(() => {
    const loadObjects = async (): Promise<void> => {
      try {
        const response = await listObjects();
        setObjects(response);
        setSelectedObjectId((prev) => prev || initialObjectId || response[0]?.id || '');
      } catch {
        setLoadError('Не удалось загрузить список объектов.');
      }
    };

    void loadObjects();
  }, [initialObjectId]);

  useEffect(() => {
    if (!selectedObjectId) {
      return;
    }

    const loadTimesheetData = async (): Promise<void> => {
      setIsLoading(true);
      setLoadError(null);

      try {
        const [timesheetResponse, correctionsResponse] = await Promise.all([
          getTimesheet({
            objectId: selectedObjectId,
            year: selectedYear,
            month: selectedMonth,
          }),
          getTimesheetCorrections({
            objectId: selectedObjectId,
            year: selectedYear,
            month: selectedMonth,
          }),
        ]);

        setTimesheet(timesheetResponse);
        setCorrections(correctionsResponse);
        setExceptionEmployeeId((current) => current || timesheetResponse.rows[0]?.employeeId || '');
        setExceptionDayOfMonth((current) =>
          Number(current) > timesheetResponse.daysInMonth
            ? String(timesheetResponse.daysInMonth)
            : current,
        );
      } catch {
        setLoadError('Не удалось загрузить табель.');
      } finally {
        setIsLoading(false);
      }
    };

    void loadTimesheetData();
  }, [selectedObjectId, selectedYear, selectedMonth]);

  return (
    <>
      <PageTitle title="Табель" />

      <TimesheetFilters
        objects={objects}
        selectedObjectId={selectedObjectId}
        selectedYear={selectedYear}
        selectedMonth={selectedMonth}
        onObjectChange={setSelectedObjectId}
        onYearChange={setSelectedYear}
        onMonthChange={setSelectedMonth}
      />

      <TimesheetLegend />

      {isLoading ? (
        <div className="page-card">Загрузка...</div>
      ) : loadError ? (
        <div className="page-card" style={{ color: '#b91c1c' }}>
          {loadError}
        </div>
      ) : timesheet ? (
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="page-card timesheet-action-card">
            <div>
              <div className="section-title">Отчет табеля</div>
              <div className="section-subtitle">
                Excel содержит итог, авторасчет, отклонения и сводку.
              </div>
            </div>
            <button
              type="button"
              disabled={isExportingExcel}
              onClick={() => {
                setIsExportingExcel(true);
                void downloadTimesheetExcel({
                  objectId: selectedObjectId,
                  year: selectedYear,
                  month: selectedMonth,
                })
                  .then((blob) => {
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `timesheet-${selectedYear}-${String(selectedMonth).padStart(2, '0')}.xlsx`;
                    link.click();
                    URL.revokeObjectURL(url);
                  })
                  .catch(() => {
                    setLoadError('Не удалось выгрузить Excel.');
                  })
                  .finally(() => {
                    setIsExportingExcel(false);
                  });
              }}
            >
              {isExportingExcel ? 'Готовим Excel...' : 'Выгрузить Excel'}
            </button>
          </div>

          {!timesheet.capabilities.canManualCorrection ? (
            <div className="page-card timesheet-exception-card">
              <div>
                <div className="section-title">Запросить исключение табеля</div>
                <div className="section-subtitle">
                  Прямая ручная корректировка недоступна. Запрос уйдет в approvals
                  и применится только после подтверждения.
                </div>
              </div>

              {timesheet.rows.length > 0 ? (
                <form
                  style={{
                    display: 'grid',
                    gap: 12,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  }}
                  onSubmit={(event) => {
                    event.preventDefault();
                    setIsSubmittingException(true);
                    setExceptionMessage(null);

                    void requestTimesheetManualException({
                      objectId: selectedObjectId,
                      year: selectedYear,
                      month: selectedMonth,
                      employeeId: exceptionEmployeeId,
                      dayOfMonth: Number(exceptionDayOfMonth),
                      dayValue: Number(exceptionDayValue),
                      comment: exceptionComment,
                    })
                      .then((request) => {
                        setExceptionMessage('Запрос на исключение табеля отправлен в approvals queue.');
                        setExceptionApprovalsHref(
                          `/approvals?sourceEntityType=${request.sourceEntityType}&sourceEntityId=${request.sourceEntityId}`,
                        );
                        setExceptionComment('');
                      })
                      .catch(() => {
                        setExceptionMessage('Не удалось создать exception request для табеля.');
                        setExceptionApprovalsHref(null);
                      })
                      .finally(() => {
                        setIsSubmittingException(false);
                      });
                  }}
                >
                  <label>
                    <div style={{ marginBottom: 6 }}>Сотрудник</div>
                    <select
                      value={exceptionEmployeeId}
                      onChange={(event) => setExceptionEmployeeId(event.target.value)}
                      required
                    >
                      {timesheet.rows.map((row) => (
                        <option key={row.employeeId} value={row.employeeId}>
                          {row.employeeName}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <div style={{ marginBottom: 6 }}>День</div>
                    <input
                      type="number"
                      min="1"
                      max={timesheet.daysInMonth}
                      value={exceptionDayOfMonth}
                      onChange={(event) => setExceptionDayOfMonth(event.target.value)}
                      required
                    />
                  </label>

                  <label>
                    <div style={{ marginBottom: 6 }}>Новое значение</div>
                    <input
                      type="number"
                      value={exceptionDayValue}
                      onChange={(event) => setExceptionDayValue(event.target.value)}
                      required
                    />
                  </label>

                  <label style={{ gridColumn: '1 / -1' }}>
                    <div style={{ marginBottom: 6 }}>Причина</div>
                    <textarea
                      rows={2}
                      value={exceptionComment}
                      onChange={(event) => setExceptionComment(event.target.value)}
                      placeholder="Почему нужно отклониться от automatic value"
                      required
                    />
                  </label>

                  <div className="action-row" style={{ gridColumn: '1 / -1' }}>
                    <button
                      type="submit"
                      disabled={isSubmittingException || !exceptionEmployeeId}
                    >
                      {isSubmittingException
                        ? 'Отправляем...'
                        : 'Запросить исключение'}
                    </button>
                    {exceptionApprovalsHref ? (
                      <Link href={exceptionApprovalsHref}>Открыть согласование</Link>
                    ) : null}
                  </div>
                </form>
              ) : null}

              {exceptionMessage ? (
                <div
                  style={{
                    color: exceptionApprovalsHref ? '#15803d' : '#b91c1c',
                  }}
                >
                  {exceptionMessage}
                </div>
              ) : null}
            </div>
          ) : null}

          <TimesheetGrid
            key={`${selectedObjectId}-${selectedYear}-${selectedMonth}`}
            timesheet={timesheet}
            canEditEntries={timesheet.capabilities.canManualCorrection}
            onChangeEntry={async (payload) => {
              const updatedTimesheet = await upsertTimesheetEntry({
                objectId: selectedObjectId,
                year: selectedYear,
                month: selectedMonth,
                employeeId: payload.employeeId,
                dayOfMonth: payload.dayOfMonth,
                dayValue: payload.dayValue,
                comment: payload.comment,
              });

              const updatedCorrections = await getTimesheetCorrections({
                objectId: selectedObjectId,
                year: selectedYear,
                month: selectedMonth,
              });

              setTimesheet(updatedTimesheet);
              setCorrections(updatedCorrections);
            }}
          />

          <TimesheetCorrectionsPanel items={corrections} />
        </div>
      ) : (
        <div className="page-card">Нет данных табеля.</div>
      )}
    </>
  );
}
