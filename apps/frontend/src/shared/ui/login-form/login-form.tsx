'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/shared/auth/use-auth';

export function LoginForm(): React.JSX.Element {
  const router = useRouter();
  const { login } = useAuth();

  const [form, setForm] = useState({
    login: '',
    password: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(form);
      router.push('/dashboard');
    } catch {
      setError('Не удалось войти. Проверь логин и пароль.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="page-card" onSubmit={handleSubmit}>
      <h1 className="page-title">Вход в систему</h1>

      <div style={{ display: 'grid', gap: 12 }}>
        <label>
          <div style={{ marginBottom: 6 }}>Логин</div>
          <input
            value={form.login}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, login: event.target.value }))
            }
            style={{ width: '100%', padding: 10 }}
          />
        </label>

        <label>
          <div style={{ marginBottom: 6 }}>Пароль</div>
          <input
            type="password"
            value={form.password}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, password: event.target.value }))
            }
            style={{ width: '100%', padding: 10 }}
          />
        </label>

        {error ? <div style={{ color: '#b91c1c' }}>{error}</div> : null}

        <button type="submit" disabled={isSubmitting} style={{ padding: 10 }}>
          {isSubmitting ? 'Входим...' : 'Войти'}
        </button>
      </div>
    </form>
  );
}
