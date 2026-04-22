'use client';

import React from 'react';

import type { ObjectEmployeeOption } from '@/entities/object/model/object.types';

interface ObjectStaffingPanelProps {
  assignedEmployees: ObjectEmployeeOption[];
  directoryEmployees: ObjectEmployeeOption[];
  search: string;
  isSearching: boolean;
  searchError: string | null;
  onSearchChange: (value: string) => void;
  onAdd: (employeeId: string) => Promise<void>;
  onRemove: (employeeId: string) => Promise<void>;
}

export function ObjectStaffingPanel({
  assignedEmployees,
  directoryEmployees,
  search,
  isSearching,
  searchError,
  onSearchChange,
  onAdd,
  onRemove,
}: ObjectStaffingPanelProps): React.JSX.Element {
  const assigned = assignedEmployees ?? [];
  const directory = directoryEmployees ?? [];
  const assignedIds = new Set(assigned.map((employee) => employee.id));
  const visibleSubstitutions = Array.from(
    assigned.reduce<
      Map<
        string,
        ObjectEmployeeOption['activeSubstitutions'][number] & {
          primaryEmployeeName: string;
        }
      >
    >((accumulator, employee) => {
      for (const substitution of employee.activeSubstitutions.filter(
        (item) => item.role === 'primary',
      )) {
        accumulator.set(substitution.id, {
          ...substitution,
          primaryEmployeeName: employee.fullName,
        });
      }

      return accumulator;
    }, new Map()).values(),
  );

  const getAvailabilityExplanation = (employee: ObjectEmployeeOption): string | null => {
    if (!employee.availability.isUnavailable) {
      return null;
    }

    const modeLabel =
      employee.availability.availabilityMode === 'full_day'
        ? 'Недоступен весь день'
        : 'Недоступен по времени';
    const periodLabel =
      employee.availability.startDate && employee.availability.endDate
        ? `${new Date(employee.availability.startDate).toLocaleString('ru-RU')} — ${new Date(employee.availability.endDate).toLocaleString('ru-RU')}`
        : employee.availability.startDate
          ? `с ${new Date(employee.availability.startDate).toLocaleString('ru-RU')}`
          : 'период не указан';

    return employee.availability.comment
      ? `${modeLabel}. ${periodLabel}. Причина: ${employee.availability.comment}`
      : `${modeLabel}. ${periodLabel}.`;
  };

  return (
    <div className="page-card">
      <div className="section-header" style={{ marginBottom: 14 }}>
        <div>
          <div className="section-title">Состав сотрудников объекта</div>
          <div className="section-subtitle">
            Staffing отдельно от attendance и табеля.
          </div>
        </div>
      </div>

      <label style={{ display: 'block', marginBottom: 16 }}>
        <div style={{ marginBottom: 6 }}>Поиск сотрудника</div>
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Введите ФИО сотрудника"
          style={{ width: '100%', padding: 10 }}
        />
      </label>

      <div style={{ fontWeight: 600, marginBottom: 8 }}>Текущий состав</div>

      {assigned.length === 0 ? (
        <div className="page-muted" style={{ marginBottom: 16 }}>
          Сотрудники пока не добавлены.
        </div>
      ) : (
        <div className="record-list" style={{ marginBottom: 16 }}>
          {assigned.map((employee) => (
            <div
              key={employee.id}
              className="record-card"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                border: employee.availability.isUnavailable
                  ? '1px solid #f59e0b'
                  : undefined,
                background: employee.availability.isUnavailable
                  ? '#fffbeb'
                  : undefined,
              }}
              title={getAvailabilityExplanation(employee) ?? undefined}
            >
              <div style={{ display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span>{employee.fullName}</span>
                  {employee.availability.isUnavailable ? (
                    <span className="status-pill" data-status="under_repair">
                      Недоступен
                    </span>
                  ) : null}
                  {employee.activeSubstitutions
                    .filter((item) => item.role === 'primary')
                    .map((item) => (
                      <span key={item.id} className="page-muted">
                        Замещается: {item.counterpartEmployeeName}
                      </span>
                    ))}
                  {employee.activeSubstitutions
                    .filter((item) => item.role === 'replacement')
                    .map((item) => (
                      <span key={item.id} className="page-muted">
                        Замещает: {item.counterpartEmployeeName}
                      </span>
                    ))}
                </div>
                {employee.availability.isUnavailable ? (
                  <div style={{ color: '#b45309', fontSize: 13 }}>
                    {getAvailabilityExplanation(employee)}
                  </div>
                ) : null}
              </div>

              <button type="button" onClick={() => void onRemove(employee.id)}>
                Убрать
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontWeight: 600, marginBottom: 8 }}>Подмены на сегодня</div>

      {visibleSubstitutions.length === 0 ? (
        <div className="page-muted" style={{ marginBottom: 16 }}>
          Активных подмен на сегодня нет.
        </div>
      ) : (
        <div className="record-list" style={{ marginBottom: 16 }}>
          {visibleSubstitutions.map((substitution) => (
            <div
              key={substitution.id}
              className="record-card"
            >
              <div>
                <strong>{substitution.primaryEmployeeName}</strong> замещается{' '}
                <strong>{substitution.counterpartEmployeeName}</strong>
              </div>
              <div className="page-muted">
                {new Date(substitution.startDate).toLocaleString('ru-RU')} —{' '}
                {substitution.endDate
                  ? new Date(substitution.endDate).toLocaleString('ru-RU')
                  : 'без даты окончания'}
              </div>
              <div className="page-muted">
                Статус: {substitution.status}. Причина: {substitution.reason}
              </div>
              {substitution.comment ? (
                <div className="page-muted">{substitution.comment}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <div style={{ fontWeight: 600, marginBottom: 8 }}>Результаты поиска</div>

      {searchError ? (
        <div style={{ color: '#b91c1c', marginBottom: 12 }}>{searchError}</div>
      ) : null}

      {isSearching ? (
        <div className="page-muted">Поиск...</div>
      ) : directory.length === 0 ? (
        <div className="page-muted">Подходящих сотрудников не найдено.</div>
      ) : (
        <div className="record-list">
          {directory.map((employee) => (
            <div
              key={employee.id}
              className="record-card"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                border: employee.availability.isUnavailable
                  ? '1px solid #f59e0b'
                  : undefined,
                background: employee.availability.isUnavailable
                  ? '#fffbeb'
                  : undefined,
              }}
              title={getAvailabilityExplanation(employee) ?? undefined}
            >
              <div style={{ display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span>{employee.fullName}</span>
                  {employee.availability.isUnavailable ? (
                    <span className="status-pill" data-status="under_repair">
                      Недоступен
                    </span>
                  ) : null}
                </div>
                {employee.availability.isUnavailable ? (
                  <div style={{ color: '#b45309', fontSize: 13 }}>
                    {getAvailabilityExplanation(employee)}
                  </div>
                ) : null}
              </div>

              {assignedIds.has(employee.id) ? (
                <span className="page-muted">Уже в составе</span>
              ) : (
                <button type="button" onClick={() => void onAdd(employee.id)}>
                  Добавить
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
