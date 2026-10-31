'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { listObjects } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { listOneTimeOrders } from '@/entities/one-time-order/api/one-time-order-client';
import type { OneTimeOrderListItem } from '@/entities/one-time-order/model/one-time-order.types';
import { createTask } from '@/entities/task/api/task-client';
import type { CreateTaskPayload } from '@/entities/task/model/task.types';
import { uploadFileBatch } from '@/entities/file/api/file-client';
import { listSystemUsers } from '@/entities/user/api/user-client';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import { TaskForm, EMPTY_TASK_VALUE, type TaskFormInitialValue } from '@/features/task-form/ui/task-form';
import { useCreateDraft } from '@/shared/drafts';
import { useCreateNavigation } from '@/shared/create-navigation';
import { FormDialog } from '@/shared/ui/overlays';
import { Alert, Button, ButtonLink } from '@/shared/ui/foundation';
import { completeTaskCreation } from '../model/complete-task-creation';

interface TaskCreateDraft {
  form: TaskFormInitialValue;
  files: File[];
  createdTaskId: string | null;
  createdPayload: string | null;
  completed: boolean;
  pending: boolean;
}
const EMPTY_DRAFT: TaskCreateDraft = { form: EMPTY_TASK_VALUE, files: [], createdTaskId: null, createdPayload: null, completed: false, pending: false };

export function TaskCreateDialog(): React.JSX.Element {
  const router = useRouter();
  const navigation = useCreateNavigation();
  const draft = useCreateDraft<TaskCreateDraft>('task-create', EMPTY_DRAFT);
  const query = navigation.getTargetSearchParams().toString();
  const closeContext = navigation.closeContext('/tasks' + (query ? '?' + query : ''));
  const [objects, setObjects] = useState<ServiceObject[]>([]);
  const [orders, setOrders] = useState<OneTimeOrderListItem[]>([]);
  const [users, setUsers] = useState<SystemUserOption[]>([]);
  const [visibilityUsers, setVisibilityUsers] = useState<SystemUserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pending = draft.value.pending || draft.submitting;
  const setPending = (value: boolean): void => {
    let dirty = false;
    draft.setValue((current) => {
      dirty = !current.completed && Boolean(current.createdTaskId || current.files.length || JSON.stringify(current.form) !== JSON.stringify(EMPTY_TASK_VALUE));
      return { ...current, pending: value };
    });
    draft.setDirty(dirty);
  };
  const { objectId, oneTimeOrderId } = draft.value.form;
  const expectedDirty = !draft.value.completed && Boolean(draft.value.createdTaskId || draft.value.files.length || JSON.stringify(draft.value.form) !== JSON.stringify(EMPTY_TASK_VALUE));
  useEffect(() => {
    if (draft.dirty !== expectedDirty) draft.setDirty(expectedDirty);
  }, [draft.dirty, expectedDirty]);

  useEffect(() => {
    let active = true;
    void Promise.all([listObjects(), listOneTimeOrders({ limit: 100, sortBy: 'title', sortDirection: 'asc' })])
      .then(([nextObjects, nextOrders]) => { if (active) { setObjects(nextObjects); setOrders(nextOrders.items); } })
      .catch(() => { if (active) setError('Не удалось загрузить доступные объекты и заказы.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    const targets = { ...(objectId ? { objectId } : {}), ...(oneTimeOrderId ? { oneTimeOrderId } : {}) };
    void Promise.all([
      listSystemUsers({ purpose: 'task_assignee', ...targets }),
      listSystemUsers({ purpose: 'task_visibility', ...targets }),
    ]).then(([nextUsers, nextVisibilityUsers]) => {
      if (active) { setUsers(nextUsers); setVisibilityUsers(nextVisibilityUsers); }
    }).catch(() => { if (active) setError('Не удалось загрузить доступных пользователей.'); });
    return () => { active = false; };
  }, [objectId, oneTimeOrderId]);

  const setForm: React.Dispatch<React.SetStateAction<TaskFormInitialValue>> = (next) => {
    draft.setValue((current) => ({ ...current, form: typeof next === 'function' ? next(current.form) : next }));
    draft.setDirty(true);
  };
  const setFiles: React.Dispatch<React.SetStateAction<File[]>> = (next) => {
    draft.setValue((current) => ({ ...current, files: typeof next === 'function' ? next(current.files) : next }));
    draft.setDirty(true);
  };
  const submit = async (payload: CreateTaskPayload, files: File[]): Promise<void> => {
    if (draft.value.completed) return;
    if (loading || error) throw new Error(error || 'Дождитесь загрузки доступных объектов и пользователей.');
    const id = await draft.submit(() => completeTaskCreation(payload, files, draft.value, {
      create: createTask,
      upload: (entityId, retainedFiles) => uploadFileBatch({ entityType: 'task', entityId, files: retainedFiles }),
      persist: (receipt) => draft.setValue((current) => ({ ...current, ...receipt })),
    }));
    draft.setDirty(false);
    draft.clearAfterNavigation('/tasks/' + id);
    router.push('/tasks/' + id);
  };

  return <FormDialog open title="Создать задачу" size="regular" busy={pending} dirty={draft.dirty} closeContext={closeContext} clearDraft={draft.clear}
    footer={({ requestClose }) => <div className="ui-inline">
      <Button disabled={pending} onClick={() => void requestClose()}>{draft.value.completed ? 'Закрыть' : 'Отмена'}</Button>
      <Button variant="primary" type="submit" form="task-create-form" pending={pending} disabled={loading || Boolean(error) || draft.value.completed}>
        {draft.value.completed ? 'Создано' : draft.value.createdTaskId ? 'Повторить вложения' : 'Создать задачу'}
      </Button>
    </div>}>
    {loading ? <p role="status">Загрузка…</p> : null}
    {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
    {draft.value.createdTaskId ? <Alert tone="info">Задача уже создана. Повторное сохранение повторит только вложения. Поля и состав исполнителей изменяйте в карточке. <ButtonLink href={'/tasks/' + draft.value.createdTaskId}>Открыть созданную задачу</ButtonLink></Alert> : null}
    {!loading ? <TaskForm objects={objects} orders={orders} users={users} visibilityUsers={visibilityUsers}
      draft={{ value: draft.value.form, setValue: setForm, files: draft.value.files, setFiles }}
      formId="task-create-form" hideActions completed={draft.value.completed} externalPending={pending} onSubmittingChange={setPending}
      onTargetsChange={() => setError(null)} onSubmit={submit} /> : null}
  </FormDialog>;
}
