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

export default function NewTaskPage(): React.JSX.Element {
  const router = useRouter();

  const [objects, setObjects] = useState<ServiceObject[]>([]);
  const [users, setUsers] = useState<SystemUserOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const load = async (): Promise<void> => {
      setIsLoading(true);
      setLoadError(null);

      try {
        const [objectResponse, userResponse] = await Promise.all([
          listObjects(),
          listSystemUsers(),
        ]);
        setObjects(objectResponse);
        setUsers(userResponse);
      } catch {
        setLoadError('Не удалось загрузить данные для создания задачи.');
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, []);

  return (
    <>
      <PageTitle title="Создать задачу" />

      {isLoading ? (
        <div className="page-card">Загрузка...</div>
      ) : loadError ? (
        <div className="page-card" style={{ color: '#b91c1c' }}>
          {loadError}
        </div>
      ) : (
        <TaskForm
          objects={objects}
          users={users}
          onSubmit={async (payload) => {
            const created = await createTask(payload);
            router.push(`/tasks/${created.id}`);
          }}
        />
      )}
    </>
  );
}
