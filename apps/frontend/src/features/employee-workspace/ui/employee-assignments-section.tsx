'use client';

import Link from 'next/link';
import React, { useId, useState } from 'react';

import {
  assignEmployeeToObject,
  deleteEmployeeAssignmentAsError,
  listEmployeeObjectReferences,
  removeEmployeeFromObject,
} from '@/entities/employee/api/employee-client';
import { formatEmployeeCompensation } from '@/entities/employee/lib/employee-presentation';
import type { EmployeeDetail, EmployeeObjectReference } from '@/entities/employee/model/employee.types';
import { ApiError } from '@/shared/api/fetcher';
import { Alert, Button, Field, Surface } from '@/shared/ui/foundation';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { ConfirmDialog, Dialog, ReasonDialog } from '@/shared/ui/overlays';
import { OverflowMenu, type OverflowMenuItem } from '@/shared/ui/overflow-menu/overflow-menu';

import styles from './employee-workspace.module.css';
import { SelectField } from '@/shared/ui/searchable-select/select-field';

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

function formatDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(value)) : '—';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function ObjectName({
  objectId,
  objectName,
  canOpen,
}: {
  objectId: string;
  objectName: string;
  canOpen: boolean;
}): React.JSX.Element {
  return canOpen ? (
    <Link className={styles.listTitle} href={`/objects/${objectId}`}>{objectName}</Link>
  ) : (
    <span className={styles.listTitle} title="Карточка объекта вам недоступна">{objectName}</span>
  );
}

export function EmployeeAssignmentsSection({
  item,
  onItemChange,
  assignOpen,
  onAssignOpenChange,
}: {
  item: EmployeeDetail;
  onItemChange: (employee: EmployeeDetail) => void;
  assignOpen: boolean;
  onAssignOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const canManage = item.capabilities.canManageAssignments && !item.isArchived;
  const [removeTarget, setRemoveTarget] = useState<{ objectId: string; objectName: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ historyId: string; label: string } | null>(null);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const historyById = new Map(item.objectAssignmentHistory.map((entry) => [entry.id, entry]));
  const finished = item.objectAssignmentHistory.filter((entry) => entry.endedAt);

  const openDelete = (historyId: string, label: string): void => {
    setReason('');
    setDialogError(null);
    setDeleteTarget({ historyId, label });
  };

  return (
    <div className={styles.panel}>
      <Surface className={`${styles.section} ${styles.sectionFlush}`} aria-labelledby="employee-current-objects">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="employee-current-objects" className={styles.sectionTitle}>Текущие объекты</h2>
          </div>
        </div>
        {item.currentObjectAssignments.length === 0 ? (
          <p className={styles.listEmpty}>Сотрудник сейчас не закреплён ни за одним объектом{canManage ? ' — назначьте его кнопкой «Назначить на объект» вверху' : ''}.</p>
        ) : (
          <ul className={styles.list}>
            {item.currentObjectAssignments.map((assignment) => {
              const history = assignment.historyId ? historyById.get(assignment.historyId) : undefined;
              const actions: OverflowMenuItem[] = [
                ...(canManage ? [{
                  key: 'remove',
                  label: 'Снять с объекта',
                  onSelect: () => { setDialogError(null); setRemoveTarget({ objectId: assignment.objectId, objectName: assignment.objectName }); },
                }] : []),
                ...(history?.canDeleteAsError && item.capabilities.canDeleteAssignmentAsError ? [{
                  key: 'delete',
                  label: 'Удалить ошибочное назначение',
                  tone: 'danger' as const,
                  onSelect: () => openDelete(history.id, `${assignment.objectName} · с ${formatDate(assignment.startDate)}`),
                }] : []),
              ];
              return (
                <li key={assignment.assignmentId} className={styles.listRow}>
                  <div className={styles.listMain}>
                    <ObjectName objectId={assignment.objectId} objectName={assignment.objectName} canOpen={assignment.canOpenObjectCard} />
                    <span className={styles.listMeta}>С {formatDate(assignment.startDate)}</span>
                    {assignment.compensation ? (
                      <span className={assignment.compensation.amount ? styles.listMeta : styles.warningText}>
                        Оплата: {formatEmployeeCompensation(assignment.compensation)}
                      </span>
                    ) : null}
                  </div>
                  <div className={styles.listAside}>
                    <OverflowMenu items={actions} triggerLabel={`Действия: ${assignment.objectName}`} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Surface>

      <Surface className={`${styles.section} ${styles.sectionFlush}`} aria-labelledby="employee-finished-objects">
        <div className={styles.sectionHeader}>
          <h2 id="employee-finished-objects" className={styles.sectionTitle}>Завершённые назначения</h2>
        </div>
        {finished.length === 0 ? (
          <p className={styles.listEmpty}>Завершённых назначений нет.</p>
        ) : (
          <ul className={styles.list}>
            {finished.map((entry) => (
              <li key={entry.id} className={styles.listRow}>
                <div className={styles.listMain}>
                  <ObjectName objectId={entry.objectId} objectName={entry.objectName} canOpen={entry.canOpenObjectCard} />
                  <span className={styles.listMeta}>
                    {formatDate(entry.startedAt)} — {formatDate(entry.endedAt)}
                  </span>
                </div>
                <div className={styles.listAside}>
                  <OverflowMenu
                    triggerLabel={`Действия: ${entry.objectName}`}
                    items={entry.canDeleteAsError && item.capabilities.canDeleteAssignmentAsError ? [{
                      key: 'delete',
                      label: 'Удалить ошибочную запись',
                      tone: 'danger',
                      onSelect: () => openDelete(entry.id, `${entry.objectName} · ${formatDate(entry.startedAt)} — ${formatDate(entry.endedAt)}`),
                    }] : []}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Surface>

      {canManage ? (
        <AssignDialog
          open={assignOpen}
          onOpenChange={onAssignOpenChange}
          item={item}
          onSaved={(updated) => { onItemChange(updated); onAssignOpenChange(false); }}
        />
      ) : null}

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}
        title="Снять с объекта?"
        consequence={removeTarget ? `${item.fullName} больше не будет в составе «${removeTarget.objectName}». Назначение завершится, история и табель сохранятся.` : ''}
        confirmLabel="Снять с объекта"
        pending={pending}
        error={dialogError}
        onConfirm={async () => {
          if (!removeTarget) return;
          setPending(true);
          setDialogError(null);
          try {
            onItemChange(await removeEmployeeFromObject(item.id, removeTarget.objectId));
            setRemoveTarget(null);
          } catch (error) {
            setDialogError(errorMessage(error, 'Не удалось снять сотрудника с объекта.'));
          } finally {
            setPending(false);
          }
        }}
      />

      <ReasonDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Удалить ошибочное назначение?"
        description={deleteTarget ? `${deleteTarget.label}. Удаляется только запись назначения, объект остаётся. Если по назначению уже есть выходы или табель — удалить нельзя, завершите его.` : undefined}
        reasonLabel="Причина удаления"
        reason={reason}
        onReasonChange={setReason}
        confirmLabel="Удалить запись"
        pending={pending}
        error={dialogError}
        onConfirm={async (value) => {
          if (!deleteTarget) return;
          if (value.trim().length < 5) { setDialogError('Причина — не меньше 5 символов.'); return; }
          setPending(true);
          setDialogError(null);
          try {
            onItemChange(await deleteEmployeeAssignmentAsError(item.id, deleteTarget.historyId, value.trim()));
            setDeleteTarget(null);
          } catch (error) {
            setDialogError(error instanceof ApiError && error.code === 'ASSIGNMENT_HAS_OPERATIONAL_HISTORY'
              ? 'Назначение уже использовалось в учёте. Завершите его вместо удаления.'
              : errorMessage(error, 'Не удалось удалить назначение.'));
          } finally {
            setPending(false);
          }
        }}
      />
    </div>
  );
}

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function AssignDialog({
  open,
  onOpenChange,
  item,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: EmployeeDetail;
  onSaved: (employee: EmployeeDetail) => void;
}): React.JSX.Element {
  const formId = useId();
  const [objectId, setObjectId] = useState('');
  const [startDate, setStartDate] = useState(todayKey);
  const [objects, setObjects] = useState<Map<string, EmployeeObjectReference>>(new Map());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [objectError, setObjectError] = useState<string | null>(null);
  const currentIds = new Set(item.currentObjectAssignments.map((assignment) => assignment.objectId));
  const selected = objects.get(objectId);
  const pay = selected?.compensation;

  const close = (): void => {
    setObjectId('');
    setStartDate(todayKey());
    setError(null);
    setObjectError(null);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (!next) close(); else onOpenChange(true); }}
      title="Назначить на объект"
      description={`${item.fullName} войдёт в постоянный состав объекта.`}
      busy={pending}
      footer={
        <div className={styles.dialogActions}>
          <Button variant="ghost" disabled={pending} onClick={close}>Отмена</Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            pending={pending}
            pendingLabel="Назначение…"
          >
            Назначить
          </Button>
        </div>
      }
    >
      <form
        id={formId}
        className={styles.dialogForm}
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending) return;
          if (!objectId) { setObjectError('Выберите объект.'); return; }
          setPending(true);
          setError(null);
          try {
            const [year, month, day] = startDate.split('-').map(Number);
            onSaved(await assignEmployeeToObject(item.id, {
              objectId,
              startDate: new Date(year!, month! - 1, day!).toISOString(),
            }));
            close();
          } catch (caught) {
            setError(errorMessage(caught, 'Не удалось назначить сотрудника на объект.'));
          } finally {
            setPending(false);
          }
        }}
      >
        {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
        <SelectField
          label="Объект"
          required
          disabled={pending}
          error={objectError ?? undefined}
          value={objectId}
          options={[]}
          placeholder="Выберите объект"
          searchPlaceholder="Название объекта"
          asyncSearch={async (query) => {
            const found = (await listEmployeeObjectReferences(query)).filter((object) => !currentIds.has(object.id));
            setObjects((current) => new Map([...current, ...found.map((object) => [object.id, object] as const)]));
            return found.map((object) => ({
              value: object.id,
              label: object.name,
              description: formatEmployeeCompensation(object.compensation) ?? undefined,
            }));
          }}
          onChange={(value) => { setObjectId(value); setObjectError(null); }}
        />
        <Field label="Дата начала" required description="С этой даты сотрудник появится в составе объекта и в отметках выхода.">
          <DatePicker value={startDate} disabled={pending} clearable={false} onChange={(value) => setStartDate(value || todayKey())} />
        </Field>
        {selected && pay !== undefined ? (
          pay === null ? null : pay.amount ? (
            <Alert tone="info" title="Оплата на объекте">
              {formatEmployeeCompensation(pay)} по умолчанию. Индивидуальную ставку можно задать в составе объекта.
            </Alert>
          ) : (
            <Alert tone="warning" title="На объекте не задана ставка">
              Выходы будут без оплаты, пока ставку не зададут в настройках объекта или в составе.
            </Alert>
          )
        ) : null}
      </form>
    </Dialog>
  );
}
