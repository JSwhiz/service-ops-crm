'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';
import { getObjectById } from '@/entities/object/api/object-client';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { useAuth } from '@/shared/auth/use-auth';
import { captureObjectWriteFence, objectSavedWithoutAccess } from '@/features/object-shared-ui/object-write-fence';
import { isSavedWithoutAccess } from '@/shared/api/saved-without-access';
import { AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';
import { getObjectEquipment } from '@/entities/equipment/api/equipment-client';
import { getObjectInventory } from '@/entities/inventory/api/inventory-client';
import { createObjectComment, getTodayArrivalPhoto, getTodayDailyReport, getTodayObjectAttendance, listObjectDailyReports, upsertObjectAttendance, upsertTodayDailyReport, type ObjectAttendanceToday } from '@/entities/object/api/object-operations-client';
import type { ObjectArrivalPhoto, ObjectDailyReport } from '@/entities/object/model/object-operations.types';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { listTasksByObject } from '@/entities/task/api/task-client';
import type { TaskItem } from '@/entities/task/model/task.types';
import { ObjectAttendancePanel } from '@/features/object-attendance/ui/object-attendance-panel';
import { ObjectDailyReportPanel } from '@/features/object-report/ui/object-daily-report-panel';
import { PeopleList, PersonName } from '@/shared/ui/person-presentation/person-presentation';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { Button } from '@/shared/ui/foundation';
import { Drawer, useConfirm } from '@/shared/ui/overlays';
import styles from './object-preview-drawer.module.css';

function stamp(date: string): string { return new Date(date).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }); }

export function ObjectPreviewDrawer({ item, onClose }: { item: ServiceObject | null; onClose: () => void }): React.JSX.Element | null {
  const { user } = useAuth();
  return item ? <ObjectPreviewContent key={`${user?.id}:${item.id}`} item={item} onClose={onClose} /> : null;
}

function ObjectPreviewContent({ item: initialItem, onClose }: { item: ServiceObject; onClose: () => void }): React.JSX.Element {
  const router = useRouter();
  const accessRevision = useAccessRevision();
  const { user, capabilitiesRefreshError, refreshUser } = useAuth();
  const surfaceMounted = useRef(true);
  useEffect(() => { surfaceMounted.current = true; return () => { surfaceMounted.current = false; }; }, []);
  const [writeAcknowledged, setWriteAcknowledged] = useState(false);
  const [checkingWrite, setCheckingWrite] = useState(false);
  const [item, setItem] = useState(initialItem);
  const [loadedRevision, setLoadedRevision] = useState<string | null>(null);
  const [coreDenied, setCoreDenied] = useState(false);
  const latest = useRef({ accessRevision, objectId: initialItem.id, capabilitiesRefreshError, userId: user?.id });
  latest.current = { accessRevision, objectId: initialItem.id, capabilitiesRefreshError, userId: user?.id };
  useEffect(() => {
    let active = true;
    const identity = user?.id;
    const targetId = initialItem.id;
    const fence = captureObjectWriteFence(() => surfaceMounted.current && latest.current.objectId === targetId && latest.current.userId === identity);
    if (capabilitiesRefreshError) return () => { active = false; };
    void getObjectById(targetId).then((fresh) => {
      if (active && fence.current() && fresh.id === targetId && latest.current.accessRevision === accessRevision && !latest.current.capabilitiesRefreshError) { setItem(fresh); setLoadedRevision(accessRevision); setCoreDenied(false); }
    }).catch(() => { if (active && fence.current()) setCoreDenied(true); });
    return () => { active = false; };
  }, [initialItem.id, accessRevision, capabilitiesRefreshError, user?.id]);
  const [confirmDiscard, discardDialog] = useConfirm();
  const [reportEditState, setReportEditState] = useState({ dirty: false, busy: false });
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
  const [loadedOperationsRevision, setLoadedOperationsRevision] = useState<string | null>(null);
  const accessBlocked = writeAcknowledged || !!capabilitiesRefreshError || coreDenied || loadedRevision !== accessRevision || loadedOperationsRevision !== accessRevision || item.id !== initialItem.id;
  const canOperate = item.capabilities.canViewOperationalSections;
  const canReadReports = canOperate || !!item.capabilities.canViewReportsHistory;
  const canAttend = canOperate && item.capabilities.canOperateAttendance !== false;
  const dirty = reportEditState.dirty || !!commentDraft.trim();
  const busy = reportEditState.busy || savingComment;

  useEffect(() => {
    if (!dirty && !busy) return;
    const beforeUnload = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, busy]);

  const mayLeave = async (): Promise<boolean> => {
    if (busy) return false;
    return !dirty || confirmDiscard({ title: 'Закрыть без сохранения?', consequence: 'Несохранённые изменения отчёта, вложений и комментария будут потеряны. Сохранённые данные не изменятся.', confirmLabel: 'Выйти без сохранения', tone: 'danger' });
  };

  useEffect(() => {
    let cancelled = false;
    const identity = user?.id;
    const requestId = item.id;
    const fence = captureObjectWriteFence(() => surfaceMounted.current && latest.current.objectId === requestId && latest.current.userId === identity);
    const errors: string[] = [];
    setLoadedOperationsRevision(null); setLoading(true);
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
      if (cancelled || !fence.current() || latest.current.capabilitiesRefreshError) return;
      setAttendance(nextAttendance); setReport(nextReport); setArrival(nextArrival); setTasks(nextTasks);
      setEquipmentCount(equipment?.units.length ?? null); setInventoryMovementCount(inventory?.movements.length ?? null);
      setReports(history); setReadErrors(errors); setLoadedOperationsRevision(accessRevision); setLoading(false);
    });
    return () => { cancelled = true; };
  }, [item.id, canOperate, canReadReports, canAttend, accessRevision, loadedRevision]);

  const previewOperation = () => {
    const targetId = item.id;
    const identity = user?.id;
    const fence = captureObjectWriteFence(() => surfaceMounted.current && latest.current.objectId === targetId && latest.current.userId === identity);
    const current = () => fence.current() && !latest.current.capabilitiesRefreshError;
    const acknowledge = () => { if (fence.sameTarget()) { setWriteAcknowledged(true); void refreshUser({ force: true }).catch(() => undefined); } return objectSavedWithoutAccess; };
    return { targetId, fence, current, acknowledge };
  };
  const refreshAttendance = async (): Promise<void> => {
    const operation = previewOperation();
    if (!operation.current()) return;
    const fresh = await getTodayObjectAttendance(operation.targetId);
    if (operation.current()) setAttendance(fresh);
  };
  const saveComment = async (): Promise<void> => {
    if (!commentDraft.trim() || savingComment || accessBlocked || item.capabilities.canCreateComment !== true) return;
    const operation = previewOperation();
    setSavingComment(true); setMessage(null);
    try {
      const result = await createObjectComment(operation.targetId, { content: commentDraft.trim() });
      if (isSavedWithoutAccess(result) || !operation.current() || result.objectId !== operation.targetId) { operation.acknowledge(); return; }
      setCommentDraft(''); setMessage('Комментарий добавлен.');
    } catch { if (operation.current()) setMessage('Не удалось добавить комментарий.'); }
    finally { if (operation.fence.sameTarget()) setSavingComment(false); }
  };
  const openTasks = tasks.filter((task) => !['completed', 'cancelled'].includes(task.status));
  const overdueTasks = openTasks.filter((task) => task.isOverdue);
  const initialIds = attendance?.employeeIds.length ? attendance.employeeIds : attendance?.suggestedEmployeeIds ?? [];

  return <>{discardDialog}<Drawer open busy={busy} onOpenChange={(open) => { if (!open) void mayLeave().then((allowed) => { if (allowed) onClose(); }); }} title={accessBlocked ? 'Проверка доступа к объекту' : item.name}
    onClickCapture={(event) => {
      // Preserve modifier/new-tab link behaviour. Guard only navigation that
      // would unmount this drawer and discard its local edits.
      if ((!dirty && !busy) || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a') : null;
      const href = anchor?.getAttribute('href');
      if (!href?.startsWith('/') || href.startsWith('//') || anchor?.target === '_blank') return;
      event.preventDefault();
      event.stopPropagation();
      void mayLeave().then((allowed) => { if (allowed) router.push(href); });
    }}
    description={accessBlocked ? 'Черновики сохранены до подтверждения доступа.' : [item.internalName, item.address].filter(Boolean).join(' · ')}
    footer={<div className={styles.footer}><Link className={styles.primaryAction} href={`/objects/${item.id}`}>Открыть объект</Link>
      {!accessBlocked && (item.capabilities.canEdit || item.capabilities.canManageCompensationRates) ? <Link className={styles.actionButton} href={`/objects/${item.id}/edit`}>Редактировать</Link> : null}</div>}>
    {writeAcknowledged ? <div className={styles.notice} role="status">Запись сохранена без доступных подробностей. Черновики сохранены; повтор не отправлялся.
      <Button pending={checkingWrite} disabled={checkingWrite} onClick={async () => {
        const targetId = item.id; const identity = user?.id;
        setCheckingWrite(true);
        try {
          await refreshUser({ force: true });
          const fence = captureObjectWriteFence(() => surfaceMounted.current && latest.current.objectId === targetId && latest.current.userId === identity);
          const freshCore = await getObjectById(targetId);
          if (!fence.current() || latest.current.capabilitiesRefreshError) return;
          const freshReport = await getTodayDailyReport(targetId);
          if (!fence.current() || (freshReport && freshReport.objectId !== targetId)) return;
          setItem(freshCore); setReport(freshReport); setLoadedRevision(latest.current.accessRevision); setWriteAcknowledged(false);
        } catch { /* Keep the truthful receipt and private draft; do not resend. */ }
        finally { if (surfaceMounted.current && latest.current.objectId === targetId && latest.current.userId === identity) setCheckingWrite(false); }
      }}>Проверить сохранённые данные</Button>
    </div> : null}
    {accessBlocked ? <div className={styles.notice}>Доступ к объекту проверяется. Черновики сохранены.</div> : null}
    <AccessSnapshotBoundary blocked={accessBlocked}>
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Ответственные</h3>
      <div className={styles.peopleRow}><span className={styles.label}>Ответственный</span><span className={styles.value}>{item.responsible ? <PersonName person={item.responsible} /> : 'Не назначен'}</span></div>
      <div className={styles.peopleRow}><span className={styles.label}>Менеджеры</span><div className={styles.value}>{item.managers.length ? <PeopleList people={item.managers} compact={false} label="Менеджеры объекта" /> : 'Не назначены'}</div></div>
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
          onSave={async (payload) => { const result = await upsertObjectAttendance(item.id, payload); if ('adjustmentId' in result) return result; await refreshAttendance(); }} />
      </section> : null}
      {!loading && !readErrors.includes('Отчёт') ? <section className={styles.section}><ObjectDailyReportPanel objectId={item.id} item={report} canSave={item.capabilities.canEditDailyReport === true} canSubmit={item.capabilities.canSubmitDailyReport === true} onEditStateChange={setReportEditState}
        onSavedWithoutAccess={() => { previewOperation().acknowledge(); }}
        onAttachmentsUpdated={async () => {
          const operation = previewOperation();
          if (!operation.current()) return null;
          const fresh = await getTodayDailyReport(operation.targetId);
          if (!operation.current() || (fresh && fresh.objectId !== operation.targetId)) return null;
          setReport(fresh); return fresh;
        }} onSave={async (payload) => {
          const operation = previewOperation();
          if (!operation.current()) throw new Error('Доступ изменился. Черновик сохранён.');
          const saved = await upsertTodayDailyReport(operation.targetId, { content: payload.content, expectedRevision: report?.revision ?? 0 });
          if (isSavedWithoutAccess(saved) || !operation.current() || saved.objectId !== operation.targetId) return operation.acknowledge();
          try {
            const fresh = await getTodayDailyReport(operation.targetId);
            if (!operation.current() || !fresh || fresh.objectId !== operation.targetId) return operation.acknowledge();
            setReport(fresh); return fresh;
          } catch { return operation.acknowledge(); }
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
        <label><span className={styles.label}>Комментарий</span><textarea className={styles.textarea} disabled={savingComment || accessBlocked || item.capabilities.canCreateComment !== true} value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} /></label>
        <Button disabled={savingComment || accessBlocked || item.capabilities.canCreateComment !== true || !commentDraft.trim()} onClick={() => void saveComment()}>{savingComment ? 'Добавляю…' : 'Добавить комментарий'}</Button>
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
    </AccessSnapshotBoundary>
  </Drawer></>;
}
