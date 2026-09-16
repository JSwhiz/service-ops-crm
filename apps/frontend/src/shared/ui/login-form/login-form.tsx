'use client';

import { useRouter } from 'next/navigation';
import React, { useState } from 'react';

import { useAuth } from '@/shared/auth/use-auth';

import styles from './login-form.module.css';

export function LoginForm(): React.JSX.Element {
  const router = useRouter();
  const { login } = useAuth();

  const [form, setForm] = useState({
    login: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
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
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.header}>
        <div className={styles.kicker}>Рабочее пространство</div>
        <h2>Вход</h2>
        <p>Используй рабочий логин и пароль.</p>
      </div>

      <div className={styles.fields}>
        <label className={styles.field}>
          <span>Логин</span>
          <input
            autoFocus
            autoComplete="username"
            value={form.login}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, login: event.target.value }))
            }
            placeholder="Введите логин"
            required
          />
        </label>

        <label className={styles.field}>
          <span>Пароль</span>
          <span className={styles.passwordControl}>
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={form.password}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, password: event.target.value }))
              }
              placeholder="Введите пароль"
              required
            />
            <button
              type="button"
              className={styles.passwordToggle}
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
            >
              {showPassword ? 'Скрыть' : 'Показать'}
            </button>
          </span>
        </label>
      </div>

      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        className={styles.submit}
        disabled={isSubmitting || !form.login.trim() || !form.password}
      >
        {isSubmitting ? 'Входим…' : 'Войти'}
      </button>

      <div className={styles.footer}>Доступ только для сотрудников компании.</div>
    </form>
  );
}
