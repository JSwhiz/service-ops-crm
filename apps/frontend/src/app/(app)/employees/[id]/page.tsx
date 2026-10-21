'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';

import {
  archiveEmployee,
  deleteEmployeePermanently,
  getEmployeeById,
  restoreEmployee,
  updateEmployee,
} from '@/entities/employee/api/employee-client';
import {
  getEmployeeLifecycleBadge,
  getEmployeeScheduleLabel,
  getEmployeeTypeLabel,
} from '@/entities/employee/lib/employee-presentation';
import type { EmployeeDetail } from '@/entities/employee/model/employee.types';
import {
  EmployeeFormFields,
  type EmployeeFormValue,
} from '@/features/employee-form/employee-form-fields';
import {
  toEmployeeFormValue,
  toEmployeeMutationPayload,
} from '@/features/employee-form/employee-form-payload';
import { phoneDraftsValid } from '@/shared/ui/phone-list-field/phone-list-field';
import { EmployeeAssignmentsSection } from '@/features/employee-workspace/ui/employee-assignments-section';
import { EmployeeProfileSection } from '@/features/employee-workspace/ui/employee-profile-section';
import { EmployeeScheduleSection } from '@/features/employee-workspace/ui/employee-schedule-section';
import styles from '@/features/employee-workspace/ui/employee-workspace.module.css';
import { ApiError } from '@/shared/api/fetcher';
import { useAuth } from '@/shared/auth/use-auth';
import { Alert, BackLink, Badge, Button, EmptyState, EntityHeader, FactStrip, IconButton, Skeleton, Surface } from '@/shared/ui/foundation';
import { ConfirmDialog, ReasonDialog } from '@/shared/ui/overlays';
import { OverflowMenu, type OverflowMenuItem } from '@/shared/ui/overflow-menu/overflow-menu';
import { WorkspaceTabs } from '@/shared/ui/workspace-tabs/workspace-tabs';
import { formatPhone, getPhoneHref } from '@/shared/lib/phone';
import { PencilIcon } from '@/shared/ui/icons/icons';
import { UserAvatar } from '@/shared/ui/user-avatar/user-avatar';

type Section = 'overview' | 'assignments' | 'schedule';

/** Older links used separate edit/history tabs; both now live inside other sections. */
function normalizeSection(raw: string | null): { section: Section; edit: boolean } {
  if (raw === 'edit') return { section: 'overview', edit: true };
  if (raw === 'history') return { section: 'assignments', edit: false };
  if (raw === 'assignments' || raw === 'schedule') return { section: raw, edit: false };
  return { section: 'overview', edit: false };
}

const DEPENDENCY_LABELS: Record<string, string> = {
  object_assignments: 'назначения на объекты',
  assignment_history: 'история назначений',
  availability_windows: 'периоды недоступности',
  substitutions_primary: 'подмены этого сотрудника',
  substitutions_replacement: 'подмены, где он заменял',
  attendance_facts: 'отметки выходов',
  timesheet_rows: 'строки табеля',
  timesheet_exceptions: 'исключения табеля',
};

function describeBlockers(blockers: Array<{ code: string; count: number }>): string {
  return blockers
    .map((blocker) => `${DEPENDENCY_LABELS[blocker.code] ?? 'рабочая история'} (${blocker.count})`)
    .join(', ');
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function isVersionConflict(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'EMPLOYEE_VERSION_CONFLICT';
}

export default function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const canAccessEmployeesHr = user?.capabilities?.canAccessEmployeesHr ?? false;
  const requested = normalizeSection(searchParams.get('section'));

  const [item, setItem] = useState<EmployeeDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<EmployeeFormValue | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [versionConflict, setVersionConflict] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [lifecycleDialog, setLifecycleDialog] = useState<'archive' | 'restore' | 'delete' | null>(null);
  const [lifecyclePending, setLifecyclePending] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const reload = async (id: string): Promise<EmployeeDetail> => {
    const employee = await getEmployeeById(id);
    setItem(employee);
    return employee;
  };

  useEffect(() => {
    if (!canAccessEmployeesHr) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    void params
      .then(({ id }) => getEmployeeById(id))
      .then((employee) => {
        if (cancelled) return;
        setItem(employee);
        setEditForm(toEmployeeFormValue(employee));
        if (requested.edit && employee.capabilities.canEdit && !employee.isArchived) setIsEditing(true);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(errorMessage(error, 'Не удалось загрузить карточку сотрудника.'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
    // The legacy ?section=edit flag is read once on load.
  }, [canAccessEmployeesHr, params]);

  const isDirty = useMemo(
    () => Boolean(isEditing && item && editForm &&
      JSON.stringify(editForm) !== JSON.stringify(toEmployeeFormValue(item))),
    [editForm, isEditing, item],
  );

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => { event.preventDefault(); };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  const changeSection = (section: string): void => {
    const next = new URLSearchParams(searchParams.toString());
    if (section === 'overview') next.delete('section');
    else next.set('section', section);
    const query = next.toString();
    router.replace(query ? `?${query}` : '?', { scroll: false });
  };

  const startEditing = (): void => {
    if (!item) return;
    setEditForm(toEmployeeFormValue(item));
    setSaveError(null);
    setVersionConflict(false);
    setIsEditing(true);
    changeSection('overview');
  };

  const runLifecycle = async (action: () => Promise<void>, fallback: string): Promise<void> => {
    setLifecyclePending(true);
    setLifecycleError(null);
    try {
      await action();
      setLifecycleDialog(null);
    } catch (error) {
      if (isVersionConflict(error)) {
        setLifecycleError('Карточку изменил другой пользователь. Данные обновлены — проверьте их и повторите.');
        if (item) await reload(item.id).catch(() => undefined);
      } else if (error instanceof ApiError && error.code === 'EMPLOYEE_HAS_ACTIVE_OBJECT_ASSIGNMENTS') {
        setLifecycleError('Сначала снимите сотрудника со всех объектов.');
      } else {
        setLifecycleError(errorMessage(error, fallback));
      }
    } finally {
      setLifecyclePending(false);
    }
  };

  if (!canAccessEmployeesHr) {
    return <div className={styles.page}><Alert tone="warning">У вас нет доступа к разделу сотрудников.</Alert></div>;
  }

  if (isLoading) {
    return (
      <div className={styles.page} aria-busy="true" aria-label="Загрузка">
        <Skeleton width={120} height={14} />
        <div className={styles.identity}>
          <Skeleton width={56} height={56} style={{ borderRadius: '50%' }} />
          <Skeleton width={320} height={28} />
        </div>
        <Skeleton height={76} />
        <Skeleton height={320} />
      </div>
    );
  }

  if (loadError || !item) {
    return (
      <div className={styles.page}>
        <BackLink href="/employees">Сотрудники</BackLink>
        {loadError ? (
          <Alert tone="danger" title="Карточка не загрузилась"
            action={<Button size="sm" onClick={() => window.location.reload()}>Повторить</Button>}>
            {loadError}
          </Alert>
        ) : (
          <EmptyState title="Сотрудник не найден" description="Возможно, карточку удалили или ссылка устарела." />
        )}
      </div>
    );
  }

  const lifecycle = getEmployeeLifecycleBadge(item);
  const caps = item.capabilities;
  const phoneHref = getPhoneHref(item.phone);
  const canAssign = caps.canManageAssignments && !item.isArchived;
  const canEdit = caps.canEdit && !item.isArchived;
  const activeSection = requested.section;

  const overflowItems: OverflowMenuItem[] = [
    ...(caps.canRestore ? [{ key: 'restore', label: 'Восстановить из архива', onSelect: () => { setLifecycleError(null); setLifecycleDialog('restore'); } }] : []),
    ...(caps.canArchive ? [{
      key: 'archive',
      label: 'Перенести в архив',
      disabled: !item.lifecycleEligibility.archive.eligible,
      disabledReason: item.lifecycleEligibility.archive.eligible ? undefined : 'Сначала снимите со всех объектов',
      onSelect: () => { setLifecycleError(null); setLifecycleDialog('archive'); },
    }] : []),
    ...(caps.canDeletePermanently ? [{
      key: 'delete',
      label: 'Удалить ошибочную карточку',
      tone: 'danger' as const,
      disabled: !item.lifecycleEligibility.permanentDelete.eligible,
      disabledReason: item.lifecycleEligibility.permanentDelete.eligible
        ? undefined
        : `Есть рабочая история: ${describeBlockers(item.lifecycleEligibility.permanentDelete.blockers)}`,
      onSelect: () => { setDeleteReason(''); setLifecycleError(null); setLifecycleDialog('delete'); },
    }] : []),
  ];

  const tabs = [
    { value: 'overview', label: 'Профиль' },
    { value: 'assignments', label: `Объекты · ${item.currentObjectAssignments.length}` },
    { value: 'schedule', label: 'График и подмены' },
  ];

  return (
    <div className={styles.page}>
      <BackLink href="/employees">Сотрудники</BackLink>

      <div className={styles.headerBlock}>
        <EntityHeader
          title={
            <span className={styles.identity}>
              <UserAvatar fullName={item.fullName} size="large" variant="soft" decorative />
              <span>{item.fullName}</span>
            </span>
          }
          status={<Badge className={styles.badge} tone={lifecycle.tone}>{lifecycle.label}</Badge>}
          metadata={
            <span className={styles.metaLine}>
              <span>{item.position ?? 'Должность не указана'}</span>
              <span>{getEmployeeTypeLabel(item.employeeType)}</span>
            </span>
          }
          actions={
            <>
              {canAssign ? (
                <Button variant="primary" onClick={() => { setAssignOpen(true); changeSection('assignments'); }}>
                  Назначить на объект
                </Button>
              ) : null}
              {canEdit && !isEditing ? (
                <IconButton aria-label="Редактировать профиль" title="Редактировать профиль" bordered onClick={startEditing}>
                  <PencilIcon size={18} />
                </IconButton>
              ) : null}
              <OverflowMenu items={overflowItems} />
            </>
          }
        />

        {item.isArchived ? (
          <Alert tone="warning">Карточка в архиве: доступна для просмотра, новые назначения недоступны.</Alert>
        ) : null}
        {notice ? <Alert tone="success" role="status">{notice}</Alert> : null}

        <FactStrip
          items={[
            {
              key: 'phone',
              label: item.phones.length > 1 ? 'Телефоны' : 'Телефон',
              value: item.phone ? (
                <span>
                  {phoneHref ? <a href={phoneHref}>{formatPhone(item.phone)}</a> : item.phone}
                  {item.phones.length > 1 ? (
                    <span className={styles.muted} title={item.phones.slice(1).join(', ')}> · ещё {item.phones.length - 1}</span>
                  ) : null}
                </span>
              ) : <span className={styles.muted}>Не указан</span>,
            },
            {
              key: 'objects',
              label: 'Объекты',
              value: item.currentObjectAssignments.length
                ? item.currentObjectAssignments.map((assignment) => assignment.objectName).join(', ')
                : <span className={styles.muted}>Без объекта</span>,
            },
            {
              key: 'schedule',
              label: 'Рабочий режим',
              value: item.workScheduleCode || item.workTimeText
                ? [item.workScheduleCode ? getEmployeeScheduleLabel(item.workScheduleCode, item.workScheduleCustom) : null, item.workTimeText]
                  .filter(Boolean).join(' · ')
                : <span className={styles.muted}>Не указан</span>,
            },
            {
              key: 'documents',
              label: 'Документы',
              value: item.passportReceived && item.contractReceived ? 'Паспорт и договор получены'
                : !item.passportReceived && !item.contractReceived ? <span className={styles.muted}>Не получены</span>
                  : item.passportReceived ? 'Есть паспорт, нет договора' : 'Есть договор, нет паспорта',
            },
          ]}
        />
      </div>

      <WorkspaceTabs items={tabs} value={activeSection} onChange={changeSection} label="Разделы карточки сотрудника" />

      <section role="tabpanel" id="workspace-panel-overview" aria-labelledby="workspace-tab-overview" hidden={activeSection !== 'overview'}>
        {isEditing && editForm ? (
          <Surface className={styles.formSurface}>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (!phoneDraftsValid(editForm.phones)) return;
                setSavePending(true);
                setSaveError(null);
                setVersionConflict(false);
                try {
                  const updated = await updateEmployee(item.id, {
                    ...toEmployeeMutationPayload(editForm),
                    expectedVersion: item.version,
                  });
                  setItem(updated);
                  setEditForm(toEmployeeFormValue(updated));
                  setIsEditing(false);
                  setNotice('Изменения сохранены.');
                  window.setTimeout(() => setNotice(null), 4000);
                } catch (error) {
                  if (isVersionConflict(error)) {
                    setVersionConflict(true);
                    setSaveError('Пока вы редактировали, карточку изменил другой пользователь. Ваши правки сохранены в форме.');
                  } else {
                    setSaveError(errorMessage(error, 'Не удалось сохранить карточку.'));
                  }
                } finally {
                  setSavePending(false);
                }
              }}
            >
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>Редактирование профиля</h2>
              </div>
              {saveError ? (
                <Alert
                  tone="danger"
                  role="alert"
                  className={styles.formAlert}
                  action={versionConflict ? (
                    <Button size="sm" onClick={async () => {
                      await reload(item.id).catch(() => undefined);
                      setVersionConflict(false);
                      setSaveError('Данные обновлены. Проверьте поля и сохраните ещё раз.');
                    }}>Обновить данные</Button>
                  ) : undefined}
                >
                  {saveError}
                </Alert>
              ) : null}
              <EmployeeFormFields value={editForm} onChange={setEditForm} disabled={savePending} />
              <div className={styles.formActions}>
                <Button variant="ghost" disabled={savePending} onClick={() => {
                  setIsEditing(false);
                  setEditForm(toEmployeeFormValue(item));
                  setSaveError(null);
                }}>
                  Отмена
                </Button>
                <Button type="submit" variant="primary" pending={savePending} pendingLabel="Сохранение…" disabled={!isDirty}>
                  Сохранить
                </Button>
              </div>
            </form>
          </Surface>
        ) : (
          <EmployeeProfileSection item={item} />
        )}
      </section>

      <section role="tabpanel" id="workspace-panel-assignments" aria-labelledby="workspace-tab-assignments" hidden={activeSection !== 'assignments'}>
        <EmployeeAssignmentsSection item={item} onItemChange={setItem} assignOpen={assignOpen} onAssignOpenChange={setAssignOpen} />
      </section>

      <section role="tabpanel" id="workspace-panel-schedule" aria-labelledby="workspace-tab-schedule" hidden={activeSection !== 'schedule'}>
        {activeSection === 'schedule' ? <EmployeeScheduleSection item={item} onItemChange={setItem} /> : null}
      </section>

      <ConfirmDialog
        open={lifecycleDialog === 'archive'}
        onOpenChange={(open) => { if (!open) setLifecycleDialog(null); }}
        title="Перенести в архив?"
        consequence={`${item.fullName} исчезнет из рабочих списков. История, табель и подмены сохранятся, карточку можно восстановить.`}
        confirmLabel="Перенести в архив"
        pending={lifecyclePending}
        error={lifecycleError}
        onConfirm={() => void runLifecycle(async () => {
          setItem(await archiveEmployee(item.id, item.version));
        }, 'Не удалось перенести в архив.')}
      />

      <ConfirmDialog
        open={lifecycleDialog === 'restore'}
        onOpenChange={(open) => { if (!open) setLifecycleDialog(null); }}
        title="Восстановить из архива?"
        consequence={`${item.fullName} снова появится в рабочих списках. Назначения на объекты не восстанавливаются автоматически.`}
        confirmLabel="Восстановить"
        pending={lifecyclePending}
        error={lifecycleError}
        onConfirm={() => void runLifecycle(async () => {
          setItem(await restoreEmployee(item.id, item.version));
        }, 'Не удалось восстановить карточку.')}
      />

      <ReasonDialog
        open={lifecycleDialog === 'delete'}
        onOpenChange={(open) => { if (!open) setLifecycleDialog(null); }}
        title="Удалить карточку полностью?"
        description="Только для карточки, созданной по ошибке. Восстановить её через интерфейс будет нельзя."
        reasonLabel="Причина удаления"
        reason={deleteReason}
        onReasonChange={setDeleteReason}
        confirmLabel="Удалить полностью"
        pending={lifecyclePending}
        error={lifecycleError}
        onConfirm={(reason) => {
          if (reason.trim().length < 5) { setLifecycleError('Причина — не меньше 5 символов.'); return; }
          void runLifecycle(async () => {
            await deleteEmployeePermanently(item.id, { expectedVersion: item.version, reason: reason.trim() });
            router.replace('/employees?deleted=1');
          }, 'Не удалось удалить карточку.');
        }}
      />
    </div>
  );
}
