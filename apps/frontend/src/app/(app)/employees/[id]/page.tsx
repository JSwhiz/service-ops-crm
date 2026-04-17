'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import {
  addEmployeeAvailability,
  addEmployeeSubstitution,
  assignEmployeeToObject,
  changeEmployeeStatus,
  getEmployeeById,
  listEmployeeObjectCandidates,
  listEmployees,
  removeEmployeeFromObject,
  updateEmployee,
} from '@/entities/employee/api/employee-client';
import type {
  EmployeeDetail,
  EmployeeListItem,
  EmployeeObjectOption,
} from '@/entities/employee/model/employee.types';
import { useAuth } from '@/shared/auth/use-auth';
import { PageTitle } from '@/shared/ui/page-title/page-title';

function getEmploymentStatusLabel(status: string): string {
  switch (status) {
    case 'active':
      return 'Активен';
    case 'inactive':
      return 'Неактивен';
    default:
      return status;
  }
}

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

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

export default function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const { user } = useAuth();
  const canAccessEmployeesHr = user?.capabilities?.canAccessEmployeesHr ?? false;

  const [employeeId, setEmployeeId] = useState('');
  const [item, setItem] = useState<EmployeeDetail | null>(null);
  const [objectCandidates, setObjectCandidates] = useState<EmployeeObjectOption[]>(
    [],
  );
  const [employeeCandidates, setEmployeeCandidates] = useState<EmployeeListItem[]>(
    [],
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  const [editForm, setEditForm] = useState({
    fullName: '',
    phone: '',
    residenceAddress: '',
    shiftPreferences: '',
    baseDailyRate: '',
    notes: '',
  });
  const [assignmentObjectId, setAssignmentObjectId] = useState('');
  const [availabilityForm, setAvailabilityForm] = useState({
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
    const [employee, objects, employees] = await Promise.all([
      getEmployeeById(id),
      listEmployeeObjectCandidates(),
      listEmployees({
        employmentStatus: 'active',
      }),
    ]);

    setItem(employee);
    setObjectCandidates(objects);
    setEmployeeCandidates(employees);
    setEditForm({
      fullName: employee.fullName,
      phone: employee.phone ?? '',
      residenceAddress: employee.residenceAddress ?? '',
      shiftPreferences: employee.shiftPreferences ?? '',
      baseDailyRate:
        typeof employee.baseDailyRate === 'number'
          ? String(employee.baseDailyRate)
          : '',
      notes: employee.notes ?? '',
    });
    setAssignmentObjectId(objects[0]?.id ?? '');
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
            getErrorMessage(error, 'Не удалось загрузить employee-карточку.'),
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
            </div>
          ) : null}

          <div className="page-card" style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{item.fullName}</div>
                <div className="page-muted">
                  Статус: {getEmploymentStatusLabel(item.employmentStatus)}
                </div>
              </div>

              <Link href="/employees">
                <button type="button">К реестру</button>
              </Link>
            </div>

            <div
              style={{
                display: 'grid',
                gap: 12,
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              }}
            >
              <div>
                <div className="page-muted">Телефон</div>
                <div>{item.phone ?? '—'}</div>
              </div>
              <div>
                <div className="page-muted">Место проживания</div>
                <div>{item.residenceAddress ?? '—'}</div>
              </div>
              <div>
                <div className="page-muted">Базовая ставка</div>
                <div>{item.baseDailyRate ?? '—'}</div>
              </div>
            </div>

            <div>
              <div className="page-muted">Пожелания по выходам</div>
              <div>{item.shiftPreferences ?? '—'}</div>
            </div>

            <div>
              <div className="page-muted">Комментарий</div>
              <div>{item.notes ?? '—'}</div>
            </div>
          </div>

          {item.capabilities.canEdit ? (
            <form
              className="page-card"
              style={{ display: 'grid', gap: 12 }}
              onSubmit={async (event) => {
                event.preventDefault();
                setActionError(null);

                try {
                  const updated = await updateEmployee(item.id, {
                    fullName: editForm.fullName,
                    phone: editForm.phone,
                    residenceAddress: editForm.residenceAddress,
                    shiftPreferences: editForm.shiftPreferences,
                    baseDailyRate: editForm.baseDailyRate.trim()
                      ? Number(editForm.baseDailyRate)
                      : undefined,
                    notes: editForm.notes,
                  });
                  setItem(updated);
                } catch (error) {
                  setActionError(
                    getErrorMessage(error, 'Не удалось обновить employee-карточку.'),
                  );
                }
              }}
            >
              <div style={{ fontWeight: 600 }}>Редактирование employee-карточки</div>

              <input
                value={editForm.fullName}
                onChange={(event) =>
                  setEditForm((prev) => ({ ...prev, fullName: event.target.value }))
                }
                style={{ padding: 10 }}
                required
              />
              <input
                value={editForm.phone}
                onChange={(event) =>
                  setEditForm((prev) => ({ ...prev, phone: event.target.value }))
                }
                style={{ padding: 10 }}
                placeholder="Телефон"
              />
              <input
                value={editForm.residenceAddress}
                onChange={(event) =>
                  setEditForm((prev) => ({
                    ...prev,
                    residenceAddress: event.target.value,
                  }))
                }
                style={{ padding: 10 }}
                placeholder="Место проживания"
              />
              <textarea
                value={editForm.shiftPreferences}
                onChange={(event) =>
                  setEditForm((prev) => ({
                    ...prev,
                    shiftPreferences: event.target.value,
                  }))
                }
                style={{ minHeight: 90, padding: 10 }}
                placeholder="Пожелания по выходам"
              />
              <input
                type="number"
                min="0"
                step="1"
                value={editForm.baseDailyRate}
                onChange={(event) =>
                  setEditForm((prev) => ({
                    ...prev,
                    baseDailyRate: event.target.value,
                  }))
                }
                style={{ padding: 10 }}
                placeholder="Базовая ставка"
              />
              <textarea
                value={editForm.notes}
                onChange={(event) =>
                  setEditForm((prev) => ({ ...prev, notes: event.target.value }))
                }
                style={{ minHeight: 90, padding: 10 }}
                placeholder="Комментарий"
              />

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button type="submit">Сохранить карточку</button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const nextStatus =
                        item.employmentStatus === 'active' ? 'inactive' : 'active';
                      const updated = await changeEmployeeStatus(
                        item.id,
                        nextStatus,
                      );
                      setItem(updated);
                    } catch (error) {
                      setActionError(
                        getErrorMessage(error, 'Не удалось сменить статус сотрудника.'),
                      );
                    }
                  }}
                >
                  {item.employmentStatus === 'active'
                    ? 'Деактивировать'
                    : 'Активировать'}
                </button>
              </div>
            </form>
          ) : null}

          <div className="page-card" style={{ display: 'grid', gap: 12 }}>
            <div style={{ fontWeight: 600 }}>Текущие объекты</div>

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
                    <Link href={`/objects/${assignment.objectId}`}>
                      {assignment.objectName}
                    </Link>
                    <div className="page-muted">
                      С: {assignment.startDate ? new Date(assignment.startDate).toLocaleDateString('ru-RU') : '—'}
                    </div>
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
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <select
                    value={assignmentObjectId}
                    onChange={(event) => setAssignmentObjectId(event.target.value)}
                    style={{ padding: 10, minWidth: 260 }}
                  >
                    {availableObjectCandidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name} ({candidate.status})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!assignmentObjectId}
                    onClick={async () => {
                      try {
                        const updated = await assignEmployeeToObject(item.id, {
                          objectId: assignmentObjectId,
                        });
                        setItem(updated);
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

          <div className="page-card" style={{ display: 'grid', gap: 12 }}>
            <div style={{ fontWeight: 600 }}>История назначений</div>
            {item.objectAssignmentHistory.length === 0 ? (
              <div className="page-muted">История назначений пока пуста.</div>
            ) : (
              item.objectAssignmentHistory.map((historyItem) => (
                <div key={historyItem.id}>
                  <Link href={`/objects/${historyItem.objectId}`}>
                    {historyItem.objectName}
                  </Link>
                  <div className="page-muted">
                    {new Date(historyItem.startedAt).toLocaleDateString('ru-RU')} —{' '}
                    {historyItem.endedAt
                      ? new Date(historyItem.endedAt).toLocaleDateString('ru-RU')
                      : 'по настоящее время'}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="page-card" style={{ display: 'grid', gap: 12 }}>
            <div style={{ fontWeight: 600 }}>Доступность</div>
            {item.availabilityWindows.length === 0 ? (
              <div className="page-muted">Окна доступности пока не заведены.</div>
            ) : (
              item.availabilityWindows.map((windowItem) => (
                <div key={windowItem.id}>
                  <div>{getAvailabilityStatusLabel(windowItem.availabilityStatus)}</div>
                  <div className="page-muted">
                    {new Date(windowItem.startDate).toLocaleDateString('ru-RU')} —{' '}
                    {windowItem.endDate
                      ? new Date(windowItem.endDate).toLocaleDateString('ru-RU')
                      : 'без даты окончания'}
                  </div>
                  {windowItem.comment ? (
                    <div className="page-muted">{windowItem.comment}</div>
                  ) : null}
                </div>
              ))
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
                      availabilityStatus: availabilityForm.availabilityStatus,
                      comment: availabilityForm.comment || undefined,
                    });
                    setItem(updated);
                    setAvailabilityForm({
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
                <input
                  type="datetime-local"
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
                  type="datetime-local"
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
            <div style={{ fontWeight: 600 }}>Подмены</div>
            {item.substitutions.length === 0 ? (
              <div className="page-muted">Подмены пока не заведены.</div>
            ) : (
              item.substitutions.map((substitution) => (
                <div key={substitution.id}>
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
              ))
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
                <select
                  value={substitutionForm.objectId}
                  onChange={(event) =>
                    setSubstitutionForm((prev) => ({
                      ...prev,
                      objectId: event.target.value,
                    }))
                  }
                >
                  <option value="">Без привязки к объекту</option>
                  {objectCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
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
        </div>
      )}
    </>
  );
}
