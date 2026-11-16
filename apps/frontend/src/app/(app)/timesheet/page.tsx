'use client';

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
import type { TimesheetCellMutation } from '@/features/timesheet-cell-editing/ui/timesheet-cell-editor';
import { TimesheetCorrectionsPanel } from '@/features/timesheet-corrections/ui/timesheet-corrections-panel';
import { CompensationExplanationPanel } from '@/features/object-compensation/ui/compensation-explanation-panel';
import { TimesheetOverviewGrid } from '@/features/timesheet-overview/ui/timesheet-overview-grid';
import { getOverviewRefreshState, type OverviewSnapshot } from '@/features/timesheet-overview/model/overview-refresh';
import { isSavedWithoutAccess } from '@/shared/api/saved-without-access';
import { ApiError } from '@/shared/api/fetcher';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';
import { getAccessGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';
import { Alert, Button, Surface } from '@/shared/ui/foundation';
import { MonthPeriodPicker } from '@/shared/ui/month-period-picker/month-period-picker';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/shared/ui/searchable-select/searchable-select';
import { DownloadIcon } from '@/shared/ui/icons/icons';
import timesheetStyles from '@/entities/timesheet/ui/timesheet-ui.module.css';

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
});

function parsePeriod(searchParams: URLSearchParams): { year: number; month: number } {
  const now = new Date();
  const year = Number(searchParams.get('year'));
  const month = Number(searchParams.get('month'));
  return {
    year: Number.isInteger(year) && year >= 2024 && year <= 2100 ? year : now.getFullYear(),
    month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : now.getMonth() + 1,
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
  const accessRevision = useAccessRevision();
  const [loadedAccessRevision, setLoadedAccessRevision] = useState<string | null>(null);
  const [detailAccessRevision, setDetailAccessRevision] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { year, month } = parsePeriod(searchParams);
  const objectId = searchParams.get('objectId') ?? '';
  const employeeId = searchParams.get('employeeId') ?? '';
  const overviewScope = JSON.stringify([year, month, objectId, employeeId]);
  const [overviewSnapshot, setOverviewSnapshot] = useState<OverviewSnapshot<TimesheetOverview> | null>(null);
  const [objectTimesheet, setObjectTimesheet] = useState<TimesheetMonth | null>(null);
  const [corrections, setCorrections] = useState<TimesheetCorrectionItem[]>([]);
  const [selectedObject, setSelectedObject] = useState<SearchableSelectOption | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<SearchableSelectOption | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [correctionsLoading, setCorrectionsLoading] = useState(false);
  const [correctionsError, setCorrectionsError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const overviewRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const objectReferenceRequestRef = useRef(0);
  const employeeReferenceRequestRef = useRef(0);
  const refreshLockRef = useRef(false);
  const { overview, mutationsBlocked: refreshBlocked } = getOverviewRefreshState(overviewSnapshot, overviewScope, refreshVersion, loading);
  const mutationsBlocked = refreshBlocked || loadedAccessRevision !== accessRevision;

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
    void getTimesheetOverview({ year, month, objectId: objectId || undefined, employeeId: employeeId || undefined })
      .then((result) => {
        if (requestId === overviewRequestRef.current) {
          setOverviewSnapshot({ data: result, scope: overviewScope, revision: refreshVersion });
          setLoadedAccessRevision(accessRevision);
          refreshLockRef.current = false;
        }
      })
      .catch(() => {
        if (requestId === overviewRequestRef.current) {
          setError('Не удалось загрузить сводный табель.');
        }
      })
      .finally(() => {
        if (requestId === overviewRequestRef.current) setLoading(false);
      });
    return () => { if (overviewRequestRef.current === requestId) overviewRequestRef.current += 1; };
  }, [employeeId, month, objectId, overviewScope, refreshVersion, year, accessRevision]);

  useEffect(() => {
    const requestId = ++detailRequestRef.current;
    if (!objectId) {
      setObjectTimesheet(null);
      setCorrections([]);
      setDetailError(null);
      setCorrectionsError(null);
      setCorrectionsLoading(false);
      setDetailLoading(false);
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    setCorrections([]);
    setCorrectionsError(null);
    setCorrectionsLoading(true);
    // History is independently permissioned. Its failure must not discard a
    // successful main read, nor be presented as an empty correction history.
    void getTimesheetCorrections({ objectId, year, month })
      .then((nextCorrections) => {
        if (requestId !== detailRequestRef.current) return;
        setCorrections(nextCorrections);
      })
      .catch((caught: unknown) => {
        if (requestId !== detailRequestRef.current) return;
        setCorrectionsError(caught instanceof ApiError && caught.statusCode === 403
          ? 'Нет доступа к истории корректировок.'
          : 'Не удалось загрузить историю корректировок.');
      })
      .finally(() => {
        if (requestId === detailRequestRef.current) setCorrectionsLoading(false);
      });
    void getTimesheet({ objectId, year, month })
      .then((timesheet) => {
        if (requestId !== detailRequestRef.current) return;
        setObjectTimesheet(timesheet);
        setDetailAccessRevision(accessRevision);
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
    return () => { if (detailRequestRef.current === requestId) detailRequestRef.current += 1; };
  }, [month, objectId, refreshVersion, year, accessRevision]);

  useEffect(() => {
    const requestId = ++objectReferenceRequestRef.current;
    if (!objectId) {
      setSelectedObject(null);
      return;
    }
    void listTimesheetOverviewObjects({ selectedId: objectId })
      .then((items) => {
        if (requestId !== objectReferenceRequestRef.current) return;
        const item = items[0];
        setSelectedObject(item ? { value: item.id, label: item.name } : null);
      })
      .catch(() => {
        if (requestId === objectReferenceRequestRef.current) setSelectedObject(null);
      });
    return () => { if (objectReferenceRequestRef.current === requestId) objectReferenceRequestRef.current += 1; };
  }, [objectId, accessRevision]);

  useEffect(() => {
    const requestId = ++employeeReferenceRequestRef.current;
    if (!employeeId) {
      setSelectedEmployee(null);
      return;
    }
    void listTimesheetOverviewEmployees({ year, month, objectId: objectId || undefined, selectedId: employeeId })
      .then((items) => {
        if (requestId !== employeeReferenceRequestRef.current) return;
        const item = items[0];
        setSelectedEmployee(item ? { value: item.id, label: item.name } : null);
      })
      .catch(() => {
        if (requestId === employeeReferenceRequestRef.current) setSelectedEmployee(null);
      });
    return () => { if (employeeReferenceRequestRef.current === requestId) employeeReferenceRequestRef.current += 1; };
  }, [employeeId, month, objectId, year, accessRevision]);

  const directChange = async (payload: TimesheetCellMutation): Promise<'pending' | void> => {
    if (mutationsBlocked || refreshLockRef.current) throw new ApiError('Refresh required', 409, 'TIMESHEET_REFRESH_REQUIRED');
    const generation = getAccessGeneration();
    const result = await upsertTimesheetEntry({ year, month, ...payload });
    if (isSavedWithoutAccess(result) || !isAccessGenerationCurrent(generation)) {
      setSavedNotice('Корректировка сохранена.');
      return;
    }
    if ('approvalType' in result) return 'pending';
    refreshLockRef.current = true;
    setLoading(true);
    setRefreshVersion((value) => value + 1);
  };

  const requestCorrection = async (payload: Required<TimesheetCellMutation>): Promise<void> => {
    if (mutationsBlocked || refreshLockRef.current) throw new ApiError('Refresh required', 409, 'TIMESHEET_REFRESH_REQUIRED');
    const generation = getAccessGeneration();
    const result = await requestTimesheetManualException({ year, month, ...payload });
    if (isSavedWithoutAccess(result) || !isAccessGenerationCurrent(generation)) {
      setSavedNotice('Запрос на корректировку отправлен.');
    }
  };

  const refreshOverview = (): void => {
    refreshLockRef.current = true;
    setLoading(true);
    setRefreshVersion((value) => value + 1);
  };

  const openDetails = (nextObjectId: string, nextEmployeeId: string): void => {
    replaceFilters({ objectId: nextObjectId, employeeId: nextEmployeeId });
    window.setTimeout(() => {
      document.querySelector('.timesheet-object-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  };

  const visibleCorrections = employeeId
    ? corrections.filter((item) => item.employeeId === employeeId)
    : corrections;

  if (savedNotice) return (
    <Alert tone="success" role="status" title={savedNotice}>
      <p>Доступ изменился. Карточка закрыта.</p>
      <Button onClick={() => window.location.reload()}>Вернуться к табелю</Button>
    </Alert>
  );

  return (
    <div className={timesheetStyles.timesheetPage}>
      <Surface as="section" padding="md" className={timesheetStyles.timesheetOverviewFilters} aria-label="Фильтры табеля">
        <MonthPeriodPicker
          year={year}
          month={month}
          minYear={2024}
          maxYear={2100}
          onChange={(nextYear, nextMonth) => {
            replaceFilters({ year: String(nextYear), month: String(nextMonth) });
          }}
        />
        <SearchableSelect
          label="Объект"
          value={objectId}
          selectedOption={selectedObject}
          options={[]}
          placeholder="Все объекты"
          searchPlaceholder="Поиск по названию"
          onChange={(value) => replaceFilters({ objectId: value || null, employeeId: null })}
          asyncSearch={async (query) => (await listTimesheetOverviewObjects({ q: query })).map((item) => ({ value: item.id, label: item.name }))}
        />
        <SearchableSelect
          label="Сотрудник"
          value={employeeId}
          selectedOption={selectedEmployee}
          options={[]}
          placeholder="Все сотрудники"
          searchPlaceholder="ФИО или телефон"
          onChange={(value) => replaceFilters({ employeeId: value || null })}
          asyncSearch={async (query) => (await listTimesheetOverviewEmployees({ year, month, objectId: objectId || undefined, q: query })).map((item) => ({ value: item.id, label: item.name }))}
        />
        <Button
          className={timesheetStyles.timesheetExportButton}
          size="md"
          disabled={mutationsBlocked || isExporting || !overview?.capabilities.canExport}
          onClick={() => {
            const generation = getAccessGeneration();
            setIsExporting(true);
            setError(null);
            void downloadTimesheetOverviewExcel({ year, month, objectId: objectId || undefined, employeeId: employeeId || undefined })
              .then((blob) => { if (isAccessGenerationCurrent(generation)) saveBlob(blob, `timesheet-overview-${year}-${String(month).padStart(2, '0')}.xlsx`); })
              .catch(() => setError('Не удалось скачать Excel.'))
              .finally(() => setIsExporting(false));
          }}
        >
          <DownloadIcon />
          {isExporting ? 'Готовим Excel…' : 'Скачать Excel'}
        </Button>
      </Surface>

      {loading && !overview ? <Surface padding="md">Загрузка табеля...</Surface> : null}
      {error ? <Surface padding="md" className="page-error">{error} <Button disabled={loading} onClick={refreshOverview}>Обновить табель</Button></Surface> : null}
      {loadedAccessRevision !== accessRevision && !error ? <Surface padding="md" role="status">Проверяем доступ к табелю…</Surface> : null}
      <AccessSnapshotBoundary blocked={loadedAccessRevision !== accessRevision}>
      {overview ? (
        <TimesheetOverviewGrid
          key={`${year}:${month}:${objectId}:${employeeId}`}
          overview={overview}
          mutationsBlocked={mutationsBlocked}
          refreshing={loading}
          dataRevision={overviewSnapshot?.revision ?? 0}
          onRefresh={refreshOverview}
          onDirectChange={directChange}
          onRequestCorrection={requestCorrection}
          onOpenDetails={openDetails}
        />
      ) : null}
      </AccessSnapshotBoundary>

      {objectId ? (
        <section className="timesheet-object-detail">
          <div className={timesheetStyles.timesheetObjectDetailHeading}>
            <div>
              <h2 className="ui-section-title">Детализация объекта</h2>
              <p className="ui-section-subtitle">
                Начисления и Excel учитывают выбранные месяц, объект и сотрудника. Корректировка доступна отдельным действием в ячейке.
              </p>
            </div>
          </div>
          {detailLoading ? <Surface padding="md">Загрузка детализации...</Surface> : null}
          {detailError ? <Surface padding="md" className="page-error">{detailError}</Surface> : null}
          {!detailLoading && !loading && !error && detailAccessRevision === accessRevision && loadedAccessRevision === accessRevision && objectTimesheet && overview ? (
            <>
              <div className={timesheetStyles.timesheetObjectInspector} aria-label="Сводка выбранного объекта">
                <div className={timesheetStyles.timesheetObjectInspectorIdentity}>
                  <span>Объект</span>
                  <strong>{objectTimesheet.objectName}</strong>
                  {selectedEmployee ? <small>Сотрудник: {selectedEmployee.label}</small> : null}
                </div>
                <div className="timesheet-object-inspector__metric">
                  <span>Тип оплаты</span>
                  <strong>
                    {objectTimesheet.objectPaymentType === 'monthly'
                      ? 'ЗП за месяц'
                      : 'Дневная ставка'}
                  </strong>
                </div>
                <div className="timesheet-object-inspector__metric">
                  <span>
                    {objectTimesheet.objectPaymentType === 'monthly'
                      ? 'Базовые условия объекта / месяц'
                      : 'Ставка за выход'}
                  </span>
                  <strong>
                    {moneyFormatter.format(
                      objectTimesheet.objectPaymentType === 'monthly'
                        ? objectTimesheet.objectMonthlySalary
                        : objectTimesheet.objectDailyRate,
                    )}
                  </strong>
                  {objectTimesheet.objectPaymentType === 'monthly' ? (
                    <small>
                      Фонд команды и выбранные условия позиции учитываются отдельно. Расшифровка сохранённых начислений — ниже.
                    </small>
                  ) : null}
                </div>
                <div className="timesheet-object-inspector__metric">
                  <span>Аванс (начислено)</span>
                  <strong>{moneyFormatter.format(overview.totals.advanceTotal)}</strong>
                </div>
                <div className="timesheet-object-inspector__metric">
                  <span>Зарплата (начислено)</span>
                  <strong>{moneyFormatter.format(overview.totals.salaryTotal)}</strong>
                </div>
                <div className="timesheet-object-inspector__metric">
                  <span>Итого по выбранным фильтрам</span>
                  <strong>{moneyFormatter.format(overview.totals.monthTotal)}</strong>
                </div>
              </div>
              {correctionsLoading ? <Surface padding="md" role="status">Загрузка истории корректировок…</Surface>
                : correctionsError ? <Surface padding="md" role="alert">{correctionsError}</Surface>
                : <TimesheetCorrectionsPanel
                items={visibleCorrections}
                employeeName={selectedEmployee?.label ?? null}
              />}
              <CompensationExplanationPanel key={`${objectId}:${year}:${month}`} objectId={objectId} year={year} month={month} employeeId={employeeId || undefined} revision={refreshVersion} />
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
