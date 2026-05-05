'use client';

import React from 'react';

import type { ObjectAssignedUser } from '@/entities/object/model/object.types';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import {
  getUserDisplayName,
  getUserSecondaryLabel,
} from '@/shared/lib/display-name';

interface ObjectManagersPanelProps {
  responsibles: ObjectAssignedUser[];
  managers: ObjectAssignedUser[];
  responsibleCandidates: SystemUserOption[];
  managerCandidates: SystemUserOption[];
  onAddResponsible: (userId: string) => Promise<void>;
  onRemoveResponsible: (userId: string) => Promise<void>;
  onAddManager: (userId: string) => Promise<void>;
  onRemoveManager: (userId: string) => Promise<void>;
}

export function ObjectManagersPanel({
  responsibles,
  managers,
  responsibleCandidates,
  managerCandidates,
  onAddResponsible,
  onRemoveResponsible,
  onAddManager,
  onRemoveManager,
}: ObjectManagersPanelProps): React.JSX.Element {
  const responsibleIds = new Set(responsibles.map((item) => item.userId));
  const managerIds = new Set(managers.map((item) => item.userId));

  return (
    <div
      className="page-card"
      style={{
        display: 'grid',
        gap: 24,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 18 }}>
        Управление составом объекта
      </div>

      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        }}
      >
        <section>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>
            Ответственные объекта
          </div>

          {responsibles.length === 0 ? (
            <div className="page-muted" style={{ marginBottom: 12 }}>
              Ответственные пока не назначены.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
              {responsibles.map((item) => (
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
                  <span>{getUserDisplayName(item)}</span>

                  <button
                    type="button"
                    onClick={() => void onRemoveResponsible(item.userId)}
                  >
                    Снять
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontWeight: 600, marginBottom: 8 }}>
            Добавить ответственного
          </div>

          {responsibleCandidates.length === 0 ? (
            <div className="page-muted">Подходящих кандидатов нет.</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {responsibleCandidates.map((user) => (
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
                    {getUserDisplayName(user)}
                    {getUserSecondaryLabel(user) ? (
                      <span className="identity-secondary">
                        {getUserSecondaryLabel(user)}
                      </span>
                    ) : null}
                  </span>

                  {responsibleIds.has(user.id) ? (
                    <span className="page-muted">Уже назначен</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void onAddResponsible(user.id)}
                    >
                      Назначить
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>
            Менеджеры объекта
          </div>

          {managers.length === 0 ? (
            <div className="page-muted" style={{ marginBottom: 12 }}>
              Менеджеры пока не назначены.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
              {managers.map((item) => (
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
                  <span>{getUserDisplayName(item)}</span>

                  <button
                    type="button"
                    onClick={() => void onRemoveManager(item.userId)}
                  >
                    Снять
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontWeight: 600, marginBottom: 8 }}>
            Добавить менеджера
          </div>

          {managerCandidates.length === 0 ? (
            <div className="page-muted">Подходящих кандидатов нет.</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {managerCandidates.map((user) => (
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
                    {getUserDisplayName(user)}
                    {getUserSecondaryLabel(user) ? (
                      <span className="identity-secondary">
                        {getUserSecondaryLabel(user)}
                      </span>
                    ) : null}
                  </span>

                  {managerIds.has(user.id) ? (
                    <span className="page-muted">Уже назначен</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void onAddManager(user.id)}
                    >
                      Назначить
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
