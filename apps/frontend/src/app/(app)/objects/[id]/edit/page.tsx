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
  canEditObject,
  canEditObjectDailyRate,
  canOverrideFrozenObject,
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

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      const resolved = await params;

      if (cancelled) {
        return;
      }

      setObjectId(resolved.id);
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
            getErrorMessage(error, 'Не удалось загрузить объект для редактирования.'),
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
  }, [params]);

  const isAssignedToObject = useMemo(() => {
    if (!item || !user?.id) {
      return false;
    }

    return (
      item.managers.some((person) => person.userId === user.id) ||
      item.responsibles.some((person) => person.userId === user.id)
    );
  }, [item, user?.id]);

  const allowEditObject = useMemo(() => {
    if (!item) {
      return false;
    }

    if (canEditObject(currentUserRoleCodes)) {
      return true;
    }

    if (item.status === 'frozen') {
      return canOverrideFrozenObject(currentUserRoleCodes);
    }

    return isAssignedToObject;
  }, [item, currentUserRoleCodes, isAssignedToObject]);

  const allowEditDailyRate = canEditObjectDailyRate(currentUserRoleCodes);
  const allowChangeStatus = canChangeObjectStatus(currentUserRoleCodes);

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
        <div className="page-card" style={{ color: '#b91c1c' }}>
          {loadError}
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

  if (!allowEditObject) {
    return (
      <>
        <PageTitle title={`Редактирование: ${item.name}`} />
        <div className="page-card" style={{ display: 'grid', gap: 16 }}>
          <div style={{ fontWeight: 600 }}>Редактирование недоступно</div>
          <div className="page-muted">
            У вас нет прав на редактирование карточки этого объекта.
          </div>
          <div>
            <button type="button" onClick={() => router.push(`/objects/${item.id}`)}>
              Вернуться в карточку объекта
            </button>
          </div>
        </div>
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
          <button type="button" onClick={() => router.push(`/objects/${objectId}`)}>
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
