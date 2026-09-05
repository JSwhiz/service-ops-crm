'use client';

import React from 'react';

import type { ObjectAssignedUser } from '@/entities/object/model/object.types';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import {
  getUserDisplayName,
  getUserSecondaryLabel,
} from '@/shared/lib/display-name';

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
  const currentIds = new Set(currentItems.map((item) => item.userId));

  return (
    <div className={`page-card ${styles.panel}`}>
      <div className={styles.title}>{title}</div>

      <section className={styles.group}>
        <div className={styles.groupTitle}>Текущий состав</div>

        {currentItems.length === 0 ? (
          <div className="page-muted">{emptyCurrentText}</div>
        ) : (
          <div className={styles.list}>
            {currentItems.map((item) => (
              <div key={item.userId} className={styles.row}>
                <span className={styles.identity}>{getUserDisplayName(item)}</span>
                <button type="button" onClick={() => void onRemove(item.userId)}>
                  {removeButtonText}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={styles.group}>
        <div className={styles.groupTitle}>Доступные пользователи</div>

        {availableUsers.length === 0 ? (
          <div className="page-muted">{emptyAvailableText}</div>
        ) : (
          <div className={styles.list}>
            {availableUsers.map((user) => (
              <div key={user.id} className={styles.row}>
                <span className={styles.identity}>
                  {getUserDisplayName(user)}
                  {getUserSecondaryLabel(user) ? (
                    <span className="identity-secondary">
                      {getUserSecondaryLabel(user)}
                    </span>
                  ) : null}
                </span>

                {currentIds.has(user.id) ? (
                  <span className="page-muted">Уже назначен</span>
                ) : (
                  <button type="button" onClick={() => void onAdd(user.id)}>
                    {addButtonText}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
