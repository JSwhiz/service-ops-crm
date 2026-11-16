import type { SavedWithoutAccess } from '@/shared/api/saved-without-access';
import type { CreateTaskPayload } from '@/entities/task/model/task.types';

export interface TaskCreationReceipt {
  createdTaskId: string | null;
  createdPayload: string | null;
  completed: boolean;
}

/** Persist the confirmed task before uploads; retries keep the same File identities. */
export async function completeTaskCreation(
  payload: CreateTaskPayload,
  files: File[],
  receipt: TaskCreationReceipt,
  dependencies: {
    create: (value: CreateTaskPayload) => Promise<{ id: string } | SavedWithoutAccess>;
    isCurrent?: () => boolean;
    upload: (id: string, files: File[]) => Promise<Array<{ status: 'fulfilled' | 'rejected' }>>;
    persist: (value: TaskCreationReceipt) => void;
  },
): Promise<string | SavedWithoutAccess> {
  if (receipt.completed) return receipt.createdTaskId ?? { outcome: 'saved_without_access' };
  let id = receipt.createdTaskId;
  const serialized = JSON.stringify(payload);
  if (!id) {
    const created = await dependencies.create(payload);
    if ('outcome' in created || dependencies.isCurrent?.() === false) {
      dependencies.persist({ createdTaskId: null, createdPayload: null, completed: true });
      return { outcome: 'saved_without_access' };
    }
    id = created.id;
    dependencies.persist({ createdTaskId: id, createdPayload: serialized, completed: false });
  } else if (receipt.createdPayload !== serialized) {
    throw new Error('Задача уже создана. Изменённые поля не сохранены: откройте созданную карточку для редактирования. Для повтора вложений верните исходные значения формы.');
  }
  if (dependencies.isCurrent?.() === false) {
    dependencies.persist({ createdTaskId: null, createdPayload: null, completed: true });
    return { outcome: 'saved_without_access' };
  }
  const uploads = await dependencies.upload(id, files);
  if (uploads.some((result) => result.status === 'rejected')) {
    throw new Error('Задача создана, но не все вложения загрузились. Повторите сохранение: задача и загруженные файлы не продублируются.');
  }
  dependencies.persist({ createdTaskId: id, createdPayload: serialized, completed: true });
  return id;
}
