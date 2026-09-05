'use client';

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

import { getObjectEquipment } from '@/entities/equipment/api/equipment-client';
import { getObjectInventory } from '@/entities/inventory/api/inventory-client';
import {
  createObjectComment,
  getTodayArrivalPhoto,
  getTodayDailyReport,
  getTodayObjectAttendance,
  upsertObjectAttendance,
  upsertTodayDailyReport,
  type ObjectAttendanceToday,
} from '@/entities/object/api/object-operations-client';
import type { ObjectArrivalPhoto, ObjectDailyReport } from '@/entities/object/model/object-operations.types';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { listTasksByObject } from '@/entities/task/api/task-client';
import type { TaskItem } from '@/entities/task/model/task.types';
import { getUserDisplayName } from '@/shared/lib/display-name';

import styles from './object-preview-drawer.module.css';

function moscowBusinessDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function statusLabel(status: string): string {
  if (status === 'active') return 'Активный';
  if (status === 'frozen') return 'Заморожен';
  if (status === 'archived') return 'Архив';
  return status;
}

export function ObjectPreviewDrawer({
  item,
  onClose,
}: {
  item: ServiceObject | null;
  onClose: () => void;
}): React.JSX.Element | null {
  const [attendance, setAttendance] = useState<ObjectAttendanceToday | null>(null);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [report, setReport] = useState<ObjectDailyReport | null>(null);
  const [reportDraft, setReportDraft] = useState('');
  const [arrival, setArrival] = useState<ObjectArrivalPhoto | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [equipmentCount, setEquipmentCount] = useState<number | null>(null);
  const [inventoryMovementCount, setInventoryMovementCount] = useState<number | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [savingReport, setSavingReport] = useState(false);
  const [savingComment, setSavingComment] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!item || !item.capabilities.canViewOperationalSections) {
      setAttendance(null);
      setSelectedEmployeeIds([]);
      setReport(null);
      setReportDraft('');
      setArrival(null);
      setTasks([]);
      setEquipmentCount(null);
      setInventoryMovementCount(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setMessage(null);

    void Promise.all([
      getTodayObjectAttendance(item.id).catch(() => null),
      getTodayDailyReport(item.id).catch(() => null),
      getTodayArrivalPhoto(item.id).catch(() => null),
      listTasksByObject(item.id).catch(() => []),
      getObjectEquipment(item.id).catch(() => null),
      getObjectInventory(item.id).catch(() => null),
    ]).then(([nextAttendance, nextReport, nextArrival, nextTasks, equipment, inventory]) => {
      if (cancelled) return;
      setAttendance(nextAttendance);
      setSelectedEmployeeIds(nextAttendance?.employeeIds ?? []);
      setReport(nextReport);
      setReportDraft(nextReport?.content ?? '');
      setArrival(nextArrival);
      setTasks(nextTasks);
      setEquipmentCount(equipment?.units.length ?? null);
      setInventoryMovementCount(inventory?.movements.length ?? null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [item]);

  useEffect(() => {
    if (!item) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [item, onClose]);

  const openTasks = useMemo(
    () => tasks.filter((task) => !['completed', 'cancelled'].includes(task.status)),
    [tasks],
  );
  const overdueTasks = useMemo(() => openTasks.filter((task) => task.isOverdue), [openTasks]);

  if (!item) return null;

  const saveAttendance = async (): Promise<void> => {
    if (!attendance) return;
    setSavingAttendance(true);
    setMessage(null);
    try {
      await upsertObjectAttendance(item.id, {
        operationDate: moscowBusinessDate(),
        employeeIds: selectedEmployeeIds,
      });
      const refreshed = await getTodayObjectAttendance(item.id);
      setAttendance(refreshed);
      setSelectedEmployeeIds(refreshed.employeeIds);
      setMessage('Присутствие сохранено.');
    } catch {
      setMessage('Не удалось сохранить присутствие.');
    } finally {
      setSavingAttendance(false);
    }
  };

  const saveReport = async (): Promise<void> => {
    const content = reportDraft.trim();
    if (!content) return;
    setSavingReport(true);
    setMessage(null);
    try {
      const next = await upsertTodayDailyReport(item.id, { content });
      setReport(next);
      setReportDraft(next.content);
      setMessage('Дневной отчёт сохранён.');
    } catch {
      setMessage('Не удалось сохранить дневной отчёт.');
    } finally {
      setSavingReport(false);
    }
  };

  const saveComment = async (): Promise<void> => {
    const content = commentDraft.trim();
    if (!content) return;
    setSavingComment(true);
    setMessage(null);
    try {
      await createObjectComment(item.id, { content });
      setCommentDraft('');
      setMessage('Комментарий добавлен.');
    } catch {
      setMessage('Не удалось добавить комментарий.');
    } finally {
      setSavingComment(false);
    }
  };

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={onClose}>
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={`Объект ${item.name}`} onMouseDown={(event) => event.stopPropagation()}>
        <header className={styles.header}>
          <div className={styles.titleWrap}>
            <h2 className={styles.title}>{item.name}</h2>
            <div className={styles.meta}>
              {[item.internalName, item.address].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button className={styles.closeButton} type="button" onClick={onClose} aria-label="Закрыть превью">×</button>
        </header>

        <div className={styles.statusRow}>
          <span className={styles.status}>{statusLabel(item.status)}</span>
          <span className={styles.meta}>Обновлён {new Date(item.updatedAt).toLocaleDateString('ru-RU')}</span>
        </div>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Ответственные</h3>
          <div className={styles.peopleRow}><span className={styles.label}>Ответственный</span><span className={styles.value}>{item.responsible ? getUserDisplayName(item.responsible) : 'Не назначен'}</span></div>
          <div className={styles.peopleRow}><span className={styles.label}>Менеджеры</span><span className={styles.value}>{item.managers.length ? item.managers.map(getUserDisplayName).join(', ') : 'Не назначены'}</span></div>
          <div className={styles.peopleRow}><span className={styles.label}>Команда</span><span className={styles.value}>{item.employees.length} сотрудников</span></div>
        </section>

        {item.capabilities.canViewOperationalSections ? (
          <>
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Сегодня</h3>
              <div className={styles.summaryGrid}>
                <div className={styles.summaryItem}><div className={styles.summaryLabel}>Присутствие</div><div className={styles.summaryValue} data-state={attendance?.submittedAt ? 'ok' : 'attention'}>{loading ? 'Загрузка…' : attendance?.submittedAt ? `${attendance.employeeIds.length} отмечено` : 'Не отмечено'}</div></div>
                <div className={styles.summaryItem}><div className={styles.summaryLabel}>Дневной отчёт</div><div className={styles.summaryValue} data-state={report ? 'ok' : 'attention'}>{loading ? 'Загрузка…' : report ? 'Есть' : 'Нет'}</div></div>
                <div className={styles.summaryItem}><div className={styles.summaryLabel}>Фото прибытия</div><div className={styles.summaryValue} data-state={arrival ? 'ok' : 'attention'}>{loading ? 'Загрузка…' : arrival ? 'Есть' : 'Нет'}</div></div>
                <div className={styles.summaryItem}><div className={styles.summaryLabel}>Задачи</div><div className={styles.summaryValue} data-state={overdueTasks.length ? 'attention' : 'ok'}>{loading ? 'Загрузка…' : `${openTasks.length} открыто${overdueTasks.length ? ` · ${overdueTasks.length} просрочено` : ''}`}</div></div>
              </div>
            </section>

            {attendance ? (
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>Быстро отметить присутствие</h3>
                <div className={styles.attendanceList}>
                  {attendance.employees.map((employee) => (
                    <label key={employee.id} className={styles.attendanceItem}>
                      <input
                        type="checkbox"
                        checked={selectedEmployeeIds.includes(employee.id)}
                        onChange={(event) => setSelectedEmployeeIds((current) => event.target.checked ? [...new Set([...current, employee.id])] : current.filter((id) => id !== employee.id))}
                      />
                      <span>{employee.fullName}</span>
                    </label>
                  ))}
                </div>
                <div className={styles.actionGrid}>
                  <button className={styles.actionButton} type="button" disabled={savingAttendance} onClick={() => void saveAttendance()}>{savingAttendance ? 'Сохраняю…' : 'Сохранить присутствие'}</button>
                </div>
              </section>
            ) : null}

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Дневной отчёт</h3>
              <textarea className={styles.textarea} value={reportDraft} onChange={(event) => setReportDraft(event.target.value)} placeholder="Кратко зафиксируйте состояние объекта за сегодня" />
              <div className={styles.actionGrid}>
                <button className={styles.actionButton} type="button" disabled={savingReport || !reportDraft.trim()} onClick={() => void saveReport()}>{savingReport ? 'Сохраняю…' : report ? 'Обновить отчёт' : 'Сохранить отчёт'}</button>
              </div>
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Оперативный комментарий</h3>
              <textarea className={styles.textarea} value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder="Добавить комментарий к объекту" />
              <div className={styles.actionGrid}>
                <button className={styles.actionButton} type="button" disabled={savingComment || !commentDraft.trim()} onClick={() => void saveComment()}>{savingComment ? 'Добавляю…' : 'Добавить комментарий'}</button>
              </div>
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Ресурсы</h3>
              <div className={styles.summaryGrid}>
                <div className={styles.summaryItem}><div className={styles.summaryLabel}>Оборудование</div><div className={styles.summaryValue}>{equipmentCount === null ? '—' : `${equipmentCount} ед.`}</div></div>
                <div className={styles.summaryItem}><div className={styles.summaryLabel}>Движения расходников</div><div className={styles.summaryValue}>{inventoryMovementCount === null ? '—' : inventoryMovementCount}</div></div>
              </div>
            </section>
          </>
        ) : (
          <div className={styles.notice}>Операционные данные скрыты текущими правами доступа.</div>
        )}

        {message ? <div className={`${styles.notice} ${message.startsWith('Не удалось') ? styles.error : ''}`} aria-live="polite">{message}</div> : null}

        <footer className={styles.footer}>
          <Link className={styles.primaryAction} href={`/objects/${item.id}`}>Открыть объект</Link>
          {item.capabilities.canEdit ? <Link className={styles.actionButton} href={`/objects/${item.id}/edit`}>Редактировать</Link> : null}
        </footer>
      </aside>
    </div>
  );
}
