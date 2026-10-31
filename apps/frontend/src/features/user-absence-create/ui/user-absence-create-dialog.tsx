'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { createUserAbsence, listUserAbsences, listUserAbsenceUsers } from '@/entities/user-absence/api/user-absence-client';
import type { UserAbsenceType, UserAbsenceUserOption } from '@/entities/user-absence/model/user-absence.types';
import { toCreateUserAbsencePayload } from '@/features/user-absence-create/model/create-user-absence-payload';
import { useAuth } from '@/shared/auth/use-auth';
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

function monthBounds(date: string): { from: string; to: string } {
  const [year = 0, month = 1] = date.split('-').map(Number);
  const end = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${String(month).padStart(2, '0')}-01`, to: `${year}-${String(month).padStart(2, '0')}-${String(end).padStart(2, '0')}` };
}

function hasValues(value: AbsenceDraft, initial: AbsenceDraft): boolean {
  return value.userId !== initial.userId || value.absenceType !== initial.absenceType ||
    value.startDate !== initial.startDate || value.endDate !== initial.endDate || value.comment !== initial.comment;
}

export function UserAbsenceCreateDialog(): React.JSX.Element {
  const router = useRouter();
  const navigation = useCreateNavigation();
  const { user } = useAuth();
  const params = navigation.getTargetSearchParams();
  const dateParam = params.get('date');
  const contextualDate = validDate(dateParam) ? dateParam : todayInMoscow();
  const forUser = params.get('forUser') ?? '';
  const directReturnParams = new URLSearchParams(params);
  directReturnParams.delete('date');
  directReturnParams.delete('forUser');
  const returnQuery = directReturnParams.toString();
  const closeContext = navigation.closeContext(`/user-absences${returnQuery ? `?${returnQuery}` : ''}`);
  const [access, setAccess] = useState<{ canManage: boolean; canManageAll: boolean; canViewPrivateReasons: boolean } | null>(null);
  const [users, setUsers] = useState<UserAbsenceUserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [localBusy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitLock = useRef(false);
  const bounds = useMemo(() => monthBounds(contextualDate), [contextualDate]);
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
    void (async () => {
      try {
        const response = await listUserAbsences(bounds);
        if (!active) return;
        setAccess({
          canManage: response.capabilities.canManage,
          canManageAll: response.capabilities.canManageAll,
          canViewPrivateReasons: response.capabilities.canViewPrivateReasons,
        });
        const options = await listUserAbsenceUsers();
        if (!active) return;
        setUsers(options);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Не удалось проверить доступ к календарю.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [bounds]);

  const update = (key: keyof AbsenceDraft, value: string): void => {
    const next = { ...draft.value, [key]: value } as AbsenceDraft;
    draft.setValue(next);
    draft.setDirty(hasValues(next, initialDraft));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitLock.current || busy || !access?.canManage) return;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    try {
      await draft.submit(() => createUserAbsence(toCreateUserAbsencePayload(draft.value, {
        canManageAll: access.canManageAll,
        canViewPrivateReasons: access.canViewPrivateReasons,
        currentUserId: user?.id,
      })));
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

  const canManage = access?.canManage === true;
  const canChooseUser = access?.canManageAll === true;
  const showComment = draft.value.userId === user?.id || access?.canViewPrivateReasons === true;

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
          {canManage ? <Button
            variant="primary"
            type="submit"
            form={FORM_ID}
            pending={busy}
            pendingLabel="Сохраняем…"
            disabled={loading || busy || created || !draft.value.userId || !draft.value.startDate || !draft.value.endDate}
          >{created ? 'Создано' : 'Создать отсутствие'}</Button> : null}
        </div>
      )}
    >
      {canManage ? (
        <form id={FORM_ID} className={styles.form} onSubmit={(event) => void submit(event)}>
          <p className={styles.requiredNote}><span aria-hidden="true">*</span> — обязательные поля</p>
          <div className={styles.fields}>
            {canChooseUser ? <Field label="Пользователь" required className={styles.fullWidth}>
              <Select value={draft.value.userId} onChange={(event) => update('userId', event.target.value)} required>
                {users.map((entry) => <option key={entry.id} value={entry.id}>{entry.fullName || entry.login}</option>)}
              </Select>
            </Field> : null}
            <Field label="Тип отсутствия" required className={styles.fullWidth}>
              <Select value={draft.value.absenceType} onChange={(event) => update('absenceType', event.target.value)} required>
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
          {loading ? <p role="status">Проверяем доступ…</p> : null}
          {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
          {created ? <Alert tone="success" role="status">Отсутствие создано.</Alert> : null}
        </form>
      ) : access?.canManage === false ? <Alert tone="danger" role="alert">Нет доступа к созданию записей календаря.</Alert> : error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
    </FormDialog>
  );
}
