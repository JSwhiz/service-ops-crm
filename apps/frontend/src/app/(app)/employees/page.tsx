'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

import { listEmployees } from '@/entities/employee/api/employee-client';
import type { EmployeeListItem } from '@/entities/employee/model/employee.types';
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

export default function EmployeesPage(): React.JSX.Element {
  const { user } = useAuth();
  const canAccessEmployeesHr = user?.capabilities?.canAccessEmployeesHr ?? false;
  const canManageEmployeesHr = user?.capabilities?.canManageEmployeesHr ?? false;

  const [items, setItems] = useState<EmployeeListItem[]>([]);
  const [search, setSearch] = useState('');
  const [employmentStatus, setEmploymentStatus] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canAccessEmployeesHr) {
      setItems([]);
      setIsLoading(false);
      return;
    }

    const load = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await listEmployees({
          search: search || undefined,
          employmentStatus: employmentStatus || undefined,
        });
        setItems(response);
      } catch (caughtError) {
        if (caughtError instanceof Error && caughtError.message) {
          setError(caughtError.message);
        } else {
          setError('Не удалось загрузить реестр сотрудников.');
        }
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [canAccessEmployeesHr, search, employmentStatus]);

  return (
    <>
      <PageTitle title="Сотрудники" />

      {!canAccessEmployeesHr ? (
        <div className="page-card" style={{ color: '#b91c1c' }}>
          У вас нет доступа к HR-контуру сотрудников.
        </div>
      ) : (
        <>
          <div
            className="page-card"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              alignItems: 'center',
              marginBottom: 16,
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>Реестр сотрудников</div>
              <div className="page-muted" style={{ marginTop: 4 }}>
                Shared HR-домен для staffing, attendance и табеля
              </div>
            </div>

            {canManageEmployeesHr ? (
              <Link href="/employees/new">
                <button type="button">Создать сотрудника</button>
              </Link>
            ) : null}
          </div>

          <div
            className="page-card"
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              marginBottom: 16,
            }}
          >
            <label>
              <div style={{ marginBottom: 6 }}>Поиск</div>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ФИО сотрудника"
                style={{ width: '100%', padding: 10 }}
              />
            </label>

            <label>
              <div style={{ marginBottom: 6 }}>Статус занятости</div>
              <select
                value={employmentStatus}
                onChange={(event) => setEmploymentStatus(event.target.value)}
                style={{ width: '100%', padding: 10 }}
              >
                <option value="">Все</option>
                <option value="active">Активен</option>
                <option value="inactive">Неактивен</option>
              </select>
            </label>
          </div>

          {isLoading ? (
            <div className="page-card">Загрузка...</div>
          ) : error ? (
            <div className="page-card" style={{ color: '#b91c1c' }}>
              {error}
            </div>
          ) : items.length === 0 ? (
            <div className="page-card">Сотрудники не найдены.</div>
          ) : (
            <div className="page-card" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th align="left">ФИО</th>
                    <th align="left">Телефон</th>
                    <th align="left">Статус</th>
                    <th align="left">Базовая ставка</th>
                    <th align="left">Текущие объекты</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td style={{ paddingTop: 10 }}>
                        <Link href={`/employees/${item.id}`}>{item.fullName}</Link>
                      </td>
                      <td>{item.phone ?? '—'}</td>
                      <td>{getEmploymentStatusLabel(item.employmentStatus)}</td>
                      <td>{item.baseDailyRate ?? '—'}</td>
                      <td>{item.currentObjectCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
