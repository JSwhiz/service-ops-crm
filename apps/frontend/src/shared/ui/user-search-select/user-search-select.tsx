'use client';

import React, { useState } from 'react';

import type { SystemUserOption } from '@/entities/user/model/user.types';
import {
  getUserDisplayName,
  getUserSecondaryLabel,
} from '@/shared/lib/display-name';

interface UserSearchSelectProps {
  label: string;
  options: SystemUserOption[];
  value: string;
  onChange: (userId: string) => void;
  disabled?: boolean;
  required?: boolean;
  emptyText?: string;
}

export function UserSearchSelect({
  label,
  options,
  value,
  onChange,
  disabled = false,
  required = false,
  emptyText = 'Активные пользователи не найдены.',
}: UserSearchSelectProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase('ru');
  const selectedUser = options.find((item) => item.id === value) ?? null;
  const visibleOptions = (() => {
    if (!normalizedQuery) {
      return options;
    }

    return options.filter((user) => {
      if (user.id === value) {
        return true;
      }

      return `${user.fullName} ${user.login}`
        .toLocaleLowerCase('ru')
        .includes(normalizedQuery);
    });
  })();

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <label>
        <div style={{ marginBottom: 6 }}>{label}</div>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по ФИО или логину"
          disabled={disabled}
          style={{ width: '100%', padding: 10 }}
        />
      </label>

      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        required={required}
        aria-label={label}
        style={{ width: '100%', padding: 10 }}
      >
        <option value="">Выберите пользователя</option>
        {visibleOptions.map((user) => {
          const secondary = getUserSecondaryLabel(user);

          return (
            <option key={user.id} value={user.id}>
              {getUserDisplayName(user)}{secondary ? ` ${secondary}` : ''}
            </option>
          );
        })}
      </select>

      {options.length === 0 ? (
        <div className="page-muted">{emptyText}</div>
      ) : selectedUser ? (
        <div className="page-muted">
          Выбран: {getUserDisplayName(selectedUser)}
          {getUserSecondaryLabel(selectedUser)
            ? ` ${getUserSecondaryLabel(selectedUser)}`
            : ''}
        </div>
      ) : null}
    </div>
  );
}
