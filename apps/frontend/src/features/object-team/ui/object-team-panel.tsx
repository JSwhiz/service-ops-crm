'use client';

import React from 'react';

import type { ObjectAssignmentPerson } from '@/entities/object/model/object.types';
import type { SystemUserOption } from '@/entities/user/model/user.types';

interface ObjectTeamPanelProps {
  title: string;
  currentItems: ObjectAssignmentPerson[];
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
  const safeCurrentItems = currentItems ?? [];
  const safeAvailableUsers = availableUsers ?? [];

  const currentIds = new Set(safeCurrentItems.map((item) => item.userId));

  const filteredAvailableUsers = safeAvailableUsers.filter(
    (user) => !currentIds.has(user.id),
  );

  return (
    <div className="page-card">
      <div style={{ fontWeight: 600, marginBottom: 12 }}>{title}</div>

      <div style={{ display: 'grid', gap: 16 }}>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Текущий состав</div>

          {safeCurrentItems.length === 0 ? (
            <div className="page-muted">{emptyCurrentText}</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {safeCurrentItems.map((item) => (
                <div
                  key={`${item.roleCode}-${item.userId}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: 10,
                    border: '1px solid #d1d5db',
                    borderRadius: 10,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>{item.fullName}</div>
                    <div className="page-muted">{item.roleCode}</div>
                  </div>

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
        </div>

        <div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>
            Доступные кандидаты
          </div>

          {filteredAvailableUsers.length === 0 ? (
            <div className="page-muted">{emptyAvailableText}</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {filteredAvailableUsers.map((user) => (
                <div
                  key={user.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: 10,
                    border: '1px solid #d1d5db',
                    borderRadius: 10,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>{user.fullName}</div>
                    <div className="page-muted">
                      {user.login} · {user.roleCodes.join(', ')}
                    </div>
                  </div>

                  <button type="button" onClick={() => void onAdd(user.id)}>
                    {addButtonText}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
