'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';

import {
  downloadTimesheetOverviewExcel,
  getTimesheet,
  getTimesheetCorrections,
  getTimesheetOverview,
  listTimesheetOverviewEmployees,
  listTimesheetOverviewObjects,
  requestTimesheetManualException,
  upsertTimesheetEntry,
} from '@/entities/timesheet/api/timesheet-client';
import type {
  TimesheetCorrectionItem,
  TimesheetMonth,
  TimesheetOverview,
} from '@/entities/timesheet/model/timesheet.types';
import { TimesheetCorrectionsPanel } from '@/features/timesheet-corrections/ui/timesheet-corrections-panel';
import { TimesheetGrid } from '@/features/timesheet-grid/ui/timesheet-grid';
import { TimesheetLegend } from '@/features/timesheet-legend/ui/timesheet-legend';
import { TimesheetOverviewGrid } from '@/features/timesheet-overview/ui/timesheet-overview-grid';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/shared/ui/searchable-select/searchable-select';

function parsePeriod(searchParams: URLSearchParams): { year: number; month: number } {
  const now = new Date();
  const year = Number(searchParams.get('year'));
  const month = Number(searchParams.get('month'));
  return {
    year: Number.isInteger(year) && year >= 2024 && year <= 2100
      ? year
      : now.getFullYear(),
    month: Number.isInteger(month) && month >= 1 && month <= 12
      ? month
      : now.getMonth() + 1,
  };
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export default function TimesheetPage(): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { year, month } = parsePeriod(searchParams);
  const objectId = searchParams.get('objectId') ?? '';
  const employeeId = searchParams.get('employeeId') ?? '';
  const [overview, setOverview] = useState<TimesheetOverview | null>(null);
  const [objectTimesheet, setObjectTimesheet] = useState<TimesheetMonth | null>(null);
  const [corrections, setCorrections] = useState<TimesheetCorrectionItem[]>([]);
  const [selectedObject, setSelectedObject] = useState<SearchableSelectOption | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<SearchableSelectOption | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const overviewRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const [exceptionEmployeeId, setExceptionEmployeeId] = useState('');
  const [exceptionDayOfMonth, setExceptionDayOfMonth] = useState('1');
  const [exceptionDayValue, setExceptionDayValue] = useState('0');
  const [exceptionComment, setExceptionComment] = useState('');
  const [exceptionMessage, setExceptionMessage] = useState<string | null>(null);
  const [exceptionApprovalsHref, setExceptionApprovalsHref] = useState<string | null>(null);
  const [isSubmittingException, setIsSubmittingException] = useState(false);

  const replaceFilters = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.replace(`${pathname}?${next.toString()}`);
  };

  useEffect(() => {
    if (searchParams.has('year') && searchParams.has('month')) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set('year', String(year));
    next.set('month', String(month));
    router.replace(`${pathname}?${next.toString()}`);
  }, [month, pathname, router, searchParams, year]);

  useEffect(() => {
    const requestId = ++overviewRequestRef.current;
    setLoading(true);
    setError(null);
    void getTimesheetOverview({
      year,
      month,
      objectId: objectId || undefined,
      employeeId: employeeId || undefined,
    })
      .then((result) => {
        if (requestId === overviewRequestRef.current) setOverview(result);
      })
      .catch(() => {
        if (requestId === overviewRequestRef.current) {
          setOverview(null);
          setError('Не удалось загрузить сводный табель.');
        }
      })
      .finally(() => {
        if (requestId === overviewRequestRef.current) setLoading(false);
      });
  }, [employeeId, month, objectId, refreshVersion, year]);

  useEffect(() => {
    if (!objectId) {
      setObjectTimesheet(null);
      setCorrections([]);
      setDetailError(null);
      return;
    }
    const requestId = ++detailRequestRef.current;
    setDetailLoading(true);
    setDetailError(null);
    void Promise.all([
      getTimesheet({ objectId, year, month }),
      getTimesheetCorrections({ objectId, year, month }),
    ])
      .then(([timesheet, nextCorrections]) => {
        if (requestId !== detailRequestRef.current) return;
        setObjectTimesheet(timesheet);
        setCorrections(nextCorrections);
        setExceptionEmployeeId((current) =>
          timesheet.rows.some((row) => row.employeeId === current)
            ? current
            : timesheet.rows[0]?.employeeId ?? '',
        );
      })
      .catch(() => {
        if (requestId === detailRequestRef.current) {
          setObjectTimesheet(null);
          setDetailError('Не удалось загрузить детализацию объекта.');
        }
      })
      .finally(() => {
        if (requestId === detailRequestRef.current) setDetailLoading(false);
      });
  }, [month, objectId, refreshVersion, year]);

  useEffect(() => {
    if (!objectId) {
      setSelectedObject(null);
      return;
    }
    void listTimesheetOverviewObjects({ selectedId: objectId })
      .then((items) => {
        const item = items[0];
        setSelectedObject(item ? { value: item.id, label: item.name } : null);
      })
      .catch(() => setSelectedObject(null));
  }, [objectId]);

  useEffect(() => {
    if (!employeeId) {
      setSelectedEmployee(null);
      return;
    }
    void listTimesheetOverviewEmployees({
      year,
      month,
      objectId: objectId || undefined,
      selectedId: employeeId,
    })
      .then((items) => {
        const item = items[0];
        setSelectedEmployee(item ? { value: item.id, label: item.name } : null);
      })
      .catch(() => setSelectedEmployee(null));
  }, [employeeId, month, objectId, year]);

  const submitException = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!objectId) return;
    setIsSubmittingException(true);
    setExceptionMessage(null);
    void requestTimesheetManualException({
      objectId,
      year,
      month,
      employeeId: exceptionEmployeeId,
      dayOfMonth: Number(exceptionDayOfMonth),
      dayValue: Number(exceptionDayValue),
      comment: exceptionComment,
    })
      .then((request) => {
        setExceptionMessage('Запрос отправлен на согласование.');
        setExceptionApprovalsHref(
          `/approvals?sourceEntityType=${request.sourceEntityType}&sourceEntityId=${request.sourceEntityId}`,
        );
        setExceptionComment('');
      })
      .catch(() => {
        setExceptionMessage('Не удалось создать запрос на исключение.');
        setExceptionApprovalsHref(null);
      })
      .finally(() => setIsSubmittingException(false));
  };

  return (
    <>
      <PageTitle title="Табель" />
      <section className="page-card timesheet-overview-filters">
        <label>
          <span className="detail-label">Период</span>
          <input
            type="month"
            min="2024-01"
            max="2100-12"
            value={`${year}-${String(month).padStart(2, '0')}`}
            onChange={(event) => {
              const [nextYear, nextMonth] = event.target.value.split('-');
              replaceFilters({ year: nextYear || null, month: nextMonth ? String(Number(nextMonth)) : null });
            }}
          />
        </label>
        <SearchableSelect
          label="Объект"
          value={objectId}
          selectedOption={selectedObject}
          options={[]}
          placeholder="Все объекты"
          searchPlaceholder="Поиск по названию"
          onChange={(value) => replaceFilters({ objectId: value || null, employeeId: null })}
          asyncSearch={async (query) =>
            (await listTimesheetOverviewObjects({ q: query })).map((item) => ({ value: item.id, label: item.name }))
          }
        />
        <SearchableSelect
          label="Сотрудник"
          value={employeeId}
          selectedOption={selectedEmployee}
          options={[]}
          placeholder="Все сотрудники"
          searchPlaceholder="ФИО или телефон"
          onChange={(value) => replaceFilters({ employeeId: value || null })}
          asyncSearch={async (query) =>
            (await listTimesheetOverviewEmployees({ year, month, objectId: objectId || undefined, q: query })).map((item) => ({ value: item.id, label: item.name }))
          }
        />
        <button
          type="button"
          disabled={isExporting || !overview?.capabilities.canExport}
          onClick={() => {
            setIsExporting(true);
            setError(null);
            void downloadTimesheetOverviewExcel({ year, month, objectId: objectId || undefined, employeeId: employeeId || undefined })
              .then((blob) => saveBlob(blob, `timesheet-overview-${year}-${String(month).padStart(2, '0')}.xlsx`))
              .catch(() => setError('Не удалось скачать Excel.'))
              .finally(() => setIsExporting(false));
          }}
        >
          {isExporting ? 'Готовим Excel...' : 'Скачать Excel'}
        </button>
      </section>

      <TimesheetLegend />
      {loading ? <div className="page-card">Загрузка табеля...</div> : null}
      {error ? <div className="page-card page-error">{error}</div> : null}
      {!loading && !error && overview ? <TimesheetOverviewGrid overview={overview} /> : null}

      {objectId ? (
        <section className="timesheet-object-detail">
          <div>
            <h2 className="section-title">Детализация и корректировки объекта</h2>
            <p className="section-subtitle">Существующий объектный табель и approval flow сохранены.</p>
          </div>
          {detailLoading ? <div className="page-card">Загрузка детализации...</div> : null}
          {detailError ? <div className="page-card page-error">{detailError}</div> : null}
          {!detailLoading && objectTimesheet ? (
            <>
              {!objectTimesheet.capabilities.canManualCorrection && objectTimesheet.rows.length > 0 ? (
                <div className="page-card timesheet-exception-card">
                  <div>
                    <div className="section-title">Запросить исключение табеля</div>
                    <div className="section-subtitle">Изменение применится только после подтверждения.</div>
                  </div>
                  <form className="timesheet-exception-form" onSubmit={submitException}>
                    <label><span>Сотрудник</span><select value={exceptionEmployeeId} onChange={(event) => setExceptionEmployeeId(event.target.value)} required>{objectTimesheet.rows.map((row) => <option key={row.employeeId} value={row.employeeId}>{row.employeeName}</option>)}</select></label>
                    <label><span>День</span><input type="number" min="1" max={objectTimesheet.daysInMonth} value={exceptionDayOfMonth} onChange={(event) => setExceptionDayOfMonth(event.target.value)} required /></label>
                    <label><span>Новое значение</span><input type="number" value={exceptionDayValue} onChange={(event) => setExceptionDayValue(event.target.value)} required /></label>
                    <label className="is-wide"><span>Причина</span><textarea rows={2} value={exceptionComment} onChange={(event) => setExceptionComment(event.target.value)} required /></label>
                    <div className="action-row is-wide"><button type="submit" disabled={isSubmittingException || !exceptionEmployeeId}>{isSubmittingException ? 'Отправляем...' : 'Запросить исключение'}</button>{exceptionApprovalsHref ? <Link href={exceptionApprovalsHref}>Открыть согласование</Link> : null}</div>
                  </form>
                  {exceptionMessage ? <div className={exceptionApprovalsHref ? 'page-success' : 'page-error'}>{exceptionMessage}</div> : null}
                </div>
              ) : null}
              <TimesheetGrid
                key={`${objectId}-${year}-${month}`}
                timesheet={objectTimesheet}
                canEditEntries={objectTimesheet.capabilities.canManualCorrection}
                onChangeEntry={async (payload) => {
                  await upsertTimesheetEntry({ objectId, year, month, ...payload });
                  setRefreshVersion((value) => value + 1);
                }}
              />
              <TimesheetCorrectionsPanel items={corrections} />
            </>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
