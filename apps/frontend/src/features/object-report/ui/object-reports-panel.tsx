'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';
import { getAccessGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';

import { listObjectDailyReports } from '@/entities/object/api/object-operations-client';
import type { ObjectDailyReport } from '@/entities/object/model/object-operations.types';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { Alert, Button, EmptyState, Field, LoadingState, Stack, StatusBadge, Surface } from '@/shared/ui/foundation';
import { ObjectReportAttachmentsEditor } from './object-report-attachments-editor';
import { isRealReportDate, isReportId, shouldRenderCachedReportsForDate } from '../model/report-link';
import styles from './object-reports-panel.module.css';

function dateFromReport(report: ObjectDailyReport): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(report.reportDate));
}

export function ObjectReportsPanel({ objectId }: { objectId: string }): React.JSX.Element {
  const searchParams = useSearchParams();
  const queryDate = searchParams.get('reportDate');
  const requestedReportId = searchParams.get('reportId');
  const hasReportIdParam = searchParams.has('reportId');
  const date = queryDate ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const validDate = isRealReportDate(date);
  const invalidReportReference = hasReportIdParam && (!isReportId(requestedReportId) || !queryDate);
  const [items, setItems] = useState<ObjectDailyReport[]>([]);
  const [loadedDate, setLoadedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const accessRevision = useAccessRevision();
  const contextKey = JSON.stringify([objectId, date, accessRevision]);
  const currentContext = useRef(contextKey);
  currentContext.current = contextKey;
  const surfaceMounted = useRef(true);
  useEffect(() => { surfaceMounted.current = true; return () => { surfaceMounted.current = false; }; }, []);
  const [loadedContext, setLoadedContext] = useState<string | null>(null);

  useEffect(() => {
    if (!validDate || invalidReportReference) {
      setItems([]);
      setLoadedDate(null);
      setLoading(false);
      setError(false);
      return;
    }
    let active = true;
    const generation = getAccessGeneration();
    setLoading(true);
    setError(false);
    void listObjectDailyReports(objectId, date)
      .then((rows) => { if (active && isAccessGenerationCurrent(generation)) { setItems(rows); setLoadedDate(date); setLoadedContext(contextKey); } })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [objectId, date, retry, validDate, invalidReportReference, contextKey]);

  const hasCurrentRows = loadedContext === contextKey && shouldRenderCachedReportsForDate(date, loadedDate);
  const selectedReportMissing = useMemo(() =>
    hasCurrentRows && !loading && !error && !!requestedReportId && !items.some((report) => report.id === requestedReportId && dateFromReport(report) === date),
  [date, error, hasCurrentRows, items, loading, requestedReportId]);

  useEffect(() => {
    if (!loading && requestedReportId && !selectedReportMissing) {
      document.getElementById('reports-selected')?.scrollIntoView({ block: 'center' });
    }
  }, [loading, requestedReportId, selectedReportMissing]);

  const changeDate = (nextDate: string): void => {
    const params = new URLSearchParams(window.location.search);
    params.set('reportDate', nextDate);
    params.delete('reportId');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}#reports`);
  };

  return <Stack gap="lg">
    <Surface padding="md">
      <div className="ui-section-header">
        <div><h3 className="ui-section-title">Ежедневные отчёты</h3><p className="ui-section-subtitle">Сохранённые отчёты и вложения по московскому времени.</p></div>
        <Field className={styles.dateField} label="Дата отчёта"><DatePicker value={validDate ? date : ''} onChange={changeDate} /></Field>
      </div>
    </Surface>
    {!validDate ? <Alert tone="danger" role="alert">В ссылке указана недопустимая дата отчёта. Укажите существующую дату в формате ГГГГ-ММ-ДД.</Alert> : invalidReportReference ? <Alert tone="danger" role="alert">Ссылка на отчёт некорректна. Проверьте идентификатор и дату отчёта.</Alert> : !hasCurrentRows && loading && items.length === 0 ? <LoadingState label="Загрузка отчётов" /> : !hasCurrentRows && error && items.length === 0 ? <Alert tone="danger" action={<Button onClick={() => setRetry((value) => value + 1)}>Повторить</Button>}>Не удалось загрузить отчёты. Проверьте дату и доступ к объекту.</Alert>
      : <>
      {!hasCurrentRows && items.length > 0 ? <Alert tone="warning" action={error ? <Button onClick={() => setRetry((value) => value + 1)}>Повторить</Button> : undefined}>{error ? 'Не удалось проверить доступ к отчётам.' : 'Проверяем доступ к отчётам…'}</Alert> : null}
      {hasCurrentRows && loading ? <span className="ui-text-muted" role="status">Обновляем отчёты…</span> : null}
      {hasCurrentRows && error ? <Alert tone="danger" action={<Button onClick={() => setRetry((value) => value + 1)}>Повторить</Button>}>Не удалось обновить отчёты. Сохранённые данные пока показаны ниже.</Alert> : null}
      {selectedReportMissing ? <Alert tone="danger" role="alert">Отчёт из ссылки не найден за указанную дату или недоступен.</Alert>
      : items.length === 0 ? <EmptyState title="За выбранную дату отчётов нет" description="Выберите другую дату. Отчёт за текущий день заполняется в разделе «Сегодня»." />
      : items.map((report) => {
        const sent = report.publicationState === 'submitted';
        return <AccessSnapshotBoundary key={report.id} blocked={!hasCurrentRows}><Surface padding="md" as="article" className={report.id === requestedReportId ? styles.selectedReport : undefined}>
          <div className="ui-section-header" id={report.id === requestedReportId ? 'reports-selected' : undefined}>
            <h3 className="ui-section-title">{new Date(report.reportDate).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}</h3>
            <StatusBadge status={sent ? 'submitted' : 'draft'}>{sent ? 'Отправлен' : report.publicationState === 'draft_after_submission' ? 'Есть неотправленные изменения' : 'Черновик'}</StatusBadge>
          </div>
          <p className={styles.content}>{report.content}</p>
          <p className="ui-section-subtitle">{report.updatedBy.fullName} · {new Date(report.updatedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</p>
          <ObjectReportAttachmentsEditor report={report} accessCurrent={hasCurrentRows && !loading && !error} onUpdated={async () => { const generation = getAccessGeneration(); const rows = await listObjectDailyReports(objectId, date); if (!surfaceMounted.current || currentContext.current !== contextKey || !isAccessGenerationCurrent(generation)) return false; setItems(rows); setLoadedDate(date); setLoadedContext(contextKey); return true; }} />
        </Surface></AccessSnapshotBoundary>;
      })}
      </>}
  </Stack>;
}
