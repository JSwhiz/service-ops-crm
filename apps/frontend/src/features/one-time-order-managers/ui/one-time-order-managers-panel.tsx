import React from 'react';

import type { OneTimeOrderItem } from '@/entities/one-time-order/model/one-time-order.types';
import type { SystemUserOption } from '@/entities/user/model/user.types';

export function OneTimeOrderManagersPanel({
  item,
  candidates,
  onAssign,
  onRemove,
}: {
  item: OneTimeOrderItem;
  candidates: SystemUserOption[];
  onAssign: (userId: string) => Promise<void>;
  onRemove: (userId: string) => Promise<void>;
}): React.JSX.Element {
  const assignedUserIds = new Set(item.managers.map((manager) => manager.userId));

  return (
    <div className="page-card" style={{ display: 'grid', gap: 16 }}>
      <div>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Менеджеры заказа</div>
        {item.managers.length === 0 ? (
          <div className="page-muted">Менеджеры пока не назначены.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {item.managers.map((manager) => (
              <div
                key={manager.userId}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  alignItems: 'center',
                  border: '1px solid #d1d5db',
                  borderRadius: 10,
                  padding: 10,
                }}
              >
                <div>
                  <div>{manager.fullName}</div>
                  <div className="page-muted">{manager.roleCode}</div>
                </div>
                {item.capabilities.canManageManagers ? (
                  <button type="button" onClick={() => void onRemove(manager.userId)}>
                    Снять
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {item.capabilities.canManageManagers ? (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>
            Назначить менеджера
          </div>
          {candidates.length === 0 ? (
            <div className="page-muted">Нет доступных кандидатов.</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {candidates
                .filter((candidate) => !assignedUserIds.has(candidate.id))
                .map((candidate) => (
                  <div
                    key={candidate.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      alignItems: 'center',
                      border: '1px solid #e5e7eb',
                      borderRadius: 10,
                      padding: 10,
                    }}
                  >
                    <div>
                      <div>{candidate.fullName}</div>
                      <div className="page-muted">{candidate.login}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void onAssign(candidate.id)}
                    >
                      Назначить
                    </button>
                  </div>
                ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
