'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { listObjects } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { createTask } from '@/entities/task/api/task-client';
import { listSystemUsers } from '@/entities/user/api/user-client';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import { TaskForm } from '@/features/task-form/ui/task-form';
import { PageTitle } from '@/shared/ui/page-title/page-title';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

export default function NewTaskPage(): React.JSX.Element {
  const router = useRouter();

  const [objects, setObjects] = useState<ServiceObject[]>([]);
  const [users, setUsers] = useState<SystemUserOption[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);

  useEffect(() => {
    const load = async (): Promise<void> => {
      setIsLoading(true);
      setLoadError(null);

      try {
        const objectResponse = await listObjects();
        const creatableObjects = objectResponse.filter(
          (object) => object.capabilities.canCreateTask,
        );

        setObjects(creatableObjects);
        setSelectedObjectId(creatableObjects[0]?.id ?? '');
      } catch (error) {
        setLoadError(
          getErrorMessage(
            error,
            'Не удалось загрузить данные для создания задачи.',
          ),
        );
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, []);

  useEffect(() => {
    if (!selectedObjectId) {
      setUsers([]);
      return;
    }

    let cancelled = false;

    const loadUsers = async (): Promise<void> => {
      setUsersLoading(true);

      try {
        const response = await listSystemUsers({
          purpose: 'task_assignee',
          objectId: selectedObjectId,
        });

        if (!cancelled) {
          setUsers(response);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            getErrorMessage(
              error,
              'Не удалось загрузить исполнителей для выбранного объекта.',
            ),
          );
          setUsers([]);
        }
      } finally {
        if (!cancelled) {
          setUsersLoading(false);
        }
      }
    };

    void loadUsers();

    return () => {
      cancelled = true;
    };
  }, [selectedObjectId]);

  return (
    <>
      <PageTitle title="Создать задачу" />

      {isLoading ? (
        <div className="page-card">Загрузка...</div>
      ) : loadError ? (
        <div className="page-card" style={{ color: '#b91c1c' }}>
          {loadError}
        </div>
      ) : objects.length === 0 ? (
        <div className="page-card">
          Для ваших объектов сейчас недоступно создание задач.
        </div>
      ) : usersLoading ? (
        <div className="page-card">Загрузка исполнителей...</div>
      ) : (
        <TaskForm
          objects={objects}
          users={users}
          selectedObjectId={selectedObjectId}
          onObjectChange={(objectId) => {
            setLoadError(null);
            setSelectedObjectId(objectId);
          }}
          onSubmit={async (payload) => {
            const created = await createTask(payload);
            router.push(`/tasks/${created.id}`);
          }}
        />
      )}
    </>
  );
}
