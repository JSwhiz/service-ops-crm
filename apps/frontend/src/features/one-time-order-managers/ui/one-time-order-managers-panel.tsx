'use client';

import React, { useState } from 'react';

import type { OneTimeOrderItem } from '@/entities/one-time-order/model/one-time-order.types';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import {
  getUserDisplayName,
  getUserRoleLabel,
  getUserSecondaryLabel,
} from '@/shared/lib/display-name';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';

export function OneTimeOrderManagersPanel({
  item,
  searchCandidates,
  onAssign,
  onRemove,
}: {
  item: OneTimeOrderItem;
  searchCandidates: (query: string) => Promise<SystemUserOption[]>;
  onAssign: (userId: string) => Promise<void>;
  onRemove: (userId: string) => Promise<void>;
}): React.JSX.Element {
  const [pickerValue, setPickerValue] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
                className="record-card"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                <div>
                  <div>{getUserDisplayName(manager)}</div>
                  <div className="page-muted">
                    {getUserRoleLabel(manager.roleCode)}
                  </div>
                </div>
                {item.capabilities.canManageManagers ? (
                  <button
                    type="button"
                    disabled={isAssigning}
                    onClick={() => void onRemove(manager.userId)}
                  >
                    Снять
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {item.capabilities.canManageManagers ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <SearchableSelect
            label="Назначить менеджера"
            value={pickerValue}
            options={[]}
            clearable={false}
            disabled={isAssigning}
            placeholder="Найти менеджера"
            searchPlaceholder="ФИО или логин"
            emptyText="Подходящие менеджеры не найдены"
            asyncSearch={async (query) =>
              (await searchCandidates(query))
                .filter((candidate) => !assignedUserIds.has(candidate.id))
                .map((candidate) => ({
                  value: candidate.id,
                  label: getUserDisplayName(candidate),
                  description: getUserSecondaryLabel(candidate) || undefined,
                  searchText: `${candidate.fullName} ${candidate.login}`,
                }))
            }
            onChange={(value) => {
              if (!value) return;
              setPickerValue(value);
              setIsAssigning(true);
              setError(null);
              void onAssign(value)
                .then(() => setPickerValue(''))
                .catch((assignError) => {
                  setError(
                    assignError instanceof Error
                      ? assignError.message
                      : 'Не удалось назначить менеджера.',
                  );
                  setPickerValue('');
                })
                .finally(() => setIsAssigning(false));
            }}
          />
          {error ? <div className="form-error">{error}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
