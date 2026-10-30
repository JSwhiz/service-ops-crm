'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { SchedulePreview } from '@/entities/object/model/object-scheduling.types';
import { Alert, Button, EmptyState, Field } from '@/shared/ui/foundation';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { getErrorMessage } from '@/shared/lib/error-message';
import styles from './object-scheduling.module.css';

export function moscowToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function shiftTime(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function SchedulePreviewPanel({ draftKey, onPreview, employeeNames }: {
  draftKey: string; onPreview: (from: string, to: string) => Promise<SchedulePreview>; employeeNames: Map<string, string>;
}): React.JSX.Element {
  const [from, setFrom] = useState(moscowToday);
  const [to, setTo] = useState(moscowToday);
  const [result, setResult] = useState<SchedulePreview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  useEffect(() => {
    sequence.current += 1;
    setResult(null); setPending(false); setError(null);
    return () => { sequence.current += 1; };
  }, [draftKey, from, to]);
  const preview = async (): Promise<void> => {
    if (pending) return;
    const request = ++sequence.current;
    setError(null); setPending(true); setResult(null);
    try {
      if (!from || !to || to < from) throw new Error('Выберите корректный период предпросмотра.');
      const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
      if (days > 93) throw new Error('Период предпросмотра — не более 93 дней.');
      const response = await onPreview(from, to);
      if (request === sequence.current) setResult(response);
    } catch (caught) { if (request === sequence.current) setError(getErrorMessage(caught, 'Не удалось построить предпросмотр.')); }
    finally { if (request === sequence.current) setPending(false); }
  };
  return <section className={styles.section} aria-label="Предпросмотр расписания" aria-busy={pending}>
    <h3 className="ui-section-title">Предпросмотр расписания</h3>
    <p className="ui-text-muted">Сервер проверяет покрытие по временным интервалам. День и ночь не складываются в одновременную численность. Просмотр не создаёт факт или начисление.</p>
    <div className={styles.grid}>
      <Field label="С даты"><DatePicker value={from} onChange={setFrom} disabled={pending} /></Field>
      <Field label="По дату"><DatePicker value={to} onChange={setTo} disabled={pending} /></Field>
    </div>
    <div><Button pending={pending} onClick={() => { void preview(); }}>Проверить на сервере</Button></div>
    {error ? <Alert tone="danger">{error}</Alert> : null}
    {result ? <>
      {result.recommendedGroups !== null ? <p>Рекомендация по числу групп: {result.recommendedGroups}. Назначения не создаются автоматически.</p> : null}
      {result.warnings.map((warning, index) => <Alert tone="warning" key={`${warning.code}-${index}`}>{warning.date ? `${warning.date}: ` : ''}{warning.message}</Alert>)}
      {result.coverage.length ? <details>
        <summary>Покрытие по дням и интервалам ({result.coverage.length})</summary>
        <div className={styles.section}>{result.coverage.map((day, index) => <div key={`${day.positionId}-${day.date}-${index}`}>
          <strong>{day.date}</strong> · одновременно нужно {day.required}, назначено не менее {day.assigned}, не хватает {day.uncovered}.
          {day.intervals.map((interval, intervalIndex) => <div key={intervalIndex} className="ui-text-muted">{shiftTime(interval.startsAt)} — {shiftTime(interval.endsAt)}: нужно {interval.required}, назначено {interval.assigned}, не хватает {interval.uncovered}.</div>)}
        </div>)}</div>
      </details> : null}
      {result.shifts.length ? <details>
        <summary>Ожидаемые смены ({result.shifts.length})</summary>
        <div className={styles.section}>{result.shifts.map((shift, index) => <div key={index}>
          <strong>{employeeNames.get(shift.employeeId) ?? 'Сотрудник из сохранённого назначения'}</strong> · {shiftTime(shift.startsAt)} — {shiftTime(shift.endsAt)}
        </div>)}</div>
      </details> : <EmptyState title="Ожидаемых смен нет" description="Проверьте начало цикла, период действия и назначения сотрудников. Это не подтверждение отсутствия." />}
    </> : null}
  </section>;
}
