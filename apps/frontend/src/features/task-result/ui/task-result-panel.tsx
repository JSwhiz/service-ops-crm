'use client';

import React, { useState } from 'react';

export function TaskResultPanel({
  initialValue,
  onSubmit,
}: {
  initialValue: string;
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
          style={{ width: '100%', padding: 10, resize: 'vertical' }}
        />

        {error ? (
          <div style={{ marginTop: 12, color: '#b91c1c' }}>{error}</div>
        ) : null}

        <div style={{ marginTop: 12 }}>
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Отправляем...' : 'Отправить результат'}
          </button>
        </div>
      </form>
    </div>
  );
}
