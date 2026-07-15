'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';

import { listObjects } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { listOneTimeOrders } from '@/entities/one-time-order/api/one-time-order-client';
import type { OneTimeOrderListItem } from '@/entities/one-time-order/model/one-time-order.types';
import { createTask } from '@/entities/task/api/task-client';
import { listSystemUsers } from '@/entities/user/api/user-client';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import { TaskForm } from '@/features/task-form/ui/task-form';
import { PageTitle } from '@/shared/ui/page-title/page-title';

export default function NewTaskPage(): React.JSX.Element {
  const router = useRouter();
  const [objects, setObjects] = useState<ServiceObject[]>([]);
  const [orders, setOrders] = useState<OneTimeOrderListItem[]>([]);
  const [users, setUsers] = useState<SystemUserOption[]>([]);
  const [visibilityUsers, setVisibilityUsers] = useState<SystemUserOption[]>([]);
  const [targets, setTargets] = useState({ objectId: '', oneTimeOrderId: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      listObjects(),
      listOneTimeOrders({ limit: 100, sortBy: 'title', sortDirection: 'asc' }),
    ])
      .then(([nextObjects, nextOrders]) => {
        setObjects(nextObjects);
        setOrders(nextOrders.items);
      })
      .catch(() => setError('Не удалось загрузить доступные объекты и заказы.'))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const targetParams = {
      ...(targets.objectId ? { objectId: targets.objectId } : {}),
      ...(targets.oneTimeOrderId ? { oneTimeOrderId: targets.oneTimeOrderId } : {}),
    };

    void Promise.all([
      listSystemUsers({ purpose: 'task_assignee', ...targetParams }),
      listSystemUsers({ purpose: 'task_visibility', ...targetParams }),
    ])
      .then(([nextUsers, nextVisibilityUsers]) => {
        if (!cancelled) {
          setUsers(nextUsers);
          setVisibilityUsers(nextVisibilityUsers);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить доступных пользователей.');
      });

    return () => { cancelled = true; };
  }, [targets]);

  return (
    <div className="page-stack">
      <PageTitle title="Создать задачу" />
      {isLoading ? <div className="page-card">Загрузка…</div> : error ? (
        <div className="page-card task-error" role="alert">{error}</div>
      ) : (
        <div className="page-card">
          <TaskForm
            objects={objects}
            orders={orders}
            users={users}
            visibilityUsers={visibilityUsers}
            onTargetsChange={(objectId, oneTimeOrderId) => {
              setError(null);
              setTargets({ objectId, oneTimeOrderId });
            }}
            onSubmit={async (payload) => {
              const created = await createTask(payload);
              router.push(`/tasks/${created.id}`);
            }}
          />
        </div>
      )}
    </div>
  );
}
