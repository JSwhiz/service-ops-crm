'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import type { ObjectAssignedUser } from '@/entities/object/model/object.types';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import {
  getUserDisplayName,
  getUserSecondaryLabel,
} from '@/shared/lib/display-name';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';
import { MediaActionIcon } from '@/shared/ui/app-shell/media-action-icon';

import { CloseIcon } from '@/shared/ui/icons/icons';
import styles from './object-team-panel.module.css';
import { Button, IconButton } from '@/shared/ui/foundation';

interface ObjectTeamPanelProps {
  title: string;
  currentItems: ObjectAssignedUser[];
  availableUsers: SystemUserOption[];
  emptyCurrentText: string;
  emptyAvailableText: string;
  addButtonText: string;
  removeButtonText: string;
  minimumItemsToKeep?: number;
  replaceOnly?: boolean;
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
  minimumItemsToKeep = 0,
  replaceOnly = false,
  onAdd,
  onRemove,
}: ObjectTeamPanelProps): React.JSX.Element {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isReplacementOpen, setIsReplacementOpen] = useState(false);
  const [replacementQuery, setReplacementQuery] = useState('');
  const currentIds = useMemo(() => new Set(currentItems.map((item) => item.userId)), [currentItems]);

  const options = availableUsers
    .filter((user) => !currentIds.has(user.id))
    .map((user) => ({
      value: user.id,
      label: getUserDisplayName(user),
      description: getUserSecondaryLabel(user) || undefined,
      searchText: `${user.fullName} ${user.login}`,
    }));
  const replacementOptions = options.filter((option) =>
    `${option.label} ${option.searchText ?? ''}`
      .toLocaleLowerCase('ru')
      .includes(replacementQuery.trim().toLocaleLowerCase('ru')),
  );

  useEffect(() => {
    if (!isReplacementOpen) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsReplacementOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isReplacementOpen]);

  const handleAdd = (userId: string): void => {
    if (!userId) return;
    setSelectedUserId(userId);
    setError(null);
    setIsSubmitting(true);
    void onAdd(userId)
      .then(() => {
        setSelectedUserId('');
        setIsReplacementOpen(false);
        setReplacementQuery('');
      })
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
        {replaceOnly ? (
          <div className={styles.replacementControl}>
            <Button size="sm"
              disabled={isSubmitting || options.length === 0}
              aria-label={currentItems.length ? 'Заменить ответственного' : 'Назначить ответственного'}
              aria-expanded={isReplacementOpen}
              title={currentItems.length ? 'Заменить ответственного' : 'Назначить ответственного'}
              onClick={() => setIsReplacementOpen((open) => !open)}
            >
              <MediaActionIcon name="replace" />
            </Button>
            {isReplacementOpen && typeof document !== 'undefined' ? createPortal(
              <div className={styles.replacementOverlay} onMouseDown={(event) => { if (event.target === event.currentTarget) setIsReplacementOpen(false); }}>
                <section className={styles.replacementDialog} role="dialog" aria-modal="true" aria-labelledby="replace-responsible-title">
                  <header className={styles.dialogHeader}>
                    <div>
                      <h2 id="replace-responsible-title">Заменить ответственного</h2>
                      <p>Выберите сотрудника, который будет отвечать за объект</p>
                    </div>
                    <IconButton aria-label="Закрыть" title="Закрыть" onClick={() => setIsReplacementOpen(false)}><CloseIcon size={18} /></IconButton>
                  </header>
                <input
                  autoFocus
                  type="search"
                  value={replacementQuery}
                  aria-label="Поиск ответственного"
                  placeholder="Поиск по ФИО или логину"
                  onChange={(event) => setReplacementQuery(event.target.value)}
                />
                <div className={styles.replacementOptions} role="listbox" aria-label="Кандидаты на роль ответственного">
                  {replacementOptions.length ? replacementOptions.map((option) => (
                    <Button key={option.value} role="option" onClick={() => handleAdd(option.value)} disabled={isSubmitting}>
                      <strong>{option.label}</strong>
                      {option.description ? <span>{option.description}</span> : null}
                    </Button>
                  )) : <div className={styles.empty}>{emptyAvailableText}</div>}
                </div>
                </section>
              </div>,
              document.body,
            ) : null}
          </div>
        ) : <span className={styles.count}>{currentItems.length}</span>}
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
                {!replaceOnly ? <Button
                  disabled={isSubmitting || currentItems.length <= minimumItemsToKeep}
                  title={currentItems.length <= minimumItemsToKeep ? 'Нельзя снять последнего ответственного' : undefined}
                  onClick={() => handleRemove(item.userId)}
                >
                  {removeButtonText}
                </Button> : null}
              </div>
            ))}
          </div>
        )}
        {!replaceOnly && currentItems.length > 0 && currentItems.length <= minimumItemsToKeep ? (
          <div className={styles.empty}>У объекта должен оставаться хотя бы один ответственный.</div>
        ) : null}
      </section>

      {!replaceOnly ? <div className={styles.addControl}>
        {options.length > 0 ? (
          <SearchableSelect
            label="Добавить"
            value={selectedUserId}
            options={options}
            placeholder={addButtonText}
            searchPlaceholder="ФИО или логин"
            emptyText={emptyAvailableText}
            clearable={false}
            viewportAware
            onChange={handleAdd}
            disabled={isSubmitting}
          />
        ) : (
          <div className={styles.empty}>{emptyAvailableText}</div>
        )}
      </div> : null}

      {error ? <div className={styles.error}>{error}</div> : null}
    </div>
  );
}
