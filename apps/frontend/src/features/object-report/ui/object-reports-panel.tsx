'use client';

import React, { useEffect, useState } from 'react';

import { listObjectDailyReports } from '@/entities/object/api/object-operations-client';
import type { ObjectDailyReport } from '@/entities/object/model/object-operations.types';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { Alert, Button, EmptyState, Field, LoadingState, Stack, StatusBadge, Surface } from '@/shared/ui/foundation';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import styles from './object-reports-panel.module.css';

export function ObjectReportsPanel({ objectId }: { objectId: string }): React.JSX.Element {
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date()));
  const [items, setItems] = useState<ObjectDailyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void listObjectDailyReports(objectId, date)
      .then((rows) => { if (active) setItems(rows); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [objectId, date, retry]);

  return <Stack gap="lg">
    <Surface padding="md">
      <div className="ui-section-header">
        <div><h3 className="ui-section-title">Ежедневные отчёты</h3><p className="ui-section-subtitle">Сохранённые отчёты и вложения по московскому времени.</p></div>
        <Field className={styles.dateField} label="Дата отчёта"><DatePicker value={date} onChange={setDate} /></Field>
      </div>
    </Surface>
    {loading ? <LoadingState label="Загрузка отчётов" /> : error ? <Alert tone="danger" action={<Button onClick={() => setRetry((value) => value + 1)}>Повторить</Button>}>Не удалось загрузить отчёты. Проверьте дату и доступ к объекту.</Alert>
      : items.length === 0 ? <EmptyState title="За выбранную дату отчётов нет" description="Выберите другую дату. Отчёт за текущий день заполняется в разделе «Сегодня»." />
      : items.map((report) => {
        const sent = report.submittedRevision > 0 && report.submittedRevision === report.revision;
        return <Surface key={report.id} padding="md" as="article">
          <div className="ui-section-header">
            <h3 className="ui-section-title">{new Date(report.reportDate).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}</h3>
            <StatusBadge status={sent ? 'submitted' : 'draft'}>{sent ? 'Отправлен' : report.submittedRevision > 0 ? 'Есть неотправленные изменения' : 'Черновик'}</StatusBadge>
          </div>
          <p className={styles.content}>{report.content}</p>
          <p className="ui-section-subtitle">{report.updatedBy.fullName} · {new Date(report.updatedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</p>
          {report.attachments.length ? <AttachmentPreviewList files={report.attachments} emptyText="" /> : null}
        </Surface>;
      })}
  </Stack>;
}
