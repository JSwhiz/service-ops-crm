'use client';

import React, { useRef } from 'react';

import { listCandidateManagers } from '@/entities/candidate/api/candidate-client';
import type {
  CandidateAssignment,
  CandidateAssignmentInput,
  CandidateObjectSummary,
} from '@/entities/candidate/model/candidate.types';
import { listObjectsPage } from '@/entities/object/api/object-client';
import { Button, Field } from '@/shared/ui/foundation';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';

import styles from './candidate-fields.module.css';

export interface CandidateManagerDraft extends CandidateAssignmentInput {
  key: string;
  manager?: CandidateAssignment['manager'];
  object?: CandidateObjectSummary | null;
}

export interface CandidatePhoneDraft {
  key: string;
  value: string;
}

export function candidatePhoneDrafts(phones: string[]): CandidatePhoneDraft[] {
  return (phones.length ? phones : ['']).map((value, index) => ({
    key: `phone-${index}`,
    value,
  }));
}

export function candidateManagerDrafts(
  assignments: CandidateAssignment[],
): CandidateManagerDraft[] {
  return assignments.map((assignment) => ({
    key: assignment.id,
    managerUserId: assignment.manager.id,
    manager: assignment.manager,
    objectId: assignment.object?.id ?? null,
    object: assignment.object,
  }));
}

export function candidateManagerPayload(
  rows: CandidateManagerDraft[],
  defaultObjectId: string | null,
): CandidateAssignmentInput[] {
  return rows.map((row) => ({
    managerUserId: row.managerUserId,
    objectId: row.objectId === undefined ? defaultObjectId : row.objectId,
  }));
}

export function candidateManagersValid(rows: CandidateManagerDraft[]): boolean {
  return (
    rows.length <= 30 &&
    rows.every((row) => Boolean(row.managerUserId)) &&
    new Set(rows.map((row) => row.managerUserId)).size === rows.length
  );
}

export function CandidatePhoneFields({
  phones,
  onChange,
  disabled = false,
}: {
  phones: CandidatePhoneDraft[];
  onChange: (phones: CandidatePhoneDraft[]) => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <div className={styles.stack}>
      {phones.map((phone, index) => (
        <div className={styles.phoneRow} key={phone.key}>
          <Field
            className={styles.field}
            label={`Телефон ${index + 1}`}
            required
          >
            <input
              type="tel"
              autoComplete="tel"
              minLength={3}
              maxLength={50}
              value={phone.value}
              disabled={disabled}
              onChange={(event) =>
                onChange(
                  phones.map((value) =>
                    value.key === phone.key
                      ? { ...value, value: event.target.value }
                      : value,
                  ),
                )
              }
            />
          </Field>
          <Button
            variant="ghost"
            className={styles.quiet}
            disabled={disabled || phones.length === 1}
            aria-label={`Удалить телефон ${index + 1}`}
            onClick={() =>
              onChange(phones.filter((value) => value.key !== phone.key))
            }
          >
            Удалить
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        className={styles.quiet}
        disabled={disabled || phones.length >= 10}
        onClick={() => {
          if (phones.length < 10)
            onChange([...phones, { key: crypto.randomUUID(), value: '' }]);
        }}
      >
        Добавить телефон
      </Button>
    </div>
  );
}

export function CandidateManagerFields({
  rows,
  onChange,
  defaultObject,
  disabled = false,
}: {
  rows: CandidateManagerDraft[];
  onChange: (rows: CandidateManagerDraft[]) => void;
  defaultObject: CandidateObjectSummary | null;
  disabled?: boolean;
}): React.JSX.Element {
  const objectCache = useRef(new Map<string, CandidateObjectSummary>());
  const update = (key: string, patch: Partial<CandidateManagerDraft>): void =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  return (
    <div className={styles.stack}>
      {rows.map((row, index) => {
        const object = row.objectId === undefined ? defaultObject : row.object;
        return (
          <div key={row.key} className={styles.managerRow}>
            <SearchableSelect
              label={`Менеджер ${index + 1}`}
              value={row.managerUserId}
              options={[]}
              disabled={disabled}
              clearable={false}
              selectedOption={
                row.manager
                  ? {
                      value: row.manager.id,
                      label: row.manager.fullName || row.manager.login,
                    }
                  : null
              }
              placeholder="Выберите менеджера"
              searchPlaceholder="ФИО или логин"
              asyncSearch={async (query) =>
                (await listCandidateManagers({ q: query }))
                  .filter(
                    (manager) =>
                      manager.id === row.managerUserId ||
                      !rows.some((other) => other.managerUserId === manager.id),
                  )
                  .map((manager) => ({
                    value: manager.id,
                    label: manager.fullName || manager.login,
                    description: `@${manager.login}`,
                  }))
              }
              onChange={(managerUserId) =>
                update(row.key, { managerUserId, manager: undefined })
              }
            />
            <SearchableSelect
              label={`Объект рассмотрения · менеджер ${index + 1}`}
              value={
                row.objectId === undefined
                  ? (defaultObject?.id ?? '')
                  : (row.objectId ?? '')
              }
              options={[]}
              disabled={disabled}
              placeholder="Без объекта"
              searchPlaceholder="Название, адрес или внутреннее имя"
              selectedOption={
                object
                  ? {
                      value: object.id,
                      label: object.name,
                      description: [object.internalName, object.address]
                        .filter(Boolean)
                        .join(' · '),
                    }
                  : null
              }
              asyncSearch={async (query) => {
                const result = await listObjectsPage({
                  q: query,
                  page: 1,
                  limit: 20,
                  sortBy: 'name',
                  sortDirection: 'asc',
                });
                for (const item of result.items)
                  objectCache.current.set(item.id, item);
                return result.items.map((item) => ({
                  value: item.id,
                  label: item.name,
                  description: [item.internalName, item.address]
                    .filter(Boolean)
                    .join(' · '),
                }));
              }}
              onChange={(objectId) =>
                update(row.key, {
                  objectId: objectId || null,
                  object: objectCache.current.get(objectId) ?? null,
                })
              }
            />
            <p className={styles.hint}>
              {object
                ? [object.name, object.internalName, object.address]
                    .filter(Boolean)
                    .join(' · ')
                : 'Без объекта рассмотрения'}
            </p>
            <Button
              variant="ghost"
              className={styles.quiet}
              disabled={disabled}
              onClick={() =>
                onChange(rows.filter((other) => other.key !== row.key))
              }
              aria-label={`Убрать менеджера ${index + 1}`}
            >
              Убрать
            </Button>
          </div>
        );
      })}
      {!candidateManagersValid(rows) ? (
        <p className={styles.hint}>
          Выберите разных менеджеров в каждой строке.
        </p>
      ) : null}
      <Button
        variant="ghost"
        className={styles.quiet}
        disabled={disabled || rows.length >= 30}
        onClick={() =>
          rows.length < 30 &&
          onChange([...rows, { key: crypto.randomUUID(), managerUserId: '' }])
        }
      >
        Добавить менеджера
      </Button>
      <p className={styles.hint}>
        Для каждого менеджера можно указать свой объект рассмотрения. Это не
        назначает оформленного сотрудника на объект.
      </p>
    </div>
  );
}
