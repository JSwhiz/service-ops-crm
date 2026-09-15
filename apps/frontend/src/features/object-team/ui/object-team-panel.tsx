'use client';

import React, { useMemo, useState } from 'react';

import type { ObjectAssignedUser } from '@/entities/object/model/object.types';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import {
  getUserDisplayName,
  getUserSecondaryLabel,
} from '@/shared/lib/display-name';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';

import styles from './object-team-panel.module.css';

interface ObjectTeamPanelProps {
  title: string;
  currentItems: ObjectAssignedUser[];
  availableUsers: SystemUserOption[];
  emptyCurrentText: string;
  emptyAvailableText: string;
  addButtonText: string;
  removeButtonText: string;
  onAdd: (userId: string) => Promise<void>;
  onRemove: (userId: string) => Promise<void>;
}

export function ObjectTeamPanel({
  title,
  currentItems,
  availableUsers,
  emptyCurrentText,
  emptyAvailableText,
  addButtonText,
  removeButtonText,
  onAdd,
  onRemove,
}: ObjectTeamPanelProps): React.JSX.Element {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentIds = useMemo(() => new Set(currentItems.map((item) => item.userId)), [currentItems]);

  const options = availableUsers
    .filter((user) => !currentIds.has(user.id))
    .map((user) => ({
      value: user.id,
      label: getUserDisplayName(user),
      description: getUserSecondaryLabel(user) || undefined,
      searchText: `${user.fullName} ${user.login}`,
    }));

  const handleAdd = (userId: string): void => {
    if (!userId) return;
    setSelectedUserId(userId);
    setError(null);
    setIsSubmitting(true);
    void onAdd(userId)
      .then(() => setSelectedUserId(''))
      .catch((caughtError) => {
        setError(
          caughtError instanceof Error && caughtError.message.trim()
            ? caughtError.message
            : 'Не удалось изменить состав команды.',
        );
      })
      .finally(() => setIsSubmitting(false));
  };

  const handleRemove = (userId: string): void => {
    setError(null);
    setIsSubmitting(true);
    void onRemove(userId)
      .catch((caughtError) => {
        setError(
          caughtError instanceof Error && caughtError.message.trim()
            ? caughtError.message
            : 'Не удалось изменить состав команды.',
        );
      })
      .finally(() => setIsSubmitting(false));
  };

  return (
    <div className={`page-card ${styles.panel}`}>
      <div className={styles.header}>
        <div className={styles.title}>{title}</div>
        <span className={styles.count}>{currentItems.length}</span>
      </div>

      <section className={styles.group}>
        {currentItems.length === 0 ? (
          <div className={styles.empty}>{emptyCurrentText}</div>
        ) : (
          <div className={styles.list}>
            {currentItems.map((item) => (
              <div key={item.userId} className={styles.row}>
                <span className={styles.identity}>
                  <strong>{getUserDisplayName(item)}</strong>
                  {getUserSecondaryLabel(item) ? (
                    <span>{getUserSecondaryLabel(item)}</span>
                  ) : null}
                </span>
                <button type="button" disabled={isSubmitting} onClick={() => handleRemove(item.userId)}>
                  {removeButtonText}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className={styles.addControl}>
        {options.length > 0 ? (
          <SearchableSelect
            label="Добавить"
            value={selectedUserId}
            options={options}
            placeholder={addButtonText}
            searchPlaceholder="ФИО или логин"
            emptyText={emptyAvailableText}
            clearable={false}
            onChange={handleAdd}
            disabled={isSubmitting}
          />
        ) : (
          <div className={styles.empty}>{emptyAvailableText}</div>
        )}
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}
    </div>
  );
}
