'use client';

import React from 'react';

import type { HistoryActor } from '@/shared/api/history-page';
import { Button } from '@/shared/ui/foundation';
import { RegistryDateRange } from '@/shared/ui/registry-filters/registry-toolbar';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';
import { SearchField } from '@/shared/ui/search-field/search-field';
import type { SearchableSelectOption } from '@/shared/ui/searchable-select/searchable-select';

export interface HistoryFilterValues {
  q: string;
  eventType: string;
  actorUserId: string;
  dateFrom: string;
  dateTo: string;
}

export function hasHistoryFilters(filters: HistoryFilterValues): boolean {
  return Boolean(filters.q.trim() || filters.eventType || filters.actorUserId || filters.dateFrom || filters.dateTo);
}

export function HistoryFilterBar({
  filters,
  eventTypes,
  actors,
  actorsHasMore,
  eventTypesHasMore,
  busy = false,
  onActorSearch,
  onChange,
}: {
  filters: HistoryFilterValues;
  /** Permission-scoped event type facets supplied by the history endpoint. */
  eventTypes: SearchableSelectOption[];
  /** First permission-scoped actor facet page; remaining actors are searchable remotely. */
  actors: HistoryActor[];
  actorsHasMore: boolean;
  eventTypesHasMore: boolean;
  busy?: boolean;
  onActorSearch: (query: string) => Promise<HistoryActor[]>;
  onChange: (filters: HistoryFilterValues) => void;
}): React.JSX.Element {
  const setFilter = (key: keyof HistoryFilterValues, value: string): void => {
    onChange({ ...filters, [key]: value });
  };
  const actorOptions = actors.map((actor) => ({
    value: actor.id,
    label: actor.fullName,
    description: actor.login,
    searchText: `${actor.fullName} ${actor.login}`,
  }));
  const selectedActor = actorOptions.find((actor) => actor.value === filters.actorUserId) ?? null;

  return (
    <div className="ui-inline" role="group" aria-label="Фильтры истории">
      <SearchField
        value={filters.q}
        onChange={(value) => setFilter('q', value)}
        label="Поиск по истории"
        placeholder="Событие или автор"
        busy={busy}
      />
      <SearchableSelect
        label="Тип события"
        value={filters.eventType}
        options={eventTypes}
        onChange={(value) => setFilter('eventType', value)}
        placeholder="Все события"
        searchPlaceholder="Найти тип события…"
        emptyText="Типы событий не найдены"
      />
      <SearchableSelect
        label="Автор"
        value={filters.actorUserId}
        options={actorOptions}
        onChange={(value) => setFilter('actorUserId', value)}
        placeholder="Любой автор"
        searchPlaceholder="Найти автора…"
        emptyText="Авторы не найдены"
        asyncSearch={async (query) => (await onActorSearch(query)).map((actor) => ({
          value: actor.id,
          label: actor.fullName,
          description: actor.login,
          searchText: `${actor.fullName} ${actor.login}`,
        }))}
        selectedOption={selectedActor}
      />
      <RegistryDateRange
        label="Период, МСК"
        from={filters.dateFrom}
        to={filters.dateTo}
        onFromChange={(value) => setFilter('dateFrom', value)}
        onToChange={(value) => setFilter('dateTo', value)}
      />
      {actorsHasMore ? <span className="ui-text-muted">Чтобы найти другого автора, начните вводить имя или логин.</span> : null}
      {eventTypesHasMore ? <span className="ui-text-muted">Не все типы событий показаны; найдите нужное событие через поиск по истории.</span> : null}
      {hasHistoryFilters(filters) ? (
        <Button variant="ghost" onClick={() => onChange({ q: '', eventType: '', actorUserId: '', dateFrom: '', dateTo: '' })}>
          Сбросить
        </Button>
      ) : null}
    </div>
  );
}
