'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';

import type { AccountabilityExpenseItem } from '@/entities/accountability/model/accountability.types';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';
import { Alert, Button, Field, Stack } from '@/shared/ui/foundation';

import { Dialog } from '@/shared/ui/overlays/overlays';
import { createExpenseDraftRequest } from '../model/expense-draft-request';
import styles from './accountability-ui.module.css';

export function AccountabilityExpenseForm({
  initialExpense,
  openRequest = 0,
  canSave,
  canSubmit,
  onSave,
  onCancelEdit,
}: {
  initialExpense?: AccountabilityExpenseItem | null;
  openRequest?: number;
  canSave: boolean;
  canSubmit: boolean;
  onSave: (payload: {
    expenseId?: string;
    clientRequestId?: string;
    amount: number;
    description: string;
    files: File[];
    submitAfterSave: boolean;
  }) => Promise<void>;
  onCancelEdit?: () => void;
}): React.JSX.Element | null {
  const formId = useId();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const request = useRef(createExpenseDraftRequest());
  const saveLock = useRef(false);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (openRequest > 0) setOpen(true);
  }, [openRequest]);

  useEffect(() => {
    request.current.complete();
    if (initialExpense) {
      setOpen(true);
      setAmount(String(initialExpense.amount));
      setDescription(initialExpense.description);
      setPendingFiles([]);
      return;
    }

    setAmount('');
    setDescription('');
    setPendingFiles([]);
  }, [initialExpense]);

  const handleSave = async (submitAfterSave: boolean): Promise<void> => {
    if (!canSave || (submitAfterSave && !canSubmit) || saveLock.current) return;
    const normalizedAmount = Number(amount);
    const normalizedDescription = description.trim();

    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      return;
    }

    if (!normalizedDescription) {
      return;
    }

    setSaveError(null);
    saveLock.current = true;
    setIsSubmitting(true);
    try {
      await onSave({
        expenseId: initialExpense?.id,
        clientRequestId: initialExpense ? undefined : request.current.getId(),
        amount: normalizedAmount,
        description: normalizedDescription,
        files: pendingFiles,
        submitAfterSave,
      });

      request.current.complete();
      setOpen(false);
      if (!initialExpense) {
        setAmount('');
        setDescription('');
        setPendingFiles([]);
      }
    } catch {
      setSaveError(
        'Не удалось подтвердить сохранение. Черновик и выбранные файлы сохранены в форме. Проверьте список расходов перед повторной попыткой. Если данные уже сохранены, восстановите исходные значения: изменённый черновик не создаст второй расход.',
      );
    } finally {
      saveLock.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {!canSave &&
      (initialExpense || amount || description || pendingFiles.length > 0) ? (
        <Alert tone="warning" role="status">
          Сохранение расхода недоступно. Черновик и выбранные файлы сохранены.
          После восстановления права отправьте его вручную.
        </Alert>
      ) : null}
      {canSave &&
      !canSubmit &&
      (initialExpense || amount || description || pendingFiles.length > 0) ? (
        <Alert tone="info" role="status">
          Отправка расхода на проверку недоступна. Вы можете сохранить черновик.
        </Alert>
      ) : null}
      <AccessSnapshotBoundary
        key={initialExpense?.id ?? 'new'}
        blocked={!canSave}
      >
        <Button variant="primary" onClick={() => setOpen(true)}>
          {initialExpense
            ? 'Продолжить редактирование'
            : amount || description || pendingFiles.length
              ? 'Продолжить расход'
              : 'Добавить расход'}
        </Button>
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title={initialExpense ? 'Редактирование расхода' : 'Новый расход'}
          size="regular"
          busy={isSubmitting}
          footer={
            <div className="ui-inline">
              <Button
                form={formId}
                type="submit"
                name="intent"
                value="draft"
                disabled={isSubmitting || !canSave}
              >
                {isSubmitting ? 'Сохраняем...' : 'Сохранить черновик'}
              </Button>
              <Button
                form={formId}
                type="submit"
                name="intent"
                value="submit"
                variant="primary"
                disabled={isSubmitting || !canSave || !canSubmit}
              >
                {isSubmitting ? 'Отправляем...' : 'Отправить'}
              </Button>
              {initialExpense && onCancelEdit ? (
                <Button disabled={isSubmitting} onClick={onCancelEdit}>
                  Отмена
                </Button>
              ) : null}
            </div>
          }
        >
          <form
            id={formId}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const submitAfterSave =
                (event.nativeEvent as SubmitEvent).submitter?.getAttribute(
                  'value',
                ) === 'submit';
              void handleSave(submitAfterSave);
            }}
          >
            <Stack gap="md">
              <div className="ui-text-muted">
                Черновик можно сохранить без отправки на проверку. При закрытии
                формы введённые данные остаются здесь.
              </div>

              <div className={styles.expenseFormGrid}>
                <Field label="Сумма, ₽" required>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="0.00"
                  />
                </Field>

                <Field label="Описание" required>
                  <textarea
                    rows={3}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Кратко опишите, на что ушли деньги"
                    style={{ width: '100%', resize: 'vertical' }}
                  />
                </Field>
              </div>

              {initialExpense?.attachments.length ? (
                <Stack gap="sm">
                  <div className="ui-text-muted">
                    Уже прикрепленные вложения
                  </div>
                  <AttachmentPreviewList
                    files={initialExpense.attachments}
                    emptyText="Вложений пока нет."
                  />
                </Stack>
              ) : null}

              <Stack gap="sm">
                <div className="ui-text-muted">
                  {initialExpense?.expenseCategory === 'employee_payout'
                    ? 'Фото и чек выплаты — по желанию'
                    : 'Фото и документы расхода'}
                </div>
                <MediaActionPicker
                  disabled={isSubmitting || !canSave}
                  onPick={async (file) => {
                    setPendingFiles((prev) => [...prev, file]);
                  }}
                />
                <PendingMediaList
                  files={pendingFiles}
                  onRemove={(index) =>
                    setPendingFiles((prev) =>
                      prev.filter((_, currentIndex) => currentIndex !== index),
                    )
                  }
                  emptyText="Новых вложений пока нет."
                />
              </Stack>

              {saveError ? (
                <Alert tone="danger" role="alert">
                  {saveError}
                </Alert>
              ) : null}
              {!canSubmit ? (
                <Alert tone="info">
                  Отправка на проверку недоступна. Можно сохранить черновик.
                </Alert>
              ) : null}
            </Stack>
          </form>
        </Dialog>
      </AccessSnapshotBoundary>
    </>
  );
}
