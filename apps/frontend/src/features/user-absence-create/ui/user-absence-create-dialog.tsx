'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { createUserAbsence, listUserAbsenceUsers } from '@/entities/user-absence/api/user-absence-client';
import type { UserAbsenceType, UserAbsenceUserOption } from '@/entities/user-absence/model/user-absence.types';
import { changeUserAbsenceCreateTarget, toCreateUserAbsencePayload } from '@/features/user-absence-create/model/create-user-absence-payload';
import { useAuth } from '@/shared/auth/use-auth';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { useCreateDraft } from '@/shared/drafts';
import { useCreateNavigation } from '@/shared/create-navigation';
import { Alert, Button, Field } from '@/shared/ui/foundation';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { Select } from '@/shared/ui/searchable-select/select';
import { FormDialog } from '@/shared/ui/overlays';

import styles from './user-absence-create-dialog.module.css';

interface AbsenceDraft {
  userId: string;
  absenceType: UserAbsenceType;
  startDate: string;
  endDate: string;
  comment: string;
}

const FORM_ID = 'user-absence-create-form';
const ABSENCE_TYPES: Array<{ value: UserAbsenceType; label: string }> = [
  { value: 'vacation', label: 'Отпуск' },
  { value: 'sick_leave', label: 'Больничный' },
  { value: 'day_off', label: 'Отгул' },
];

function todayInMoscow(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function hasValues(value: AbsenceDraft, initial: AbsenceDraft): boolean {
  return value.userId !== initial.userId || value.absenceType !== initial.absenceType ||
    value.startDate !== initial.startDate || value.endDate !== initial.endDate || value.comment !== initial.comment;
}

export function UserAbsenceCreateDialog(): React.JSX.Element {
  const router = useRouter();
  const navigation = useCreateNavigation();
  const { user } = useAuth();
  const accessRevision = useAccessRevision();
  const [loadedAccessRevision, setLoadedAccessRevision] = useState<string | null>(null);
  const params = navigation.getTargetSearchParams();
  const dateParam = params.get('date');
  const contextualDate = validDate(dateParam) ? dateParam : todayInMoscow();
  const forUser = params.get('forUser') ?? '';
  const directReturnParams = new URLSearchParams(params);
  directReturnParams.delete('date');
  directReturnParams.delete('forUser');
  const returnQuery = directReturnParams.toString();
  const closeContext = navigation.closeContext(`/user-absences${returnQuery ? `?${returnQuery}` : ''}`);
  const [users, setUsers] = useState<UserAbsenceUserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [localBusy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const submitLock = useRef(false);
  const initialDraft = useMemo<AbsenceDraft>(() => ({
    userId: forUser || user?.id || '',
    absenceType: 'vacation',
    startDate: contextualDate,
    endDate: contextualDate,
    comment: '',
  }), [contextualDate, forUser, user?.id]);
  const draft = useCreateDraft<AbsenceDraft>('user-absence-create', initialDraft);
  const busy = localBusy || draft.submitting;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadedAccessRevision(null);
    void (async () => {
      try {
        const options = await listUserAbsenceUsers();
        if (!active) return;
        setUsers(options);
        setError(null);
        setLoadedAccessRevision(accessRevision);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Не удалось проверить доступ к календарю.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [accessRevision, retry]);

  const accessCurrent = loadedAccessRevision === accessRevision && !loading;
  const selectedTarget = accessCurrent ? users.find((entry) => entry.id === draft.value.userId) : undefined;
  const canCreate = selectedTarget?.capabilities?.canCreate === true;
  const creatableUsers = accessCurrent ? users.filter((entry) => entry.capabilities?.canCreate === true) : [];
  const showComment = selectedTarget?.capabilities?.canViewPrivateReasons === true;
  const blockedReason = !accessCurrent
    ? loading ? 'Проверяем доступ к выбранному пользователю. Черновик сохранён.' : 'Не удалось подтвердить доступ. Черновик сохранён. Нажмите «Обновить доступ».'
    : creatableUsers.length === 0
      ? 'Нет пользователей, для которых разрешено создание отсутствий. Черновик сохранён.'
      : !canCreate
        ? 'Создание отсутствия для выбранного пользователя недоступно. Выберите пользователя с правом создания. Черновик сохранён.'
        : null;

  const update = (key: keyof AbsenceDraft, value: string): void => {
    const next = key === 'userId'
      ? changeUserAbsenceCreateTarget(draft.value, value)
      : { ...draft.value, [key]: value } as AbsenceDraft;
    draft.setValue(next);
    draft.setDirty(hasValues(next, initialDraft));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitLock.current || busy || created || !accessCurrent || !canCreate) return;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    try {
      await draft.submit(() => createUserAbsence(toCreateUserAbsencePayload(draft.value, selectedTarget)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить отсутствие.');
      submitLock.current = false;
      setBusy(false);
      return;
    }

    setCreated(true);
    setBusy(false);
    draft.clear();
    window.dispatchEvent(new Event('user-absence-created'));
    const target = closeContext.kind === 'intercepted' ? closeContext.returnTo : closeContext.fallbackHref;
    try {
      router.replace(target);
    } catch {
      setError('Отсутствие создано, но не удалось вернуться к календарю. Закройте окно, чтобы продолжить.');
    }
  };

  return (
    <FormDialog
      open
      title="Новое отсутствие"
      size="compact"
      busy={busy}
      dirty={draft.dirty}
      closeContext={closeContext}
      clearDraft={draft.clear}
      footer={({ requestClose }) => (
        <div className={styles.footer}>
          <Button onClick={() => void requestClose()} disabled={busy}>Отмена</Button>
          <Button
            variant="primary"
            type="submit"
            form={FORM_ID}
            pending={busy}
            pendingLabel="Сохраняем…"
            disabled={!accessCurrent || !canCreate || busy || created || !draft.value.userId || !draft.value.startDate || !draft.value.endDate}
          >{created ? 'Создано' : 'Создать отсутствие'}</Button>
        </div>
      )}
    >
        <form id={FORM_ID} className={styles.form} onSubmit={(event) => void submit(event)}>
          <p className={styles.requiredNote}><span aria-hidden="true">*</span> — обязательные поля</p>
          <div className={styles.fields}>
            <Field label="Пользователь" required className={styles.fullWidth}>
              <Select value={draft.value.userId} disabled={busy || !accessCurrent} onChange={(event) => update('userId', event.target.value)} required>
                {!canCreate ? <option value={draft.value.userId}>{selectedTarget ? `${selectedTarget.fullName || selectedTarget.login} — создание недоступно` : draft.value.userId ? 'Выбранный пользователь недоступен' : 'Выберите доступного пользователя'}</option> : null}
                {creatableUsers.map((entry) => <option key={entry.id} value={entry.id}>{entry.fullName || entry.login}</option>)}
              </Select>
            </Field>
            <Field label="Тип отсутствия" required className={styles.fullWidth}>
              <Select value={draft.value.absenceType} disabled={busy} onChange={(event) => update('absenceType', event.target.value)} required>
                {ABSENCE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </Select>
            </Field>
            <Field label="С" required className={styles.dateField}>
              <DatePicker value={draft.value.startDate} displayFormat="short" required disabled={busy} onChange={(value) => {
                const endDate = draft.value.endDate < value ? value : draft.value.endDate;
                const next = { ...draft.value, startDate: value, endDate };
                draft.setValue(next);
                draft.setDirty(hasValues(next, initialDraft));
              }} />
            </Field>
            <Field label="По" required className={styles.dateField}>
              <DatePicker min={draft.value.startDate} value={draft.value.endDate} displayFormat="short" required disabled={busy} onChange={(value) => update('endDate', value)} />
            </Field>
            {showComment ? <Field label="Комментарий" className={styles.fullWidth}>
              <input value={draft.value.comment} onChange={(event) => update('comment', event.target.value)} placeholder="Необязательно" disabled={busy} />
            </Field> : null}
          </div>
          {blockedReason ? <Alert tone="warning" role="status">{blockedReason}</Alert> : null}
          {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
          {!loading && !created ? <Button disabled={busy} onClick={() => { setError(null); setLoadedAccessRevision(null); setRetry((value) => value + 1); }}>Обновить доступ</Button> : null}
          {created ? <Alert tone="success" role="status">Отсутствие создано.</Alert> : null}
        </form>
    </FormDialog>
  );
}
