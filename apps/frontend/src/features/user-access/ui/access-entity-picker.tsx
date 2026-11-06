'use client';

import React, { useEffect, useState } from 'react';
import { getAccessResources } from '@/entities/user-access/api/user-access-client';
import type { AccessResource } from '@/entities/user-access/model/user-access.types';
import { getApprovalStatusLabel, getApprovalTypeLabel } from '@/shared/lib/approval-presentation';
import { Button } from '@/shared/ui/foundation';
import { SearchableSelect, type SearchableSelectOption } from '@/shared/ui/searchable-select/searchable-select';
import styles from './user-access.module.css';

const roomTypes: Record<string, string> = { direct: 'Личный чат', group: 'Групповой чат', system: 'Системный чат' };
function resourceOption(resourceType: string, item: AccessResource): SearchableSelectOption {
  const label = resourceType === 'approval' ? getApprovalTypeLabel(item.label) : item.label && item.label !== item.id ? item.label : 'Название не указано';
  const description = resourceType === 'approval' && item.description
    ? getApprovalStatusLabel(item.description)
    : resourceType === 'chat_room' && item.description
      ? roomTypes[item.description]
      : resourceType === 'task' ? undefined : item.description;
  return { value: item.id, label, description };
}
export function AccessEntityPicker({ resourceType, ids, onChange, disabled }: {
  resourceType: string; ids: string[]; onChange: (ids: string[]) => void; disabled: boolean;
}): React.JSX.Element {
  const [names, setNames] = useState<Record<string, string>>({});
  const [resolveFailed, setResolveFailed] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [resolveKey, setResolveKey] = useState(0);
  const idsKey = ids.join(',');
  useEffect(() => {
    if (!idsKey) { setResolveFailed(false); return; }
    let active = true;
    const controller = new AbortController();
    setResolveFailed(false);
    void getAccessResources(resourceType, { ids: idsKey.split(',') }, controller.signal)
      .then(({ items }) => {
        if (active) setNames(Object.fromEntries(items.map((item) => [item.id, resourceOption(resourceType, item).label])));
      })
      .catch(() => { if (active) setResolveFailed(true); });
    return () => { active = false; controller.abort(); };
  }, [idsKey, resourceType, resolveKey]);

  const search = async (query: string): Promise<SearchableSelectOption[]> => {
    const result = await getAccessResources(resourceType, { q: query });
    const items = result.items.map((item) => resourceOption(resourceType, item));
    setHasMore(result.hasMore);
    setNames((current) => ({ ...current, ...Object.fromEntries(items.map((item) => [item.value, item.label])) }));
    return items.filter((item) => !ids.includes(item.value));
  };
  return <div className={styles.stack}>
    <SearchableSelect
      label="Добавить запись в выбранную область"
      value="" options={[]} onChange={(id) => { if (id && !ids.includes(id)) onChange([...ids, id]); }}
      asyncSearch={search} minimumSearchLength={2} searchPromptText="Введите не меньше двух символов названия."
      placeholder="Найти запись…" searchPlaceholder="Поиск по названию…" disabled={disabled || ids.length >= 200}
      emptyText="Доступные записи не найдены. Уточните название."
    />
    {hasMore ? <p className="ui-text-muted" role="status">Показаны первые 30 совпадений. Уточните название, чтобы найти нужную запись.</p> : null}
    {ids.length ? <ul className={styles.selections}>{ids.map((id, index) => <li key={id}>
      <span>{names[id] ?? `Выбранная запись ${index + 1} · название недоступно`}</span>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(ids.filter((value) => value !== id))} aria-label={`Убрать ${names[id] ?? `выбранную запись ${index + 1}`}`}>Убрать</Button>
    </li>)}</ul> : <p className="ui-text-muted">Выберите хотя бы одну запись перед просмотром изменений.</p>}
    {resolveFailed ? <div role="status"><p className="ui-text-muted">Не удалось получить названия сохранённых записей. Выбранная область сохранена.</p><Button disabled={disabled} onClick={() => setResolveKey((value) => value + 1)}>Повторить загрузку названий</Button></div> : null}
    {ids.length ? <details><summary>Технические сведения выбранных записей</summary><ul>{ids.map((id) => <li key={id}>{id}</li>)}</ul></details> : null}
  </div>;
}
