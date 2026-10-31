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
    create: (value: CreateTaskPayload) => Promise<{ id: string }>;
    upload: (id: string, files: File[]) => Promise<Array<{ status: 'fulfilled' | 'rejected' }>>;
    persist: (value: TaskCreationReceipt) => void;
  },
): Promise<string> {
  if (receipt.completed && receipt.createdTaskId) return receipt.createdTaskId;
  let id = receipt.createdTaskId;
  const serialized = JSON.stringify(payload);
  if (!id) {
    id = (await dependencies.create(payload)).id;
    dependencies.persist({ createdTaskId: id, createdPayload: serialized, completed: false });
  } else if (receipt.createdPayload !== serialized) {
    throw new Error('Задача уже создана. Изменённые поля не сохранены: откройте созданную карточку для редактирования. Для повтора вложений верните исходные значения формы.');
  }
  const uploads = await dependencies.upload(id, files);
  if (uploads.some((result) => result.status === 'rejected')) {
    throw new Error('Задача создана, но не все вложения загрузились. Повторите сохранение: задача и загруженные файлы не продублируются.');
  }
  dependencies.persist({ createdTaskId: id, createdPayload: serialized, completed: true });
  return id;
}
