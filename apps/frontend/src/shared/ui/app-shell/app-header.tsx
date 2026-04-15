'use client';

import React from 'react';

import { useAuth } from '@/shared/auth/use-auth';

export function AppHeader(): React.JSX.Element {
  const { user, logout } = useAuth();

  return (
    <header className="app-header">
      <div className="app-header__title">Рабочая система</div>
      <div className="app-header__meta" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span>{user?.fullName ?? 'Пользователь'}</span>
        <button
          type="button"
          onClick={() => {
            void logout();
          }}
        >
          Выйти
        </button>
      </div>
    </header>
  );
}
