'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  changeObjectStatus,
  getObjectById,
  updateObject,
} from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { ObjectEditForm } from '@/features/object-edit/ui/object-edit-form';
import { ObjectStatusPanel } from '@/features/object-status/ui/object-status-panel';
import { useAuth } from '@/shared/auth/use-auth';
import {
  canChangeObjectStatus,
  canEditObjectCard,
  canEditObjectDailyRate,
} from '@/shared/lib/access';
import { PageTitle } from '@/shared/ui/page-title/page-title';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

export default function EditObjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const router = useRouter();
  const { user } = useAuth();

  const [objectId, setObjectId] = useState('');
  const [item, setItem] = useState<ServiceObject | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const currentUserRoleCodes = useMemo(() => {
    if (!user) {
      return [];
    }

    if (user.roleCodes && user.roleCodes.length > 0) {
      return user.roleCodes;
    }

    return user.roleCode ? [user.roleCode] : [];
  }, [user]);

  const allowEditObject = canEditObjectCard(currentUserRoleCodes);
  const allowEditDailyRate = canEditObjectDailyRate(currentUserRoleCodes);
  const allowChangeStatus = canChangeObjectStatus(currentUserRoleCodes);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      const resolved = await params;

      if (cancelled) {
        return;
      }

      setObjectId(resolved.id);

      if (!allowEditObject) {
        setIsLoading(false);
        setLoadError('У вас нет прав на редактирование карточки объекта.');
        return;
      }

      setIsLoading(true);
      setLoadError(null);

      try {
        const response = await getObjectById(resolved.id);

        if (!cancelled) {
          setItem(response);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            getErrorMessage(
              error,
              'Не удалось загрузить объект для редактирования.',
            ),
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [params, allowEditObject]);

  if (isLoading) {
    return (
      <>
        <PageTitle title="Редактирование объекта" />
        <div className="page-card">Загрузка...</div>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <PageTitle title="Редактирование объекта" />
        <div className="page-card" style={{ display: 'grid', gap: 16 }}>
          <div style={{ color: '#b91c1c' }}>{loadError}</div>

          <div>
            <button
              type="button"
              onClick={() =>
                router.push(objectId ? `/objects/${objectId}` : '/objects')
              }
            >
              Вернуться назад
            </button>
          </div>
        </div>
      </>
    );
  }

  if (!item) {
    return (
      <>
        <PageTitle title="Редактирование объекта" />
        <div className="page-card">Объект не найден.</div>
      </>
    );
  }

  return (
    <>
      <PageTitle title={`Редактирование: ${item.name}`} />

      <div style={{ display: 'grid', gap: 16 }}>
        <ObjectEditForm
          item={item}
          canEditDailyRate={allowEditDailyRate}
          onSubmit={async (payload) => {
            const updated = await updateObject(item.id, payload);
            setItem(updated);
          }}
        />

        <ObjectStatusPanel
          currentStatus={item.status}
          canChangeStatus={allowChangeStatus}
          onChangeStatus={async (status) => {
            const updated = await changeObjectStatus(item.id, { status });
            setItem(updated);
          }}
        />

        <div className="page-card" style={{ display: 'flex', gap: 12 }}>
          <button
            type="button"
            onClick={() => router.push(`/objects/${objectId}`)}
          >
            Вернуться в карточку
          </button>

          <button type="button" onClick={() => router.push('/objects')}>
            К списку объектов
          </button>
        </div>
      </div>
    </>
  );
}
