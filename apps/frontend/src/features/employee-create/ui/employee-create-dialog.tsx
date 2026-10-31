'use client';

import { useRouter } from 'next/navigation';
import React, { useLayoutEffect, useRef, useState } from 'react';

import { createEmployee } from '@/entities/employee/api/employee-client';
import { EmployeeFormFields, type EmployeeFormValue } from '@/features/employee-form/employee-form-fields';
import { toEmployeeMutationPayload } from '@/features/employee-form/employee-form-payload';
import { phoneDrafts, phoneDraftsValid } from '@/shared/ui/phone-list-field/phone-list-field';
import { useAuth } from '@/shared/auth/use-auth';
import { useCreateDraft } from '@/shared/drafts';
import { useCreateNavigation } from '@/shared/create-navigation';
import { Alert, Button } from '@/shared/ui/foundation';
import { FormDialog } from '@/shared/ui/overlays';
import { EMPLOYEE_PHONE_ERROR, focusEmployeePhoneIssue } from '../model/phone-validation-focus';

const INITIAL_FORM: EmployeeFormValue = {
  passportReceived: false, contractReceived: false, fullName: '', phones: phoneDrafts([]),
  birthDate: '', residenceAddress: '', employeeType: 'regular', position: '', employmentStatus: 'active',
  baseDailyRate: '', workScheduleCode: '', workScheduleCustom: '', workTimeText: '', shiftPreferences: '', notes: '',
};
const FORM_ID = 'employee-create-form';
const SECTIONS = [
  { id: 'contacts', label: 'Контакты' }, { id: 'work', label: 'Работа' },
  { id: 'mode', label: 'Режим' }, { id: 'documents', label: 'Документы и примечание' },
];

export function EmployeeCreateDialog(): React.JSX.Element {
  const router = useRouter();
  const navigation = useCreateNavigation();
  const { user } = useAuth();
  const draft = useCreateDraft<EmployeeFormValue>('employee-create', INITIAL_FORM);
  const [activeSection, setActiveSection] = useState('contacts');
  const [error, setError] = useState<string | null>(null);
  const [localBusy, setBusy] = useState(false);
  const busy = localBusy || draft.submitting;
  const [phoneFocusAttempt, setPhoneFocusAttempt] = useState(0);
  useLayoutEffect(() => {
    if (phoneFocusAttempt && focusEmployeePhoneIssue(activeSection, (selector) => document.querySelector<HTMLInputElement>(selector))) {
      setPhoneFocusAttempt(0);
    }
  }, [activeSection, phoneFocusAttempt]);
  const lock = useRef(false);
  const canCreate = user?.capabilities?.canCreateEmployee ?? false;
  const fallbackSearch = navigation.getTargetSearchParams().toString();
  const closeContext = navigation.closeContext(`/employees${fallbackSearch ? `?${fallbackSearch}` : ''}`);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (lock.current || busy || !canCreate) return;
    if (draft.value.workScheduleCode === 'custom' && !draft.value.workScheduleCustom.trim()) {
      setActiveSection('mode');
      setError('Укажите описание выбранного графика.');
      window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>('#employee-create-form input:invalid')?.focus());
      return;
    }
    if (!phoneDraftsValid(draft.value.phones)) {
      setActiveSection('contacts');
      setError(EMPLOYEE_PHONE_ERROR);
      setPhoneFocusAttempt((attempt) => attempt + 1);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const created = await draft.submit(() => createEmployee({ ...toEmployeeMutationPayload(draft.value), fullName: draft.value.fullName.trim() }));
      draft.clear();
      router.push(`/employees/${created.id}`);
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : 'Не удалось создать сотрудника.');
      lock.current = false;
      setBusy(false);
    }
  };

  return <FormDialog open title="Новый сотрудник" size="wide" busy={busy} dirty={draft.dirty}
    closeContext={closeContext} clearDraft={draft.clear}
    sections={{ sections: SECTIONS, activeSectionId: activeSection, onSectionChange: setActiveSection }}
    footer={({ requestClose }) => <div className="ui-inline">
      <Button onClick={() => void requestClose()} disabled={busy}>Отмена</Button>
      {canCreate ? <Button variant="primary" type="submit" form={FORM_ID} pending={busy} pendingLabel="Создание…">Создать сотрудника</Button> : null}
    </div>}>
    {canCreate ? <form id={FORM_ID} onSubmit={(event) => void submit(event)} onInvalidCapture={(event) => {
      const section = (event.target as HTMLElement).closest('fieldset[hidden]')?.getAttribute('data-section');
      if (section) setActiveSection(section);
    }}>
      <EmployeeFormFields value={draft.value} onChange={draft.setValue} disabled={busy} activeSection={activeSection} />
      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
    </form> : <Alert tone="warning">У вас нет прав на создание карточек сотрудников.</Alert>}
  </FormDialog>;
}
