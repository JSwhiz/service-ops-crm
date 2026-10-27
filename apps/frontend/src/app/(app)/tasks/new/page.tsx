'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';

import { listObjects } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { listOneTimeOrders } from '@/entities/one-time-order/api/one-time-order-client';
import type { OneTimeOrderListItem } from '@/entities/one-time-order/model/one-time-order.types';
import { createTask } from '@/entities/task/api/task-client';
import { uploadFileBatch } from '@/entities/file/api/file-client';
import { listSystemUsers } from '@/entities/user/api/user-client';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import { TaskForm } from '@/features/task-form/ui/task-form';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import { Alert, ButtonLink, Surface } from '@/shared/ui/foundation';
import taskStyles from '@/entities/task/ui/task-ui.module.css';

export default function NewTaskPage(): React.JSX.Element {
  const router = useRouter();
  const createdTaskId = useRef<string | null>(null);
  const createdPayload = useRef<string | null>(null);
  const [savedTaskId, setSavedTaskId] = useState<string | null>(null);
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
    <div className={`ui-page ${taskStyles.taskDetailPage}`}>
      <PageTitle title="Создать задачу" />
      {isLoading ? <Surface padding="md">Загрузка…</Surface> : error ? (
        <Surface padding="md" className={taskStyles.taskError} role="alert">{error}</Surface>
      ) : (
        <Surface padding="md">
          {savedTaskId ? <Alert tone="info">Задача уже создана. Повторное сохранение повторит только вложения. Поля и состав исполнителей изменяйте в карточке. <ButtonLink href={`/tasks/${savedTaskId}`}>Открыть созданную задачу</ButtonLink></Alert> : null}
          <TaskForm
            objects={objects}
            orders={orders}
            users={users}
            visibilityUsers={visibilityUsers}
            onTargetsChange={(objectId, oneTimeOrderId) => {
              setError(null);
              setTargets({ objectId, oneTimeOrderId });
            }}
            onSubmit={async (payload, files) => {
              if (!createdTaskId.current) {
                createdTaskId.current = (await createTask(payload)).id;
                createdPayload.current = JSON.stringify(payload);
                setSavedTaskId(createdTaskId.current);
              } else if (createdPayload.current !== JSON.stringify(payload)) {
                throw new Error('Задача уже создана. Изменённые поля не сохранены: откройте созданную карточку для редактирования. Для повтора вложений верните исходные значения формы.');
              }
              const id = createdTaskId.current;
              const uploads = await uploadFileBatch({ entityType: 'task', entityId: id, files });
              if (uploads.some((result) => result.status === 'rejected')) throw new Error('Задача создана, но не все вложения загрузились. Повторите сохранение: задача и загруженные файлы не продублируются.');
              router.push(`/tasks/${id}`);
            }}
          />
        </Surface>
      )}
    </div>
  );
}
