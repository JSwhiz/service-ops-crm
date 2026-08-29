'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  addEmployeeAvailability,
  addEmployeeSubstitution,
  archiveEmployee,
  assignEmployeeToObject,
  deleteEmployeeAssignmentAsError,
  deleteEmployeePermanently,
  getEmployeeById,
  listEmployeeObjectReferences,
  listEmployees,
  removeEmployeeFromObject,
  restoreEmployee,
  updateEmployee,
} from '@/entities/employee/api/employee-client';
import {
  formatEmployeeDate,
  formatEmployeeRate,
  getEmployeeAge,
  getEmployeeScheduleLabel,
  getEmployeeStatusLabel,
  getEmployeeTypeLabel,
} from '@/entities/employee/lib/employee-presentation';
import type {
  EmployeeDetail,
  EmployeeListItem,
  EmployeeObjectReference,
} from '@/entities/employee/model/employee.types';
import {
  EmployeeFormFields,
  type EmployeeFormValue,
} from '@/features/employee-form/employee-form-fields';
import { ApiError } from '@/shared/api/fetcher';
import { useAuth } from '@/shared/auth/use-auth';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';

function getAvailabilityStatusLabel(status: string): string {
  switch (status) {
    case 'available':
      return 'Доступен';
    case 'unavailable':
      return 'Недоступен';
    default:
      return status;
  }
}

function getSubstitutionStatusLabel(status: string): string {
  switch (status) {
    case 'planned':
      return 'Запланирована';
    case 'active':
      return 'Активна';
    case 'completed':
      return 'Завершена';
    case 'cancelled':
      return 'Отменена';
    default:
      return status;
  }
}

function formatAvailabilityPeriod(windowItem: {
  startDate: string;
  endDate: string | null;
  availabilityMode: string;
}): string {
  if (windowItem.availabilityMode === 'full_day') {
    return `${new Date(windowItem.startDate).toLocaleDateString('ru-RU')} — ${
      windowItem.endDate
        ? new Date(windowItem.endDate).toLocaleDateString('ru-RU')
        : 'без даты окончания'
    }`;
  }

  return `${new Date(windowItem.startDate).toLocaleString('ru-RU')} — ${
    windowItem.endDate
      ? new Date(windowItem.endDate).toLocaleString('ru-RU')
      : 'без даты окончания'
  }`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function getDependencyLabel(code: string): string {
  const labels: Record<string, string> = {
    object_assignments: 'назначения на объекты',
    assignment_history: 'история назначений',
    availability_windows: 'окна доступности',
    substitutions_primary: 'подмены основного сотрудника',
    substitutions_replacement: 'подмены заменяющего сотрудника',
    attendance_facts: 'записи посещаемости',
    timesheet_rows: 'строки табеля',
    timesheet_exceptions: 'исключения табеля',
  };
  return labels[code] ?? 'рабочая история';
}

function buildEditForm(employee: EmployeeDetail): EmployeeFormValue {
  return {
    fullName: employee.fullName,
    phone: employee.phone ?? '',
    position: employee.position ?? '',
    birthDate: employee.birthDate ?? '',
    residenceAddress: employee.residenceAddress ?? '',
    shiftPreferences: employee.shiftPreferences ?? '',
    baseDailyRate:
      typeof employee.baseDailyRate === 'number'
        ? String(employee.baseDailyRate)
        : '',
    employmentStatus: employee.employmentStatus,
    employeeType: employee.employeeType,
    workScheduleCode: employee.workScheduleCode ?? '',
    workScheduleCustom: employee.workScheduleCustom ?? '',
    workTimeText: employee.workTimeText ?? '',
    notes: employee.notes ?? '',
  };
}

export default function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const router = useRouter();
  const { user } = useAuth();
  const canAccessEmployeesHr = user?.capabilities?.canAccessEmployeesHr ?? false;

  const [employeeId, setEmployeeId] = useState('');
  const [item, setItem] = useState<EmployeeDetail | null>(null);
  const [objectCandidates, setObjectCandidates] = useState<EmployeeObjectReference[]>(
    [],
  );
  const [employeeCandidates, setEmployeeCandidates] = useState<EmployeeListItem[]>(
    [],
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [hasVersionConflict, setHasVersionConflict] = useState(false);
  const [isActionPending, setIsActionPending] = useState(false);

  const [editForm, setEditForm] = useState<EmployeeFormValue>({
    fullName: '',
    phone: '',
    position: '',
    birthDate: '',
    residenceAddress: '',
    shiftPreferences: '',
    baseDailyRate: '',
    employmentStatus: 'active',
    employeeType: 'regular',
    workScheduleCode: '',
    workScheduleCustom: '',
    workTimeText: '',
    notes: '',
  });
  const [assignmentDeleteTarget, setAssignmentDeleteTarget] = useState<{
    historyId: string;
    objectName: string;
    period: string;
  } | null>(null);
  const [assignmentDeleteReason, setAssignmentDeleteReason] = useState('');
  const [permanentDeleteOpen, setPermanentDeleteOpen] = useState(false);
  const [permanentDeleteReason, setPermanentDeleteReason] = useState('');
  const [assignmentObjectId, setAssignmentObjectId] = useState('');
  const [availabilityForm, setAvailabilityForm] = useState({
    availabilityMode: 'full_day',
    startDate: '',
    endDate: '',
    availabilityStatus: 'unavailable',
    comment: '',
  });
  const [substitutionForm, setSubstitutionForm] = useState({
    substituteEmployeeId: '',
    objectId: '',
    startDate: '',
    endDate: '',
    status: 'planned',
    reason: '',
    comment: '',
  });

  const load = async (id: string): Promise<void> => {
    const employee = await getEmployeeById(id);
    const needsObjectCandidates =
      employee.capabilities.canManageAssignments ||
      employee.capabilities.canManageSubstitutions;
    const needsEmployeeCandidates = employee.capabilities.canManageSubstitutions;

    const [objects, employees] = await Promise.all([
      needsObjectCandidates
        ? listEmployeeObjectReferences()
        : Promise.resolve<EmployeeObjectReference[]>([]),
      needsEmployeeCandidates
        ? listEmployees({
            employmentStatus: 'active',
            archiveState: 'active',
            limit: 100,
          }).then((response) => response.items)
        : Promise.resolve<EmployeeListItem[]>([]),
    ]);

    setItem(employee);
    setObjectCandidates(objects);
    setEmployeeCandidates(employees);
    setEditForm(buildEditForm(employee));
    setHasVersionConflict(false);
    setAssignmentObjectId('');
  };

  useEffect(() => {
    if (!canAccessEmployeesHr) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const bootstrap = async (): Promise<void> => {
      setIsLoading(true);
      setLoadError(null);

      try {
        const resolved = await params;
        if (cancelled) {
          return;
        }

        setEmployeeId(resolved.id);
        await load(resolved.id);
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            getErrorMessage(error, 'Не удалось загрузить карточку сотрудника.'),
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [canAccessEmployeesHr, params]);

  const availableObjectCandidates = useMemo(() => {
    const currentIds = new Set(
      item?.currentObjectAssignments.map((assignment) => assignment.objectId) ?? [],
    );

    return objectCandidates.filter((candidate) => !currentIds.has(candidate.id));
  }, [item?.currentObjectAssignments, objectCandidates]);

  const substitutionCandidates = useMemo(() => {
    return employeeCandidates.filter((candidate) => candidate.id !== employeeId);
  }, [employeeCandidates, employeeId]);

  const renderObjectReference = (params: {
    objectId: string;
    objectName: string;
    canOpenObjectCard: boolean;
  }): React.JSX.Element => {
    if (params.canOpenObjectCard) {
      return <Link href={`/objects/${params.objectId}`}>{params.objectName}</Link>;
    }

    return (
      <span
        style={{
          display: 'inline-flex',
          padding: '2px 8px',
          borderRadius: 999,
          background: '#f3f4f6',
        }}
        title="Карточка объекта недоступна в рамках текущей object visibility"
      >
        {params.objectName}
      </span>
    );
  };

  return (
    <>
      <PageTitle title={item ? item.fullName : 'Карточка сотрудника'} />

      {!canAccessEmployeesHr ? (
        <div className="page-card" style={{ color: '#b91c1c' }}>
          У вас нет доступа к HR-контуру сотрудников.
        </div>
      ) : isLoading ? (
        <div className="page-card">Загрузка...</div>
      ) : loadError ? (
        <div className="page-card" style={{ color: '#b91c1c' }}>
          {loadError}
        </div>
      ) : !item ? (
        <div className="page-card">Сотрудник не найден.</div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {actionError ? (
            <div className="page-card" style={{ color: '#b91c1c' }}>
              {actionError}
              {hasVersionConflict ? (
                <div className="action-row" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={async () => {
                      setActionError(null);
                      try {
                        await load(item.id);
                      } catch (error) {
                        setActionError(
                          getErrorMessage(error, 'Не удалось загрузить актуальную карточку.'),
                        );
                      }
                    }}
                  >
                    Загрузить актуальные данные
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => {
                      setEditForm(buildEditForm(item));
                      setHasVersionConflict(false);
                      setActionError(null);
                    }}
                  >
                    Отменить свои изменения
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="page-card employee-detail-summary">
            <div className="section-header">
              <div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{item.fullName}</div>
                <div className="action-row" style={{ marginTop: 8 }}>
                  <span
                    className={`employee-state-badge ${
                      item.isArchived ? 'is-archived' : 'is-active'
                    }`}
                  >
                    {item.isArchived ? 'Архивная карточка' : 'Активная карточка'}
                  </span>
                  <span className="employee-type-badge">{getEmployeeTypeLabel(item.employeeType)}</span>
                  <span className="page-muted">{getEmployeeStatusLabel(item.employmentStatus)}</span>
                </div>
              </div>

              <div className="action-row">
                {item.capabilities.canArchive ? (
                  <button
                    type="button"
                    className="button-danger"
                    disabled={isActionPending}
                    onClick={async () => {
                      if (!window.confirm('Перенести сотрудника в архив?')) return;

                      setActionError(null);
                      setIsActionPending(true);
                      try {
                        const archived = await archiveEmployee(item.id, item.version);
                        setItem(archived);
                        setEditForm(buildEditForm(archived));
                      } catch (error) {
                        if (
                          error instanceof ApiError &&
                          error.code === 'EMPLOYEE_HAS_ACTIVE_OBJECT_ASSIGNMENTS'
                        ) {
                          setActionError(
                            'Сначала завершите активные назначения сотрудника на объекты.',
                          );
                        } else if (
                          error instanceof ApiError &&
                          error.code === 'EMPLOYEE_VERSION_CONFLICT'
                        ) {
                          setHasVersionConflict(true);
                          setActionError(
                            'Карточка сотрудника была изменена другим пользователем.',
                          );
                        } else {
                          setActionError(
                            getErrorMessage(error, 'Не удалось архивировать сотрудника.'),
                          );
                        }
                      } finally {
                        setIsActionPending(false);
                      }
                    }}
                  >
                    Архивировать
                  </button>
                ) : null}
                {item.capabilities.canRestore ? (
                  <button
                    type="button"
                    disabled={isActionPending}
                    onClick={async () => {
                      setActionError(null);
                      setIsActionPending(true);
                      try {
                        const restored = await restoreEmployee(item.id, item.version);
                        setItem(restored);
                        setEditForm(buildEditForm(restored));
                      } catch (error) {
                        if (
                          error instanceof ApiError &&
                          error.code === 'EMPLOYEE_VERSION_CONFLICT'
                        ) {
                          setHasVersionConflict(true);
                          setActionError(
                            'Карточка сотрудника была изменена другим пользователем.',
                          );
                        } else {
                          setActionError(
                            getErrorMessage(error, 'Не удалось восстановить сотрудника.'),
                          );
                        }
                      } finally {
                        setIsActionPending(false);
                      }
                    }}
                  >
                    Восстановить
                  </button>
                ) : null}
                <Link href="/employees">
                  <button type="button" className="button-secondary">
                    К реестру
                  </button>
                </Link>
              </div>
            </div>

            {item.isArchived ? (
              <div className="inline-notice inline-notice--warning">
                Карточка находится в архиве и доступна только для просмотра истории.
              </div>
            ) : null}

            <div className="employee-detail-sections">
              <section><h3>Контактные данные</h3><dl>
                <div><dt>Телефон</dt><dd>{item.phone ?? '—'}</dd></div>
                <div><dt>Дата рождения</dt><dd>{formatEmployeeDate(item.birthDate)}{getEmployeeAge(item.birthDate) !== null ? ` · ${getEmployeeAge(item.birthDate)} лет` : ''}</dd></div>
                <div><dt>Адрес проживания</dt><dd>{item.residenceAddress ?? '—'}</dd></div>
              </dl></section>
              <section><h3>Работа</h3><dl>
                <div><dt>Должность</dt><dd>{item.position ?? '—'}</dd></div>
                <div><dt>Тип</dt><dd>{getEmployeeTypeLabel(item.employeeType)}</dd></div>
                <div><dt>Статус</dt><dd>{getEmployeeStatusLabel(item.employmentStatus)}</dd></div>
                <div><dt>Базовая ставка сотрудника за день</dt><dd>{formatEmployeeRate(item.baseDailyRate)}</dd></div>
              </dl></section>
              <section><h3>График</h3><dl>
                <div><dt>График работы</dt><dd>{getEmployeeScheduleLabel(item.workScheduleCode, item.workScheduleCustom)}</dd></div>
                <div><dt>Время работы</dt><dd>{item.workTimeText ?? '—'}</dd></div>
                <div><dt>Предпочтения по сменам</dt><dd>{item.shiftPreferences ?? '—'}</dd></div>
              </dl></section>
              <section><h3>Примечание</h3><div>{item.notes ?? '—'}</div></section>
            </div>
            <div className="employee-record-meta">Создана {new Date(item.createdAt).toLocaleString('ru-RU')} · изменена {new Date(item.updatedAt).toLocaleString('ru-RU')}</div>
          </div>

          {item.capabilities.canEdit ? (
            <form
              className="page-card employee-edit-form"
              onSubmit={async (event) => {
                event.preventDefault();
                setActionError(null);
                setHasVersionConflict(false);
                setIsActionPending(true);

                try {
                  const updated = await updateEmployee(item.id, {
                    expectedVersion: item.version,
                    fullName: editForm.fullName,
                    phone: editForm.phone.trim() || null,
                    position: editForm.position.trim() || null,
                    birthDate: editForm.birthDate || null,
                    residenceAddress: editForm.residenceAddress.trim() || null,
                    shiftPreferences: editForm.shiftPreferences.trim() || null,
                    baseDailyRate: editForm.baseDailyRate.trim()
                      ? Number(editForm.baseDailyRate)
                      : null,
                    employmentStatus: editForm.employmentStatus,
                    employeeType: editForm.employeeType,
                    workScheduleCode: editForm.workScheduleCode || null,
                    workScheduleCustom: editForm.workScheduleCustom.trim() || null,
                    workTimeText: editForm.workTimeText.trim() || null,
                    notes: editForm.notes.trim() || null,
                  });
                  setItem(updated);
                  setEditForm(buildEditForm(updated));
                } catch (error) {
                  if (
                    error instanceof ApiError &&
                    error.code === 'EMPLOYEE_VERSION_CONFLICT'
                  ) {
                    setHasVersionConflict(true);
                    setActionError(
                      'Карточка сотрудника была изменена другим пользователем.',
                    );
                  } else {
                    setActionError(
                      getErrorMessage(error, 'Не удалось обновить карточку сотрудника.'),
                    );
                  }
                } finally {
                  setIsActionPending(false);
                }
              }}
            >
              <div className="section-header">
                <div>
                  <div className="section-title">Редактирование карточки</div>
                  <div className="section-subtitle">Версия {item.version}</div>
                </div>
              </div>

              <EmployeeFormFields value={editForm} onChange={setEditForm} disabled={isActionPending} />

              <div className="action-row">
                <button type="submit" disabled={isActionPending}>
                  {isActionPending ? 'Сохранение...' : 'Сохранить карточку'}
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  disabled={isActionPending}
                  onClick={() => {
                    setEditForm(buildEditForm(item));
                    setHasVersionConflict(false);
                    setActionError(null);
                  }}
                >
                  Отменить изменения
                </button>
              </div>
            </form>
          ) : null}

          <div className="page-card employee-assignment-section">
            <div className="section-header"><div><div className="section-title">Текущие объекты</div>
              <div className="section-subtitle">Ставка объекта показана отдельно от базовой ставки сотрудника.</div></div></div>

            {item.currentObjectAssignments.length === 0 ? (
              <div className="page-muted">Активных назначений пока нет.</div>
            ) : (
              item.currentObjectAssignments.map((assignment) => (
                <div
                  key={assignment.objectId}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    alignItems: 'center',
                  }}
                >
                  <div>
                    {renderObjectReference({
                      objectId: assignment.objectId,
                      objectName: assignment.objectName,
                      canOpenObjectCard: assignment.canOpenObjectCard,
                    })}
                    <div className="page-muted">
                      С: {assignment.startDate ? new Date(assignment.startDate).toLocaleDateString('ru-RU') : '—'}
                    </div>
                    <div className="page-muted">Дневная ставка объекта: {formatEmployeeRate(assignment.objectDailyRate)}</div>
                  </div>

                  {item.capabilities.canManageAssignments ? (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const updated = await removeEmployeeFromObject(
                            item.id,
                            assignment.objectId,
                          );
                          setItem(updated);
                        } catch (error) {
                          setActionError(
                            getErrorMessage(
                              error,
                              'Не удалось снять сотрудника с объекта.',
                            ),
                          );
                        }
                      }}
                    >
                      Снять с объекта
                    </button>
                  ) : null}
                </div>
              ))
            )}

            {item.capabilities.canManageAssignments ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <div className="page-muted">Назначить на объект</div>
                <div className="employee-assignment-action">
                  <SearchableSelect
                    label="Объект"
                    value={assignmentObjectId}
                    options={availableObjectCandidates.map((candidate) => ({
                      value: candidate.id,
                      label: candidate.name,
                    }))}
                    placeholder="Выберите объект"
                    asyncSearch={async (query) => {
                      const currentIds = new Set(
                        item.currentObjectAssignments.map(
                          (assignment) => assignment.objectId,
                        ),
                      );
                      return (await listEmployeeObjectReferences(query))
                        .filter((object) => !currentIds.has(object.id))
                        .map((object) => ({
                          value: object.id,
                          label: object.name,
                        }));
                    }}
                    onChange={setAssignmentObjectId}
                  />
                  <button
                    type="button"
                    disabled={!assignmentObjectId}
                    onClick={async () => {
                      try {
                        const updated = await assignEmployeeToObject(item.id, {
                          objectId: assignmentObjectId,
                        });
                        setItem(updated);
                        setAssignmentObjectId('');
                      } catch (error) {
                        setActionError(
                          getErrorMessage(
                            error,
                            'Не удалось назначить сотрудника на объект.',
                          ),
                        );
                      }
                    }}
                  >
                    Назначить
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="page-card employee-assignment-section">
            <div className="section-header">
              <div>
                <div className="section-title">История назначений</div>
                <div className="section-subtitle">
                  Объекты, на которых сотрудник был закреплен.
                </div>
              </div>
            </div>
            {item.objectAssignmentHistory.length === 0 ? (
              <div className="page-muted">История назначений пока пуста.</div>
            ) : (
              <div className="record-list local-scroll local-scroll--sm">
                {item.objectAssignmentHistory.map((historyItem) => (
                  <div key={historyItem.id} className="record-card employee-history-row">
                    <div>
                      {renderObjectReference({
                        objectId: historyItem.objectId,
                        objectName: historyItem.objectName,
                        canOpenObjectCard: historyItem.canOpenObjectCard,
                      })}
                      <div className="page-muted">
                        {new Date(historyItem.startedAt).toLocaleDateString('ru-RU')} —{' '}
                        {historyItem.endedAt ? new Date(historyItem.endedAt).toLocaleDateString('ru-RU') : 'по настоящее время'}
                        {' · '}{historyItem.endedAt ? 'Завершено' : 'Активно'}
                      </div>
                      <div className="page-muted">Дневная ставка объекта: {formatEmployeeRate(historyItem.objectDailyRate)}</div>
                    </div>
                    {historyItem.canDeleteAsError ? (
                      <button type="button" className="button-danger" onClick={() => {
                        setAssignmentDeleteReason('');
                        setAssignmentDeleteTarget({
                          historyId: historyItem.id,
                          objectName: historyItem.objectName,
                          period: `${new Date(historyItem.startedAt).toLocaleDateString('ru-RU')} — ${historyItem.endedAt ? new Date(historyItem.endedAt).toLocaleDateString('ru-RU') : 'по настоящее время'}`,
                        });
                      }}>Удалить объект</button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="page-card" style={{ display: 'grid', gap: 12 }}>
            <div className="section-header">
              <div>
                <div className="section-title">Доступность</div>
                <div className="section-subtitle">
                  Периоды доступности сотрудника на весь день или по времени.
                </div>
              </div>
            </div>
            {item.availabilityWindows.length === 0 ? (
              <div className="page-muted">Окна доступности пока не заведены.</div>
            ) : (
              <div className="record-list local-scroll local-scroll--sm">
                {item.availabilityWindows.map((windowItem) => (
                  <div key={windowItem.id} className="record-card">
                    <div>
                      {getAvailabilityStatusLabel(windowItem.availabilityStatus)}{' '}
                      {windowItem.availabilityMode === 'full_day'
                        ? '(весь день)'
                        : '(по времени)'}
                    </div>
                    <div className="page-muted">
                      {formatAvailabilityPeriod(windowItem)}
                    </div>
                    {windowItem.comment ? (
                      <div className="page-muted">{windowItem.comment}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            {item.capabilities.canManageAvailability ? (
              <form
                style={{ display: 'grid', gap: 8 }}
                onSubmit={async (event) => {
                  event.preventDefault();
                  try {
                    const updated = await addEmployeeAvailability(item.id, {
                      startDate: availabilityForm.startDate,
                      endDate: availabilityForm.endDate || undefined,
                      availabilityMode: availabilityForm.availabilityMode,
                      availabilityStatus: availabilityForm.availabilityStatus,
                      comment: availabilityForm.comment || undefined,
                    });
                    setItem(updated);
                    setAvailabilityForm({
                      availabilityMode: 'full_day',
                      startDate: '',
                      endDate: '',
                      availabilityStatus: 'unavailable',
                      comment: '',
                    });
                  } catch (error) {
                    setActionError(
                      getErrorMessage(error, 'Не удалось добавить окно доступности.'),
                    );
                  }
                }}
              >
                <div className="page-muted">Добавить окно доступности</div>
                <select
                  value={availabilityForm.availabilityMode}
                  onChange={(event) =>
                    setAvailabilityForm((prev) => ({
                      ...prev,
                      availabilityMode: event.target.value,
                      startDate: '',
                      endDate: '',
                    }))
                  }
                >
                  <option value="full_day">Недоступен весь день</option>
                  <option value="timed">Недоступен по времени</option>
                </select>
                <input
                  type={
                    availabilityForm.availabilityMode === 'full_day'
                      ? 'date'
                      : 'datetime-local'
                  }
                  value={availabilityForm.startDate}
                  onChange={(event) =>
                    setAvailabilityForm((prev) => ({
                      ...prev,
                      startDate: event.target.value,
                    }))
                  }
                  required
                />
                <input
                  type={
                    availabilityForm.availabilityMode === 'full_day'
                      ? 'date'
                      : 'datetime-local'
                  }
                  value={availabilityForm.endDate}
                  onChange={(event) =>
                    setAvailabilityForm((prev) => ({
                      ...prev,
                      endDate: event.target.value,
                    }))
                  }
                />
                <select
                  value={availabilityForm.availabilityStatus}
                  onChange={(event) =>
                    setAvailabilityForm((prev) => ({
                      ...prev,
                      availabilityStatus: event.target.value,
                    }))
                  }
                >
                  <option value="available">Доступен</option>
                  <option value="unavailable">Недоступен</option>
                </select>
                <textarea
                  value={availabilityForm.comment}
                  onChange={(event) =>
                    setAvailabilityForm((prev) => ({
                      ...prev,
                      comment: event.target.value,
                    }))
                  }
                  style={{ minHeight: 80, padding: 10 }}
                  placeholder="Комментарий"
                />
                <button type="submit">Добавить доступность</button>
              </form>
            ) : null}
          </div>

          <div className="page-card" style={{ display: 'grid', gap: 12 }}>
            <div className="section-header">
              <div>
                <div className="section-title">Подмены</div>
                <div className="section-subtitle">
                  История подмен без изменения основного состава объекта.
                </div>
              </div>
            </div>
            {item.substitutions.length === 0 ? (
              <div className="page-muted">Подмены пока не заведены.</div>
            ) : (
              <div className="record-list local-scroll local-scroll--sm">
                {item.substitutions.map((substitution) => (
                  <div key={substitution.id} className="record-card">
                    <div>
                      {substitution.role === 'primary' ? 'Замещается сотрудником' : 'Замещает сотрудника'}{' '}
                      <strong>{substitution.counterpartEmployeeName}</strong>
                    </div>
                    <div className="page-muted">
                      {getSubstitutionStatusLabel(substitution.status)}.{' '}
                      {new Date(substitution.startDate).toLocaleDateString('ru-RU')} —{' '}
                      {substitution.endDate
                        ? new Date(substitution.endDate).toLocaleDateString('ru-RU')
                        : 'без даты окончания'}
                    </div>
                    <div className="page-muted">
                      {substitution.objectName
                        ? `Объект: ${substitution.objectName}. `
                        : ''}
                      Причина: {substitution.reason}
                    </div>
                    {substitution.comment ? (
                      <div className="page-muted">{substitution.comment}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            {item.capabilities.canManageSubstitutions ? (
              <form
                style={{ display: 'grid', gap: 8 }}
                onSubmit={async (event) => {
                  event.preventDefault();
                  try {
                    const updated = await addEmployeeSubstitution(item.id, {
                      substituteEmployeeId: substitutionForm.substituteEmployeeId,
                      objectId: substitutionForm.objectId || undefined,
                      startDate: substitutionForm.startDate,
                      endDate: substitutionForm.endDate || undefined,
                      status: substitutionForm.status,
                      reason: substitutionForm.reason,
                      comment: substitutionForm.comment || undefined,
                    });
                    setItem(updated);
                    setSubstitutionForm({
                      substituteEmployeeId: '',
                      objectId: '',
                      startDate: '',
                      endDate: '',
                      status: 'planned',
                      reason: '',
                      comment: '',
                    });
                  } catch (error) {
                    setActionError(
                      getErrorMessage(error, 'Не удалось зарегистрировать подмену.'),
                    );
                  }
                }}
              >
                <div className="page-muted">Зарегистрировать подмену</div>
                <select
                  value={substitutionForm.substituteEmployeeId}
                  onChange={(event) =>
                    setSubstitutionForm((prev) => ({
                      ...prev,
                      substituteEmployeeId: event.target.value,
                    }))
                  }
                  required
                >
                  <option value="">Выберите заменяющего сотрудника</option>
                  {substitutionCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.fullName}
                    </option>
                  ))}
                </select>
                <SearchableSelect
                  label="Объект подмены"
                  value={substitutionForm.objectId}
                  options={objectCandidates.map((candidate) => ({
                    value: candidate.id,
                    label: candidate.name,
                  }))}
                  placeholder="Без привязки к объекту"
                  asyncSearch={async (query) =>
                    (await listEmployeeObjectReferences(query)).map(
                      (object) => ({ value: object.id, label: object.name }),
                    )
                  }
                  onChange={(objectId) =>
                    setSubstitutionForm((prev) => ({ ...prev, objectId }))
                  }
                />
                <input
                  type="datetime-local"
                  value={substitutionForm.startDate}
                  onChange={(event) =>
                    setSubstitutionForm((prev) => ({
                      ...prev,
                      startDate: event.target.value,
                    }))
                  }
                  required
                />
                <input
                  type="datetime-local"
                  value={substitutionForm.endDate}
                  onChange={(event) =>
                    setSubstitutionForm((prev) => ({
                      ...prev,
                      endDate: event.target.value,
                    }))
                  }
                />
                <select
                  value={substitutionForm.status}
                  onChange={(event) =>
                    setSubstitutionForm((prev) => ({
                      ...prev,
                      status: event.target.value,
                    }))
                  }
                >
                  <option value="planned">Запланирована</option>
                  <option value="active">Активна</option>
                  <option value="completed">Завершена</option>
                  <option value="cancelled">Отменена</option>
                </select>
                <input
                  value={substitutionForm.reason}
                  onChange={(event) =>
                    setSubstitutionForm((prev) => ({
                      ...prev,
                      reason: event.target.value,
                    }))
                  }
                  placeholder="Причина подмены"
                  required
                />
                <textarea
                  value={substitutionForm.comment}
                  onChange={(event) =>
                    setSubstitutionForm((prev) => ({
                      ...prev,
                      comment: event.target.value,
                    }))
                  }
                  style={{ minHeight: 80, padding: 10 }}
                  placeholder="Комментарий"
                />
                <button type="submit">Создать подмену</button>
              </form>
            ) : null}
          </div>

          {item.capabilities.canDeletePermanently ? (
            <section className="page-card employee-danger-zone">
              <div>
                <div className="section-title">Опасная зона</div>
                <div className="section-subtitle">Только для карточек, созданных ошибочно. Сотрудника с рабочей историей удалить нельзя.</div>
              </div>
              {item.lifecycleEligibility.permanentDelete.blockers.length > 0 ? (
                <div className="inline-notice inline-notice--warning">
                  Полное удаление недоступно: {item.lifecycleEligibility.permanentDelete.blockers
                    .map((blocker) => `${getDependencyLabel(blocker.code)} (${blocker.count})`).join(', ')}.
                </div>
              ) : null}
              <button type="button" className="button-danger" disabled={!item.lifecycleEligibility.permanentDelete.eligible}
                onClick={() => { setPermanentDeleteReason(''); setPermanentDeleteOpen(true); }}>
                Удалить сотрудника полностью
              </button>
            </section>
          ) : null}

          {assignmentDeleteTarget ? (
            <div className="employee-modal" role="dialog" aria-modal="true" aria-labelledby="assignment-delete-title">
              <button type="button" className="employee-modal__backdrop" aria-label="Закрыть" onClick={() => setAssignmentDeleteTarget(null)} />
              <form className="page-card employee-modal__panel" onSubmit={async (event) => {
                event.preventDefault();
                setIsActionPending(true);
                setActionError(null);
                try {
                  const updated = await deleteEmployeeAssignmentAsError(item.id, assignmentDeleteTarget.historyId, assignmentDeleteReason.trim());
                  setItem(updated);
                  setAssignmentDeleteTarget(null);
                } catch (error) {
                  if (error instanceof ApiError && error.code === 'ASSIGNMENT_HAS_OPERATIONAL_HISTORY') {
                    setActionError('Удалить назначение нельзя: оно уже использовалось в учёте. Завершите назначение вместо удаления.');
                  } else {
                    setActionError(getErrorMessage(error, 'Не удалось удалить ошибочное назначение.'));
                  }
                } finally {
                  setIsActionPending(false);
                }
              }}>
                <div><div className="section-title" id="assignment-delete-title">Удалить назначение на объект?</div>
                  <div className="section-subtitle">{item.fullName} · {assignmentDeleteTarget.objectName} · {assignmentDeleteTarget.period}</div></div>
                <div className="inline-notice inline-notice--warning">Удаляется только запись назначения сотрудника. Сам объект останется в системе. Используйте действие только для ошибочно заведённой записи.</div>
                <label><span className="detail-label">Причина удаления *</span><textarea required minLength={5} maxLength={500}
                  value={assignmentDeleteReason} onChange={(event) => setAssignmentDeleteReason(event.target.value)} /></label>
                <div className="action-row"><button type="submit" className="button-danger" disabled={isActionPending || assignmentDeleteReason.trim().length < 5}>Удалить запись</button>
                  <button type="button" className="button-secondary" disabled={isActionPending} onClick={() => setAssignmentDeleteTarget(null)}>Отмена</button></div>
              </form>
            </div>
          ) : null}

          {permanentDeleteOpen ? (
            <div className="employee-modal" role="dialog" aria-modal="true" aria-labelledby="employee-delete-title">
              <button type="button" className="employee-modal__backdrop" aria-label="Закрыть" onClick={() => setPermanentDeleteOpen(false)} />
              <form className="page-card employee-modal__panel" onSubmit={async (event) => {
                event.preventDefault();
                setIsActionPending(true);
                setActionError(null);
                try {
                  await deleteEmployeePermanently(item.id, { expectedVersion: item.version, reason: permanentDeleteReason.trim() });
                  router.replace('/employees?deleted=1');
                } catch (error) {
                  if (error instanceof ApiError && error.code === 'EMPLOYEE_VERSION_CONFLICT') {
                    setHasVersionConflict(true);
                    setActionError('Карточка сотрудника была изменена другим пользователем.');
                  } else {
                    setActionError(getErrorMessage(error, 'Не удалось полностью удалить карточку сотрудника.'));
                  }
                  setPermanentDeleteOpen(false);
                } finally {
                  setIsActionPending(false);
                }
              }}>
                <div><div className="section-title" id="employee-delete-title">Полностью удалить карточку сотрудника?</div>
                  <div className="section-subtitle">{item.fullName}</div></div>
                <div className="inline-notice inline-notice--warning">Действие предназначено только для ошибочно заведённой карточки. После удаления восстановить её через интерфейс невозможно.</div>
                <label><span className="detail-label">Причина удаления *</span><textarea required minLength={5} maxLength={500}
                  value={permanentDeleteReason} onChange={(event) => setPermanentDeleteReason(event.target.value)} /></label>
                <div className="action-row"><button type="submit" className="button-danger" disabled={isActionPending || permanentDeleteReason.trim().length < 5}>Удалить полностью</button>
                  <button type="button" className="button-secondary" disabled={isActionPending} onClick={() => setPermanentDeleteOpen(false)}>Отмена</button></div>
              </form>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
