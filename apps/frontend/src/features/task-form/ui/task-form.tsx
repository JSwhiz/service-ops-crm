'use client';

import React, { useMemo, useState } from 'react';

import type { ServiceObject } from '@/entities/object/model/object.types';
import type { OneTimeOrderListItem } from '@/entities/one-time-order/model/one-time-order.types';
import type {
  CreateTaskPayload,
  TaskCompletionRequirement,
  TaskPriority,
} from '@/entities/task/model/task.types';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import {
  getUserDisplayName,
  getUserSecondaryLabel,
} from '@/shared/lib/display-name';
import {
  TASK_COMPLETION_OPTIONS,
  TASK_PRIORITY_OPTIONS,
} from '@/shared/lib/task-presentation';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { Select } from '@/shared/ui/searchable-select/select';
import { Button } from '@/shared/ui/foundation';
import taskStyles from '@/entities/task/ui/task-ui.module.css';

export interface TaskFormInitialValue {
  title: string;
  description: string;
  priority: TaskPriority;
  objectId: string;
  oneTimeOrderId: string;
  assigneeUserIds: string[];
  visibilityType: 'all_users' | 'selected_users' | 'target_participants' | 'private';
  visibleUserIds: string[];
  requiresConfirmation: boolean;
  completionRequirement: TaskCompletionRequirement;
  dueDate: string;
  dueTime: string;
}

const EMPTY_VALUE: TaskFormInitialValue = {
  title: '',
  description: '',
  priority: 'important_not_urgent',
  objectId: '',
  oneTimeOrderId: '',
  assigneeUserIds: [],
  visibilityType: 'private',
  visibleUserIds: [],
  requiresConfirmation: true,
  completionRequirement: 'comment_or_file',
  dueDate: '',
  dueTime: '',
};

export function TaskForm({
  objects,
  orders,
  users,
  visibilityUsers,
  initialValue,
  isEdit = false,
  onTargetsChange,
  onSubmit,
  onCancel,
}: {
  objects: ServiceObject[];
  orders: OneTimeOrderListItem[];
  users: SystemUserOption[];
  visibilityUsers: SystemUserOption[];
  initialValue?: Partial<TaskFormInitialValue>;
  isEdit?: boolean;
  onTargetsChange: (objectId: string, oneTimeOrderId: string) => void;
  onSubmit: (payload: CreateTaskPayload) => Promise<void>;
  onCancel?: () => void;
}): React.JSX.Element {
  const [form, setForm] = useState<TaskFormInitialValue>({
    ...EMPTY_VALUE,
    ...initialValue,
  });
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [visibilitySearch, setVisibilitySearch] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredUsers = useMemo(() => {
    const query = assigneeSearch.trim().toLocaleLowerCase('ru-RU');
    return users.filter(
      (user) =>
        user.isActive &&
        (!query ||
          user.fullName.toLocaleLowerCase('ru-RU').includes(query) ||
          user.login.toLocaleLowerCase('ru-RU').includes(query)),
    );
  }, [assigneeSearch, users]);
  const filteredVisibilityUsers = useMemo(() => {
    const query = visibilitySearch.trim().toLocaleLowerCase('ru-RU');
    return visibilityUsers.filter(
      (user) =>
        user.isActive &&
        (!query ||
          user.fullName.toLocaleLowerCase('ru-RU').includes(query) ||
          user.login.toLocaleLowerCase('ru-RU').includes(query)),
    );
  }, [visibilitySearch, visibilityUsers]);

  const setTarget = (
    field: 'objectId' | 'oneTimeOrderId',
    value: string,
  ): void => {
    const next = {
      ...form,
      [field]: value,
      visibleUserIds: [],
    };
    next.visibilityType =
      next.objectId || next.oneTimeOrderId
        ? 'target_participants'
        : 'private';
    setForm(next);
    onTargetsChange(next.objectId, next.oneTimeOrderId);
  };

  const toggleUser = (
    field: 'assigneeUserIds' | 'visibleUserIds',
    userId: string,
  ): void => {
    setForm((current) => ({
      ...current,
      [field]: current[field].includes(userId)
        ? current[field].filter((id) => id !== userId)
        : [...current[field], userId],
    }));
  };

  const submit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setError(null);

    if (!isEdit && form.assigneeUserIds.length === 0) {
      setError('Выберите минимум одного исполнителя.');
      return;
    }
    if (!form.dueDate) {
      setError('Укажите срок задачи.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        priority: form.priority,
        ...(form.objectId ? { objectId: form.objectId } : {}),
        ...(form.oneTimeOrderId ? { oneTimeOrderId: form.oneTimeOrderId } : {}),
        assigneeUserIds: form.assigneeUserIds,
        visibilityType: form.visibilityType,
        ...(form.visibilityType === 'selected_users'
          ? { visibleUserIds: form.visibleUserIds }
          : {}),
        requiresConfirmation: form.requiresConfirmation,
        completionRequirement: form.completionRequirement,
        dueDate: form.dueDate,
        dueTime: form.dueDate && form.dueTime ? form.dueTime : null,
      });
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : 'Не удалось сохранить задачу.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className={taskStyles.taskForm} onSubmit={(event) => void submit(event)}>
      <div className={taskStyles.taskFormGrid}>
        <label className={`${taskStyles.taskField} ${taskStyles.taskFieldWide}`}>
          <span>Название</span>
          <input
            value={form.title}
            minLength={2}
            required
            autoFocus={!isEdit}
            onChange={(event) =>
              setForm({ ...form, title: event.target.value })
            }
          />
        </label>

        <label className={taskStyles.taskField}>
          <span>Приоритет</span>
          <Select
            value={form.priority}
            onChange={(event) =>
              setForm({ ...form, priority: event.target.value as TaskPriority })
            }
          >
            {TASK_PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>

        <label className={taskStyles.taskField}>
          <span>Требования к отчёту</span>
          <Select
            value={form.completionRequirement}
            onChange={(event) =>
              setForm({
                ...form,
                completionRequirement: event.target
                  .value as TaskCompletionRequirement,
              })
            }
          >
            {TASK_COMPLETION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>

        <label className={`${taskStyles.taskField} ${taskStyles.taskFieldWide}`}>
          <span>Описание</span>
          <textarea
            rows={4}
            value={form.description}
            onChange={(event) =>
              setForm({ ...form, description: event.target.value })
            }
          />
        </label>

        <label className={taskStyles.taskField}>
          <span>Объект (необязательно)</span>
          <Select
            value={form.objectId}
            onChange={(event) => setTarget('objectId', event.target.value)}
          >
            <option value="">Без объекта</option>
            {objects.map((object) => (
              <option key={object.id} value={object.id}>
                {object.name}
              </option>
            ))}
          </Select>
        </label>

        <label className={taskStyles.taskField}>
          <span>Разовый заказ (необязательно)</span>
          <Select
            value={form.oneTimeOrderId}
            onChange={(event) =>
              setTarget('oneTimeOrderId', event.target.value)
            }
          >
            <option value="">Без разового заказа</option>
            {orders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.title}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <fieldset className={taskStyles.taskFormSection}>
        <legend>Срок *</legend>
        <div className={taskStyles.taskFormInline}>
          <DatePicker aria-label="Дата срока" value={form.dueDate} required onChange={(nextValue) => setForm({ ...form, dueDate: nextValue })} />
          <label className={taskStyles.taskCheck}>
            <input
              type="checkbox"
              checked={Boolean(form.dueTime)}
              onChange={(event) =>
                setForm({
                  ...form,
                  dueTime: event.target.checked ? '18:00' : '',
                })
              }
            />
            Указать точное время
          </label>
          {form.dueTime ? (
            <input
              type="time"
              aria-label="Точное время срока"
              value={form.dueTime}
              onChange={(event) =>
                setForm({ ...form, dueTime: event.target.value })
              }
            />
          ) : null}
        </div>
        <div className="ui-text-muted">
          Для каждой задачи нужно указать дату; точное время — по желанию.
        </div>
      </fieldset>

      {!isEdit ? (
        <UserChecklist
          title="Исполнители"
          hint="Можно выбрать одного или нескольких активных пользователей."
          search={assigneeSearch}
          onSearch={setAssigneeSearch}
          users={filteredUsers}
          selectedIds={form.assigneeUserIds}
          onToggle={(id) => toggleUser('assigneeUserIds', id)}
        />
      ) : null}

      <fieldset className={taskStyles.taskFormSection}>
        <legend>Видимость</legend>
        <label className={taskStyles.taskRadio}>
          <input
            type="radio"
            name="visibility"
            checked={form.visibilityType === 'private'}
            onChange={() =>
              setForm({ ...form, visibilityType: 'private', visibleUserIds: [] })
            }
          />
          Только участники задачи
        </label>
        <label className={taskStyles.taskRadio}>
          <input
            type="radio"
            name="visibility"
            checked={form.visibilityType === 'target_participants'}
            disabled={!form.objectId && !form.oneTimeOrderId}
            onChange={() => setForm({ ...form, visibilityType: 'target_participants', visibleUserIds: [] })}
          />
          Участники объекта или разового заказа
        </label>
        <label className={taskStyles.taskRadio}>
          <input
            type="radio"
            name="visibility"
            checked={form.visibilityType === 'selected_users'}
            onChange={() => setForm({ ...form, visibilityType: 'selected_users' })}
          />
          Только выбранные пользователи
        </label>
        <label className={taskStyles.taskRadio}>
          <input
            type="radio"
            name="visibility"
            checked={form.visibilityType === 'all_users'}
            onChange={() => setForm({ ...form, visibilityType: 'all_users', visibleUserIds: [] })}
          />
          Все активные пользователи системы
        </label>
        <div className="ui-section-subtitle">
          {form.visibilityType === 'all_users'
            ? 'Задачу увидят все активные пользователи и руководство.'
            : form.visibilityType === 'target_participants'
              ? 'Задачу увидят создатель, исполнители, участники связанного объекта или заказа и руководство.'
              : form.visibilityType === 'selected_users'
                ? 'Задачу увидят создатель, исполнители, выбранные пользователи и руководство.'
                : 'Задачу увидят создатель, исполнители и руководство.'}
        </div>
        {form.visibilityType === 'selected_users' ? (
          <UserChecklist
            title="Дополнительная видимость"
            search={visibilitySearch}
            onSearch={setVisibilitySearch}
            users={filteredVisibilityUsers}
            selectedIds={form.visibleUserIds}
            onToggle={(id) => toggleUser('visibleUserIds', id)}
          />
        ) : null}
      </fieldset>

      <label className={`${taskStyles.taskCheck} ${taskStyles.taskFormConfirmation}`}>
        <input
          type="checkbox"
          checked={form.requiresConfirmation}
          onChange={(event) =>
            setForm({ ...form, requiresConfirmation: event.target.checked })
          }
        />
        Требуется подтверждение результата
      </label>

      {error ? (
        <div className={taskStyles.taskFormError} role="alert">
          {error}
        </div>
      ) : null}
      <div className="ui-inline">
        <Button variant="primary" type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? 'Сохраняем…'
            : isEdit
              ? 'Сохранить изменения'
              : 'Создать задачу'}
        </Button>
        {onCancel ? (
          <Button onClick={onCancel}>
            Отмена
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function UserChecklist({
  title,
  hint,
  search,
  onSearch,
  users,
  selectedIds,
  onToggle,
}: {
  title: string;
  hint?: string;
  search: string;
  onSearch: (value: string) => void;
  users: SystemUserOption[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}): React.JSX.Element {
  return (
    <fieldset className={taskStyles.taskFormSection}>
      <legend>{title}</legend>
      {hint ? <div className="ui-section-subtitle">{hint}</div> : null}
      <input
        type="search"
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder="Найти по ФИО или логину"
        aria-label={`Поиск: ${title}`}
      />
      <div className={`${taskStyles.taskUserGrid} local-scroll local-scroll--sm`}>
        {users.length === 0 ? (
          <div className="ui-text-muted">Пользователи не найдены.</div>
        ) : (
          users.map((user) => (
            <label key={user.id} className={taskStyles.taskUserOption}>
              <input
                type="checkbox"
                checked={selectedIds.includes(user.id)}
                onChange={() => onToggle(user.id)}
              />
              <span>
                {getUserDisplayName(user)}
                {getUserSecondaryLabel(user) ? (
                  <small>{getUserSecondaryLabel(user)}</small>
                ) : null}
              </span>
            </label>
          ))
        )}
      </div>
    </fieldset>
  );
}
