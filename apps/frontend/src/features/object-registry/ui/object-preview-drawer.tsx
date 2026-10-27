'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import { getObjectEquipment } from '@/entities/equipment/api/equipment-client';
import { getObjectInventory } from '@/entities/inventory/api/inventory-client';
import { createObjectComment, getTodayArrivalPhoto, getTodayDailyReport, getTodayObjectAttendance, listObjectDailyReports, upsertObjectAttendance, upsertTodayDailyReport, type ObjectAttendanceToday } from '@/entities/object/api/object-operations-client';
import type { ObjectArrivalPhoto, ObjectDailyReport } from '@/entities/object/model/object-operations.types';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { listTasksByObject } from '@/entities/task/api/task-client';
import type { TaskItem } from '@/entities/task/model/task.types';
import { ObjectAttendancePanel } from '@/features/object-attendance/ui/object-attendance-panel';
import { ObjectDailyReportPanel } from '@/features/object-report/ui/object-daily-report-panel';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { uploadFileBatch } from '@/entities/file/api/file-client';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { Button } from '@/shared/ui/foundation';
import { Drawer } from '@/shared/ui/overlays';
import styles from './object-preview-drawer.module.css';

function stamp(date: string): string { return new Date(date).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }); }

export function ObjectPreviewDrawer({ item, onClose }: { item: ServiceObject | null; onClose: () => void }): React.JSX.Element | null {
  return item ? <ObjectPreviewContent key={item.id} item={item} onClose={onClose} /> : null;
}

function ObjectPreviewContent({ item, onClose }: { item: ServiceObject; onClose: () => void }): React.JSX.Element {
  const [attendance, setAttendance] = useState<ObjectAttendanceToday | null>(null);
  const [report, setReport] = useState<ObjectDailyReport | null>(null);
  const [reports, setReports] = useState<ObjectDailyReport[]>([]);
  const [arrival, setArrival] = useState<ObjectArrivalPhoto | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [equipmentCount, setEquipmentCount] = useState<number | null>(null);
  const [inventoryMovementCount, setInventoryMovementCount] = useState<number | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingComment, setSavingComment] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [readErrors, setReadErrors] = useState<string[]>([]);
  const canOperate = item.capabilities.canViewOperationalSections;
  const canReadReports = canOperate || !!item.capabilities.canViewReportsHistory;
  const canAttend = canOperate && item.capabilities.canOperateAttendance !== false;

  useEffect(() => {
    let cancelled = false;
    const errors: string[] = [];
    const read = async <T,>(request: Promise<T>, label: string, fallback: T): Promise<T> => request.catch(() => { errors.push(label); return fallback; });
    void Promise.all([
      canAttend ? read<ObjectAttendanceToday | null>(getTodayObjectAttendance(item.id), 'Присутствие', null) : null,
      canOperate ? read<ObjectDailyReport | null>(getTodayDailyReport(item.id), 'Отчёт', null) : null,
      canOperate ? read<ObjectArrivalPhoto | null>(getTodayArrivalPhoto(item.id), 'Фото прибытия', null) : null,
      canOperate ? read(listTasksByObject(item.id), 'Задачи', []) : [],
      canOperate ? getObjectEquipment(item.id).catch(() => { errors.push('Оборудование'); return null; }) : null,
      canOperate ? getObjectInventory(item.id).catch(() => { errors.push('Расходники'); return null; }) : null,
      !canOperate && canReadReports ? read(listObjectDailyReports(item.id), 'История отчётов', []) : [],
    ]).then(([nextAttendance, nextReport, nextArrival, nextTasks, equipment, inventory, history]) => {
      if (cancelled) return;
      setAttendance(nextAttendance); setReport(nextReport); setArrival(nextArrival); setTasks(nextTasks);
      setEquipmentCount(equipment?.units.length ?? null); setInventoryMovementCount(inventory?.movements.length ?? null);
      setReports(history); setReadErrors(errors); setLoading(false);
    });
    return () => { cancelled = true; };
  }, [item.id, canOperate, canReadReports, canAttend]);

  const refreshAttendance = async (): Promise<void> => { setAttendance(await getTodayObjectAttendance(item.id)); };
  const saveComment = async (): Promise<void> => {
    if (!commentDraft.trim()) return;
    setSavingComment(true); setMessage(null);
    try { await createObjectComment(item.id, { content: commentDraft.trim() }); setCommentDraft(''); setMessage('Комментарий добавлен.'); }
    catch { setMessage('Не удалось добавить комментарий.'); }
    finally { setSavingComment(false); }
  };
  const openTasks = tasks.filter((task) => !['completed', 'cancelled'].includes(task.status));
  const overdueTasks = openTasks.filter((task) => task.isOverdue);
  const initialIds = attendance?.employeeIds.length ? attendance.employeeIds : attendance?.suggestedEmployeeIds ?? [];

  return <Drawer open onOpenChange={(open) => { if (!open) onClose(); }} title={item.name}
    description={[item.internalName, item.address].filter(Boolean).join(' · ')}
    footer={<div className={styles.footer}><Link className={styles.primaryAction} href={`/objects/${item.id}`}>Открыть объект</Link>
      {item.capabilities.canEdit || item.capabilities.canManageCompensationRates ? <Link className={styles.actionButton} href={`/objects/${item.id}/edit`}>Редактировать</Link> : null}</div>}>
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Ответственные</h3>
      <div className={styles.peopleRow}><span className={styles.label}>Ответственный</span><span className={styles.value}>{item.responsible ? getUserDisplayName(item.responsible) : 'Не назначен'}</span></div>
      <div className={styles.peopleRow}><span className={styles.label}>Менеджеры</span><span className={styles.value}>{item.managers.length ? item.managers.map(getUserDisplayName).join(', ') : 'Не назначены'}</span></div>
    </section>
    {loading ? <div role="status">Загрузка…</div> : null}
    {readErrors.length ? <div className={styles.error} role="alert">Не удалось загрузить: {readErrors.join(', ')}. Откройте карточку для повторной загрузки.</div> : null}
    {canOperate ? <>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Сегодня</h3>
        <div className={styles.summaryGrid}>
          <div className={styles.summaryItem}><div className={styles.summaryLabel}>Присутствие</div><div className={styles.summaryValue}>{attendance?.submittedAt ? `${attendance.employeeIds.length} отмечено` : 'Не подтверждено'}</div></div>
          <div className={styles.summaryItem}><div className={styles.summaryLabel}>Дневной отчёт</div><div className={styles.summaryValue}>{report ? report.submittedRevision === report.revision && report.submittedRevision > 0 ? 'Отправлен' : 'Черновик' : 'Нет'}</div></div>
          <div className={styles.summaryItem}><div className={styles.summaryLabel}>Фото прибытия</div><div className={styles.summaryValue}>{arrival ? 'Есть' : 'Нет'}</div></div>
          <div className={styles.summaryItem}><div className={styles.summaryLabel}>Задачи</div><div className={styles.summaryValue}>{openTasks.length} открыто · {overdueTasks.length} просрочено</div></div>
        </div>
        <Link href={`/objects/${item.id}#today`}>Все действия раздела «Сегодня»</Link>
      </section>
      {attendance ? <section className={styles.section}>
        {attendance.submittedAt ? <div className={styles.meta}>Сохранено: {attendance.submittedBy?.fullName ?? 'Менеджер'} · {stamp(attendance.submittedAt)}</div> : null}
        {attendance.prefillSourceDate ? <div className={styles.notice}>Предложен доступный состав за {attendance.prefillSourceDate}. Выходы появятся только после сохранения.</div> : null}
        {attendance.employeeFacts.map((fact) => <div key={fact.employeeId} className={styles.meta}>{fact.employeeName ?? attendance.employees.find((employee) => employee.id === fact.employeeId)?.fullName ?? 'Сотрудник'} · {fact.workedHours ?? '—'} ч · {fact.rateAmount.toLocaleString('ru-RU')} ₽{fact.rateReason ? ` · ${fact.rateReason}` : ''}{fact.createdBy ? ` · ${fact.createdBy.fullName}` : ''}{fact.updatedAt ? ` · ${stamp(fact.updatedAt)}` : ''}</div>)}
        <ObjectAttendancePanel objectId={item.id} onSubstitutionSaved={refreshAttendance} employees={attendance.employees} initialEmployeeIds={initialIds} initialEmployeeFacts={attendance.employeeFacts}
          canEditRates={item.capabilities.canEditDailyRate} canAddExtraShift={item.capabilities.canAddExtraShift ?? false} operationDate={attendance.operationDate}
          onSave={async (payload) => { await upsertObjectAttendance(item.id, payload); await refreshAttendance(); }} />
      </section> : null}
      {!loading && !readErrors.includes('Отчёт') ? <section className={styles.section}><ObjectDailyReportPanel item={report} onSave={async (payload) => {
        const saved = await upsertTodayDailyReport(item.id, { content: payload.content, expectedRevision: report?.revision ?? 0 });
        setReport(saved);
        const uploads = await uploadFileBatch({ entityType: 'object_daily_report', entityId: saved.id, files: payload.files });
        if (uploads.some((result) => result.status === 'rejected')) throw new Error('Отчёт сохранён, не все файлы загрузились. Повторите сохранение: загруженные файлы не продублируются.');
        setReport(await getTodayDailyReport(item.id));
      }} /></section> : null}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Фото прибытия</h3>
        {arrival ? <><div className={styles.meta}>{arrival.createdBy.fullName} · {stamp(arrival.updatedAt)}</div>
          {arrival.comment ? <p>{arrival.comment}</p> : null}
          {arrival.photoType ? <div>{arrival.photoType}</div> : null}
          <AttachmentPreviewList files={arrival.attachments} emptyText="Вложений нет" />
          {arrival.photoUrl ? <a href={arrival.photoUrl} target="_blank" rel="noreferrer">Открыть фото прибытия</a> : null}</> : <div>Фото не добавлено</div>}
        <Link href={`/objects/${item.id}#today`}>Добавить или изменить фото</Link>
      </section>
      <section className={styles.section}><h3 className={styles.sectionTitle}>Задачи</h3>
        {openTasks.map((task) => <div key={task.id}><Link href={`/tasks/${task.id}`}>{task.title}</Link>{task.isOverdue ? ' · Просрочена' : ''}</div>)}
        <Link href={`/objects/${item.id}#tasks`}>Все задачи объекта</Link>
      </section>
      <section className={styles.section}><h3 className={styles.sectionTitle}>Оперативный комментарий</h3>
        <label><span className={styles.label}>Комментарий</span><textarea className={styles.textarea} value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} /></label>
        <Button disabled={savingComment || !commentDraft.trim()} onClick={() => void saveComment()}>{savingComment ? 'Добавляю…' : 'Добавить комментарий'}</Button>
      </section>
      <section className={styles.section}><h3 className={styles.sectionTitle}>Ресурсы</h3>
        <div>Оборудование: {equipmentCount ?? '—'} · Движения расходников: {inventoryMovementCount ?? '—'}</div>
        <Link href={`/objects/${item.id}#equipment`}>Оборудование</Link>{' · '}<Link href={`/objects/${item.id}#inventory`}>Расходники</Link>
      </section>
    </> : canReadReports ? <section className={styles.section}><h3 className={styles.sectionTitle}>Ежедневные отчёты</h3>
      {reports.map((entry) => <article key={entry.id}><h4>{new Date(entry.reportDate).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}</h4><p>{entry.content}</p>
        <div className={styles.meta}>{entry.updatedBy.fullName} · {stamp(entry.updatedAt)}</div><AttachmentPreviewList files={entry.attachments} emptyText="Вложений нет" /></article>)}
      {!loading && !reports.length && !readErrors.length ? <div>Отчётов пока нет.</div> : null}
      <Link href={`/objects/${item.id}#history`}>История объекта</Link>
    </section> : <div className={styles.notice}>Операционные данные скрыты текущими правами доступа.</div>}
    {message ? <div className={styles.notice} role="status">{message}</div> : null}
  </Drawer>;
}
