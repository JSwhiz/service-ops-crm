'use client';

import { useRouter } from 'next/navigation';
import React, { useRef, useState } from 'react';

import { createRubberMatSize, getRubberMatCatalog } from '@/entities/rubber-mat/api/rubber-mat-client';
import { toCreateRubberMatSizePayload } from '@/features/rubber-mat-size-create/model/create-rubber-mat-size-payload';
import { useCreateDraft } from '@/shared/drafts';
import { useCreateNavigation } from '@/shared/create-navigation';
import { Alert, Button, Field } from '@/shared/ui/foundation';
import { FormDialog } from '@/shared/ui/overlays';

import styles from './rubber-mat-size-create-dialog.module.css';

interface RubberMatSizeDraft {
  length: string;
  width: string;
  replacementCost: string;
}

const EMPTY_DRAFT: RubberMatSizeDraft = { length: '', width: '', replacementCost: '' };
const FORM_ID = 'rubber-mat-size-create-form';

function hasValues(value: RubberMatSizeDraft): boolean {
  return Object.values(value).some((part) => part.trim().length > 0);
}

export function RubberMatSizeCreateDialog(): React.JSX.Element {
  const router = useRouter();
  const navigation = useCreateNavigation();
  const params = navigation.getTargetSearchParams();
  const fallbackSearch = params.toString();
  const closeContext = navigation.closeContext(`/rubber-mats${fallbackSearch ? `?${fallbackSearch}` : ''}`);
  const draft = useCreateDraft<RubberMatSizeDraft>('rubber-mat-size-create', EMPTY_DRAFT);
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [localBusy, setBusy] = useState(false);
  const busy = localBusy || draft.submitting;
  const [created, setCreated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitLock = useRef(false);

  React.useEffect(() => {
    let active = true;
    void getRubberMatCatalog().then((catalog) => {
      if (active) setCanManage(catalog.canManage);
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : 'Не удалось проверить права и загрузить каталог.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const update = (key: keyof RubberMatSizeDraft, value: string): void => {
    const next = { ...draft.value, [key]: value };
    draft.setValue(next);
    draft.setDirty(hasValues(next));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitLock.current || busy || !canManage) return;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    try {
      await draft.submit(() => createRubberMatSize(toCreateRubberMatSizePayload(draft.value)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось добавить размер ковра.');
      submitLock.current = false;
      setBusy(false);
      return;
    }

    setCreated(true);
    setBusy(false);
    draft.clear();
    window.dispatchEvent(new Event('rubber-mat-size-created'));
    const target = closeContext.kind === 'intercepted' ? closeContext.returnTo : closeContext.fallbackHref;
    try {
      router.replace(target);
    } catch {
      setError('Размер добавлен, но не удалось вернуться к каталогу. Закройте окно, чтобы продолжить.');
    }
  };

  return (
    <FormDialog
      open
      title="Новый размер ковра"
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
            pendingLabel="Добавляем…"
            disabled={loading || busy || created}
          >{created ? 'Добавлено' : 'Добавить размер'}</Button> : null}
        </div>
      )}
    >
      {canManage ? (
        <form id={FORM_ID} className={styles.form} onSubmit={(event) => void submit(event)}>
          <p className={styles.requiredNote}><span aria-hidden="true">*</span> — обязательные поля</p>
          <div className={styles.fields}>
            <Field label="Длина, см" required className={styles.dimension}>
              <input required type="number" min="0.01" max="99999999.99" step="0.01" value={draft.value.length} disabled={busy} onChange={(event) => update('length', event.target.value)} />
            </Field>
            <Field label="Ширина, см" required className={styles.dimension}>
              <input required type="number" min="0.01" max="99999999.99" step="0.01" value={draft.value.width} disabled={busy} onChange={(event) => update('width', event.target.value)} />
            </Field>
            <Field label="Стоимость замены, ₽" className={styles.cost}>
              <input type="number" min="0" max="999999999999.99" step="0.01" value={draft.value.replacementCost} disabled={busy} onChange={(event) => update('replacementCost', event.target.value)} />
            </Field>
          </div>
          {loading ? <p role="status">Проверяем доступ…</p> : null}
          {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
          {created ? <Alert tone="success" role="status">Размер ковра добавлен.</Alert> : null}
        </form>
      ) : canManage === false ? <Alert tone="danger" role="alert">Нет доступа к управлению каталогом размеров ковров.</Alert> : null}
    </FormDialog>
  );
}
