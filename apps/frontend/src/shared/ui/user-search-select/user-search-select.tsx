'use client';

import React from 'react';

import type { SystemUserOption } from '@/entities/user/model/user.types';
import {
  getUserDisplayName,
  getUserSecondaryLabel,
} from '@/shared/lib/display-name';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';

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
  return (
    <div>
      <SearchableSelect
        label={label}
        value={value}
        onChange={onChange}
        options={options.map((user) => {
          const secondary = getUserSecondaryLabel(user);
          return {
            value: user.id,
            label: getUserDisplayName(user),
            description: secondary || undefined,
            searchText: `${user.fullName} ${user.login}`,
          };
        })}
        placeholder="Выберите пользователя"
        searchPlaceholder="Поиск по ФИО или логину"
        emptyText={emptyText}
        clearable={!required}
        required={required}
        viewportAware
        disabled={disabled}
      />
    </div>
  );
}
