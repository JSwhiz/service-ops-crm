'use client';

import React, { useEffect, useState } from 'react';

import type { AccountabilityExpenseItem } from '@/entities/accountability/model/accountability.types';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';

export function AccountabilityExpenseForm({
  initialExpense,
  canCreate,
  onSave,
  onCancelEdit,
}: {
  initialExpense?: AccountabilityExpenseItem | null;
  canCreate: boolean;
  onSave: (payload: {
    expenseId?: string;
    amount: number;
    description: string;
    files: File[];
    submitAfterSave: boolean;
  }) => Promise<void>;
  onCancelEdit?: () => void;
}): React.JSX.Element | null {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (initialExpense) {
      setAmount(String(initialExpense.amount));
      setDescription(initialExpense.description);
      setPendingFiles([]);
      return;
    }

    setAmount('');
    setDescription('');
    setPendingFiles([]);
  }, [initialExpense]);

  if (!canCreate && !initialExpense) {
    return null;
  }

  const handleSave = async (submitAfterSave: boolean): Promise<void> => {
    const normalizedAmount = Number(amount);
    const normalizedDescription = description.trim();

    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      return;
    }

    if (!normalizedDescription) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onSave({
        expenseId: initialExpense?.id,
        amount: normalizedAmount,
        description: normalizedDescription,
        files: pendingFiles,
        submitAfterSave,
      });

      if (!initialExpense) {
        setAmount('');
        setDescription('');
        setPendingFiles([]);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-card" style={{ display: 'grid', gap: 16 }}>
      <div className="section-header">
        <div>
          <div className="section-title">
            {initialExpense ? 'Редактирование расхода' : 'Новый расход'}
          </div>
          <div className="section-subtitle">
            Черновик можно сохранить без отправки на проверку.
          </div>
        </div>
      </div>

      <div className="field-grid">
        <label style={{ display: 'grid', gap: 6 }}>
          <span>Сумма</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
          />
        </label>

        <label style={{ display: 'grid', gap: 6, gridColumn: '1 / -1' }}>
          <span>Описание</span>
          <textarea
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Кратко опишите, на что ушли деньги"
            style={{ width: '100%', resize: 'vertical' }}
          />
        </label>
      </div>

      {initialExpense?.attachments.length ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <div className="page-muted">Уже прикрепленные вложения</div>
          <AttachmentPreviewList
            files={initialExpense.attachments}
            emptyText="Вложений пока нет."
          />
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 8 }}>
        <div className="page-muted">Фото и документы расхода</div>
        <MediaActionPicker
          disabled={isSubmitting}
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
      </div>

      <div className="action-row">
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => {
            void handleSave(false);
          }}
        >
          {isSubmitting ? 'Сохраняем...' : 'Сохранить draft'}
        </button>
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => {
            void handleSave(true);
          }}
        >
          {isSubmitting ? 'Отправляем...' : 'Отправить'}
        </button>
        {initialExpense && onCancelEdit ? (
          <button type="button" disabled={isSubmitting} onClick={onCancelEdit}>
            Отмена
          </button>
        ) : null}
      </div>
    </div>
  );
}
