'use client';

import React, { useState } from 'react';

export function TaskResultPanel({
  initialValue,
  canSubmit,
  onSubmit,
}: {
  initialValue: string;
  canSubmit: boolean;
  onSubmit: (value: string) => Promise<void>;
}): React.JSX.Element {
  const [value, setValue] = useState(initialValue);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await onSubmit(value);
    } catch {
      setError('Не удалось отправить результат задачи.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-card">
      <div style={{ fontWeight: 600, marginBottom: 12 }}>Результат выполнения</div>

      <form onSubmit={handleSubmit}>
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={6}
          disabled={!canSubmit || isSubmitting}
          style={{ width: '100%', padding: 10, resize: 'vertical' }}
        />

        {!canSubmit ? (
          <div className="page-muted" style={{ marginTop: 12 }}>
            Отправка результата сейчас недоступна для вашего сценария.
          </div>
        ) : null}

        {error ? (
          <div style={{ marginTop: 12, color: '#b91c1c' }}>{error}</div>
        ) : null}

        <div style={{ marginTop: 12 }}>
          <button type="submit" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? 'Отправляем...' : 'Отправить результат'}
          </button>
        </div>
      </form>
    </div>
  );
}
