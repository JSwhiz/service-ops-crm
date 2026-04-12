'use client';

import React from 'react';

import type { ObjectAssignedUser } from '@/entities/object/model/object.types';
import type { SystemUserOption } from '@/entities/user/model/user.types';

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
    <div className="page-card">
      <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 16 }}>
        {title}
      </div>

      <div style={{ fontWeight: 600, marginBottom: 10 }}>Текущий состав</div>

      {currentItems.length === 0 ? (
        <div className="page-muted" style={{ marginBottom: 16 }}>
          {emptyCurrentText}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
          {currentItems.map((item) => (
            <div
              key={item.userId}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                padding: 10,
                border: '1px solid #d1d5db',
                borderRadius: 10,
              }}
            >
              <span>{item.fullName}</span>

              <button
                type="button"
                onClick={() => void onRemove(item.userId)}
              >
                {removeButtonText}
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontWeight: 600, marginBottom: 10 }}>Доступные кандидаты</div>

      {availableUsers.length === 0 ? (
        <div className="page-muted">{emptyAvailableText}</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {availableUsers.map((user) => (
            <div
              key={user.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                padding: 10,
                border: '1px solid #d1d5db',
                borderRadius: 10,
              }}
            >
              <span>
                {user.fullName} ({user.login})
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
    </div>
  );
}
